package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// ctxUser returns the given request with role + user_id set in context, so
// comment author-scope handlers can distinguish owner vs. moderator.
func ctxUser(r *http.Request, role UserRole, userID int) *http.Request {
	ctx := context.WithValue(r.Context(), contextKeyRole, role)
	ctx = context.WithValue(ctx, contextKeyUserID, userID)
	return r.WithContext(ctx)
}

// seedIssueAndUsers creates one issue plus an author and a second regular user,
// returning the issue ID and the two user IDs.
func seedIssueAndUsers(t *testing.T) (issueID, authorID, otherID int) {
	t.Helper()
	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	author := &User{Email: "author@test.com", FirstName: "Ann", LastName: "Thor", PasswordHash: "h", Role: RoleUser, Active: true}
	other := &User{Email: "other@test.com", FirstName: "Otto", LastName: "Her", PasswordHash: "h", Role: RoleUser, Active: true}
	if err := CreateUser(context.Background(), author); err != nil {
		t.Fatalf("CreateUser author: %v", err)
	}
	if err := CreateUser(context.Background(), other); err != nil {
		t.Fatalf("CreateUser other: %v", err)
	}
	return issue.ID, author.ID, other.ID
}

func TestHandleCreateCommentPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	_, authorID, _ := seedIssueAndUsers(t)

	body, _ := json.Marshal(Comment{Body: "**Hello** world"})
	req := ctxUser(httptest.NewRequest("POST", "/api/projects/1/issues/1/comments", bytes.NewBuffer(body)), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rr.Code, rr.Body.String())
	}
	var got Comment
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Body != "**Hello** world" || got.User == nil || got.User.FirstName != "Ann" {
		t.Errorf("unexpected comment/author hydration: %+v", got)
	}

	comments, _ := GetCommentsByIssueID(context.Background(), 1)
	if len(comments) != 1 {
		t.Fatalf("expected 1 comment, got %d", len(comments))
	}
}

func TestHandleCreateCommentEmpty(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	_, authorID, _ := seedIssueAndUsers(t)

	body, _ := json.Marshal(Comment{Body: "   "})
	req := ctxUser(httptest.NewRequest("POST", "/api/projects/1/issues/1/comments", bytes.NewBuffer(body)), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty comment, got %d", rr.Code)
	}
}

func TestHandleCreateCommentTooLong(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	_, authorID, _ := seedIssueAndUsers(t)

	body, _ := json.Marshal(Comment{Body: strings.Repeat("a", MaxCommentLength+1)})
	req := ctxUser(httptest.NewRequest("POST", "/api/projects/1/issues/1/comments", bytes.NewBuffer(body)), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for over-long comment, got %d", rr.Code)
	}
}

func TestHandleCreateCommentArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	author := &User{Email: "a@test.com", FirstName: "A", LastName: "B", PasswordHash: "h", Role: RoleUser, Active: true}
	CreateUser(context.Background(), author)
	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	body, _ := json.Marshal(Comment{Body: "nope"})
	req := ctxUser(httptest.NewRequest("POST", "/api/projects/1/issues/1/comments", bytes.NewBuffer(body)), RoleUser, author.ID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 commenting on archived issue, got %d", rr.Code)
	}
}

func TestHandleUpdateCommentArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	author := &User{Email: "a@test.com", FirstName: "A", LastName: "B", PasswordHash: "h", Role: RoleUser, Active: true}
	CreateUser(context.Background(), author)
	issue := &Issue{Title: "Archived", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)
	c := &Comment{IssueID: issue.ID, UserID: &author.ID, Body: "orig"}
	CreateComment(context.Background(), c)
	issue.Status = StatusArchive
	if err := UpdateIssue(context.Background(), issue); err != nil {
		t.Fatalf("UpdateIssue: %v", err)
	}

	body, _ := json.Marshal(Comment{Body: "edited"})
	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/1/comments/1", bytes.NewBuffer(body)), RoleUser, author.ID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 editing a comment on an archived issue, got %d (%s)", rr.Code, rr.Body.String())
	}
	comments, _ := GetCommentsByIssueID(context.Background(), issue.ID)
	if comments[0].Body != "orig" {
		t.Errorf("comment should be unchanged, got %q", comments[0].Body)
	}
}

func TestHandleDeleteCommentArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	author := &User{Email: "a@test.com", FirstName: "A", LastName: "B", PasswordHash: "h", Role: RoleUser, Active: true}
	CreateUser(context.Background(), author)
	issue := &Issue{Title: "Archived", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)
	c := &Comment{IssueID: issue.ID, UserID: &author.ID, Body: "orig"}
	CreateComment(context.Background(), c)
	issue.Status = StatusArchive
	if err := UpdateIssue(context.Background(), issue); err != nil {
		t.Fatalf("UpdateIssue: %v", err)
	}

	req := ctxUser(httptest.NewRequest("DELETE", "/api/projects/1/issues/1/comments/1", nil), RoleUser, author.ID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 deleting a comment on an archived issue, got %d (%s)", rr.Code, rr.Body.String())
	}
	comments, _ := GetCommentsByIssueID(context.Background(), issue.ID)
	if len(comments) != 1 {
		t.Errorf("comment should still exist, got %d", len(comments))
	}
}

func TestHandleListCommentsOldestFirst(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, _ := seedIssueAndUsers(t)
	CreateComment(context.Background(), &Comment{IssueID: issueID, UserID: &authorID, Body: "first"})
	CreateComment(context.Background(), &Comment{IssueID: issueID, UserID: &authorID, Body: "second"})

	req := ctxUser(httptest.NewRequest("GET", "/api/projects/1/issues/1/comments", nil), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var got []Comment
	json.Unmarshal(rr.Body.Bytes(), &got)
	if len(got) != 2 || got[0].Body != "first" || got[1].Body != "second" {
		t.Errorf("expected oldest-first [first, second], got %+v", got)
	}
}

func TestHandleUpdateCommentByAuthor(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, _ := seedIssueAndUsers(t)
	c := &Comment{IssueID: issueID, UserID: &authorID, Body: "orig"}
	CreateComment(context.Background(), c)

	body, _ := json.Marshal(Comment{Body: "edited"})
	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/1/comments/1", bytes.NewBuffer(body)), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	var got Comment
	json.Unmarshal(rr.Body.Bytes(), &got)
	if got.Body != "edited" || !got.Edited {
		t.Errorf("expected edited comment flagged, got %+v", got)
	}
}

func TestHandleUpdateCommentByNonAuthorForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, otherID := seedIssueAndUsers(t)
	c := &Comment{IssueID: issueID, UserID: &authorID, Body: "orig"}
	CreateComment(context.Background(), c)

	body, _ := json.Marshal(Comment{Body: "hijack"})
	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/1/comments/1", bytes.NewBuffer(body)), RoleUser, otherID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for non-author edit, got %d", rr.Code)
	}
	comments, _ := GetCommentsByIssueID(context.Background(), issueID)
	if comments[0].Body != "orig" {
		t.Errorf("comment should be unchanged, got %q", comments[0].Body)
	}
}

func TestHandleUpdateCommentByAdminAny(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, _ := seedIssueAndUsers(t)
	admin := &User{Email: "admin@test.com", FirstName: "Ad", LastName: "Min", PasswordHash: "h", Role: RoleAdmin, Active: true}
	CreateUser(context.Background(), admin)
	c := &Comment{IssueID: issueID, UserID: &authorID, Body: "orig"}
	CreateComment(context.Background(), c)

	body, _ := json.Marshal(Comment{Body: "admin-edit"})
	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/1/comments/1", bytes.NewBuffer(body)), RoleAdmin, admin.ID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for admin edit, got %d", rr.Code)
	}
	comments, _ := GetCommentsByIssueID(context.Background(), issueID)
	if comments[0].Body != "admin-edit" {
		t.Errorf("expected admin edit to apply, got %q", comments[0].Body)
	}
}

func TestHandleDeleteCommentByAuthorAndAdmin(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, otherID := seedIssueAndUsers(t)
	admin := &User{Email: "admin@test.com", FirstName: "Ad", LastName: "Min", PasswordHash: "h", Role: RoleAdmin, Active: true}
	CreateUser(context.Background(), admin)
	CreateComment(context.Background(), &Comment{IssueID: issueID, UserID: &authorID, Body: "c1"})
	CreateComment(context.Background(), &Comment{IssueID: issueID, UserID: &authorID, Body: "c2"})

	// Non-author regular user cannot delete → 404, comment survives.
	req := ctxUser(httptest.NewRequest("DELETE", "/api/projects/1/issues/1/comments/1", nil), RoleUser, otherID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 non-author delete, got %d", rr.Code)
	}

	// Author deletes own → 204.
	req = ctxUser(httptest.NewRequest("DELETE", "/api/projects/1/issues/1/comments/1", nil), RoleUser, authorID)
	rr = httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204 author delete, got %d", rr.Code)
	}

	// Admin deletes another user's comment → 204.
	req = ctxUser(httptest.NewRequest("DELETE", "/api/projects/1/issues/1/comments/2", nil), RoleAdmin, admin.ID)
	rr = httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204 admin delete, got %d", rr.Code)
	}

	comments, _ := GetCommentsByIssueID(context.Background(), issueID)
	if len(comments) != 0 {
		t.Errorf("expected all comments deleted, got %d", len(comments))
	}
}

// TestCommentOwnership404 ensures a comment addressed through the wrong parent
// issue is indistinguishable from "not found".
func TestCommentOwnership404(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	_, authorID, _ := seedIssueAndUsers(t)
	// Second issue in the same project.
	issue2 := &Issue{Title: "Issue2", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue2)
	CreateComment(context.Background(), &Comment{IssueID: 1, UserID: &authorID, Body: "on issue 1"})

	// Try to edit comment 1 via issue 2's URL.
	body, _ := json.Marshal(Comment{Body: "x"})
	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/2/comments/1", bytes.NewBuffer(body)), RoleAdmin, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for wrong-issue comment, got %d", rr.Code)
	}
}

func TestGetCommentByIDNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issueID, authorID, _ := seedIssueAndUsers(t)
	CreateComment(context.Background(), &Comment{IssueID: issueID, UserID: &authorID, Body: "exists"})

	if _, err := GetCommentByID(context.Background(), 999, issueID); err != ErrCommentNotFound {
		t.Errorf("expected ErrCommentNotFound for missing id, got %v", err)
	}
	if _, err := GetCommentByID(context.Background(), 1, 999); err != ErrCommentNotFound {
		t.Errorf("expected ErrCommentNotFound for wrong issue_id, got %v", err)
	}
}

// --- History (audit trail) tests -------------------------------------------

func historyEvents(t *testing.T, issueID int) []HistoryEntry {
	t.Helper()
	h, err := GetHistoryByIssueID(context.Background(), issueID)
	if err != nil {
		t.Fatalf("GetHistoryByIssueID: %v", err)
	}
	return h
}

func TestHistoryOnCreateIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	actor := &User{Email: "actor@test.com", FirstName: "Anna", LastName: "Creator", PasswordHash: "h", Role: RoleAdmin, Active: true}
	if err := CreateUser(context.Background(), actor); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	body, _ := json.Marshal(Issue{Title: "New", Status: StatusOpen})
	req := ctxUser(httptest.NewRequest("POST", "/api/projects/1/issues", bytes.NewBuffer(body)), RoleAdmin, actor.ID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (%s)", rr.Code, rr.Body.String())
	}
	var created Issue
	json.Unmarshal(rr.Body.Bytes(), &created)

	h := historyEvents(t, created.ID)
	if len(h) != 1 || h[0].Event != EventCreated {
		t.Fatalf("expected one 'created' entry, got %+v", h)
	}
	// Verify actor attribution and hydration (the request context carries a real
	// user_id, so the recorded entry's user_id and joined User must be populated).
	if h[0].UserID == nil || *h[0].UserID != actor.ID {
		t.Errorf("expected UserID %d, got %+v", actor.ID, h[0].UserID)
	}
	if h[0].User == nil || h[0].User.FirstName != "Anna" || h[0].User.LastName != "Creator" {
		t.Errorf("expected hydrated actor Anna Creator, got %+v", h[0].User)
	}
}

func TestHistoryOnEditFields(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Orig", Description: "d1", Status: StatusOpen, Priority: PriorityNormal, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	// Change title, description, status and priority in one PUT.
	updated := Issue{Title: "Changed", Description: "d2", Status: StatusDone, Priority: PriorityHigh}
	body, _ := json.Marshal(updated)
	req := httptest.NewRequest("PUT", "/api/projects/1/issues/1", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}

	byField := map[string]ChangeData{}
	for _, e := range historyEvents(t, issue.ID) {
		if e.Event == EventUpdated {
			byField[e.Data.Field] = e.Data
		}
	}
	if len(byField) != 4 {
		t.Fatalf("expected 4 updated entries, got %d: %+v", len(byField), byField)
	}
	// Title/description carry no from/to.
	if byField["title"].From != "" || byField["title"].To != "" {
		t.Errorf("title entry should carry no from/to, got %+v", byField["title"])
	}
	if byField["description"].From != "" || byField["description"].To != "" {
		t.Errorf("description entry should carry no from/to, got %+v", byField["description"])
	}
	// Status/priority carry from/to.
	if byField["status"].From != string(StatusOpen) || byField["status"].To != string(StatusDone) {
		t.Errorf("unexpected status from/to: %+v", byField["status"])
	}
	if byField["priority"].From != string(PriorityNormal) || byField["priority"].To != string(PriorityHigh) {
		t.Errorf("unexpected priority from/to: %+v", byField["priority"])
	}
}

func TestHistoryNoEntryOnPureReorder(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Orig", Status: StatusOpen, Priority: PriorityNormal, Position: 1, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	// PUT identical content but a different position → only a reorder.
	updated := Issue{Title: "Orig", Status: StatusOpen, Priority: PriorityNormal, Position: 5}
	body, _ := json.Marshal(updated)
	req := httptest.NewRequest("PUT", "/api/projects/1/issues/1", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	for _, e := range historyEvents(t, issue.ID) {
		if e.Event == EventUpdated {
			t.Errorf("pure reorder should produce no updated entry, got %+v", e.Data)
		}
	}
}

func TestHistoryOnArchiveUnarchive(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Orig", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	post := func(url string) {
		req := httptest.NewRequest("POST", url, nil)
		req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
		rr := httptest.NewRecorder()
		testAPI.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s expected 200, got %d (%s)", url, rr.Code, rr.Body.String())
		}
	}
	post("/api/projects/1/issues/1/archive")
	post("/api/projects/1/issues/1/unarchive")

	var events []string
	for _, e := range historyEvents(t, issue.ID) {
		events = append(events, e.Event)
	}
	if !slices.Contains(events, EventArchived) || !slices.Contains(events, EventUnarchived) {
		t.Errorf("expected archived + unarchived events, got %v", events)
	}
}

// TestHistoryOnMove verifies the 'moved' event carries human-readable project
// names (not raw IDs), resolved at write time so the entry stays meaningful
// even if a project is later renamed.
func TestHistoryOnMove(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Orig", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	target := &Project{Name: "Target Project"}
	if err := CreateProject(context.Background(), target); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	adminHash, _ := HashPassword(testPassword)
	CreateUser(context.Background(), &User{Email: testAssigneeEmail, PasswordHash: adminHash, Active: true, Role: RoleAdmin})

	body, _ := json.Marshal(map[string]any{"new_project_id": target.ID, "admin_password": testPassword})
	req := httptest.NewRequest("POST", "/api/projects/1/issues/1/move", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}

	h := historyEvents(t, issue.ID)
	var moveEntry *HistoryEntry
	for i := range h {
		if h[i].Event == EventMoved {
			moveEntry = &h[i]
		}
	}
	if moveEntry == nil {
		t.Fatalf("expected a 'moved' entry, got %+v", h)
	}
	if moveEntry.Data.Field != "project" || moveEntry.Data.From != "default" || moveEntry.Data.To != "Target Project" {
		t.Errorf("expected moved from 'default' to 'Target Project', got %+v", moveEntry.Data)
	}
}

func TestHistoryOnTaskChanges(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Orig", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	// Add a task.
	body, _ := json.Marshal(Task{Title: "Foo"})
	req := httptest.NewRequest("POST", "/api/projects/1/issues/1/tasks", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("add task expected 201, got %d", rr.Code)
	}

	// Complete the task.
	body, _ = json.Marshal(Task{Title: "Foo", Done: true})
	req = httptest.NewRequest("PUT", "/api/projects/1/issues/1/tasks/1", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("complete task expected 200, got %d", rr.Code)
	}

	var taskDetails []string
	for _, e := range historyEvents(t, issue.ID) {
		if e.Event == EventTask {
			taskDetails = append(taskDetails, e.Data.Detail)
		}
	}
	if len(taskDetails) != 2 {
		t.Fatalf("expected 2 task history entries, got %d: %v", len(taskDetails), taskDetails)
	}
	if taskDetails[0] != "Task: Added 'Foo'" || taskDetails[1] != "Task: Completed 'Foo'" {
		t.Errorf("unexpected task details: %v", taskDetails)
	}
}

// TestHandleListHistoryGet covers the handleListHistory HTTP handler end to end;
// existing history tests only exercise GetHistoryByIssueID directly at the DB layer.
func TestHandleListHistoryGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create via the HTTP handler (not the direct DB helper) so the "created"
	// history entry is actually recorded.
	body, _ := json.Marshal(Issue{Title: "Issue", Status: StatusOpen})
	createReq := httptest.NewRequest("POST", "/api/projects/1/issues", bytes.NewBuffer(body))
	createReq = createReq.WithContext(context.WithValue(createReq.Context(), contextKeyRole, RoleAdmin))
	createRR := httptest.NewRecorder()
	testAPI.ServeHTTP(createRR, createReq)
	if createRR.Code != http.StatusCreated {
		t.Fatalf("create issue: expected 201, got %d (%s)", createRR.Code, createRR.Body.String())
	}

	req := httptest.NewRequest("GET", "/api/projects/1/issues/1/history", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rr.Code, rr.Body.String())
	}
	var got []HistoryEntry
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Event != EventCreated {
		t.Fatalf("expected one 'created' entry, got %+v", got)
	}
}

func TestHandlePutCommentInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	_, authorID, _ := seedIssueAndUsers(t)

	req := ctxUser(httptest.NewRequest("PUT", "/api/projects/1/issues/1/comments/1", bytes.NewBufferString(invalidJSON)), RoleUser, authorID)
	rr := httptest.NewRecorder()
	testAPI.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid JSON body, got %d", rr.Code)
	}
}

// TestHandleActivityDBErrors covers the "generic DB error → 500" branch of each
// history/comment handler. A whole-DB closed-connection swap (as used elsewhere
// in this package) doesn't reach these branches here: history/comments are
// nested under an issue, so withIssue/withIssueResource first call
// checkProjectAccess and GetIssueByIDInProject, which would themselves fail
// first on a fully closed DB — the handler body would never run. Instead, only
// the issue_history / issue_comments table is dropped, leaving projects/
// issues/tasks intact so the factory succeeds and the handler's own query fails.
func TestHandleActivityDBErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	tests := []struct {
		name      string
		dropTable string
		method    string
		url       string
		body      []byte
	}{
		{"ListHistory", "issue_history", "GET", "/api/projects/1/issues/1/history", nil},
		{"ListComments", "issue_comments", "GET", "/api/projects/1/issues/1/comments", nil},
		{"CreateComment", "issue_comments", "POST", "/api/projects/1/issues/1/comments", mustMarshal(Comment{Body: "x"})},
		{"UpdateComment", "issue_comments", "PUT", "/api/projects/1/issues/1/comments/1", mustMarshal(Comment{Body: "x"})},
		{"DeleteComment", "issue_comments", "DELETE", "/api/projects/1/issues/1/comments/1", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := DB.Exec("DROP TABLE " + tt.dropTable); err != nil {
				t.Fatalf("drop %s: %v", tt.dropTable, err)
			}
			// Recreate immediately after each subtest so later subtests (and any
			// other table) are unaffected.
			defer createActivityTables(context.Background())

			req := httptest.NewRequest(tt.method, tt.url, bytes.NewBuffer(tt.body))
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
			rr := httptest.NewRecorder()
			testAPI.ServeHTTP(rr, req)

			if rr.Code != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d (%s)", rr.Code, rr.Body.String())
			}
		})
	}
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
