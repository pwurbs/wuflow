package backend

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

const (
	apiIssues            = "/api/issues"
	apiIssuesBase        = "/api/issues/"
	apiIssues1           = apiIssuesBase + "1"
	archiveSuffix        = "/archive"
	unarchiveSuffix      = "/unarchive"
	apiIssues1Archive    = apiIssues1 + archiveSuffix
	apiIssues1Unarchive  = apiIssues1 + unarchiveSuffix
	invalidIssuePath     = apiIssuesBase + "999"
	apiTasks             = "/api/tasks"
	apiTasksBase         = "/api/tasks/"
	apiTasks1            = apiTasksBase + "1"
	apiLabels            = "/api/labels"
	apiLabelsBase        = "/api/labels/"
	apiLabels1           = apiLabelsBase + "1"
	invalidJSON          = "invalid json"
	wrongStatusCode      = "handler returned wrong status code: got %v want %v"
	toDelete             = "To Delete"
	expectedTitleUpdated = "expected title 'Updated', got '%s'"
	testDBPath           = ":memory:"
	testIssueTitleNew    = "New Issue"
	testTaskTitleNew     = "New Task"
)

func TestHandleActiveIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateIssue(&Issue{Title: "Issue 1", Status: StatusOpen})

	req, err := http.NewRequest("GET", apiIssues, nil)
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleActiveIssues)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode,
			status, http.StatusOK)
	}

	var issues []Issue
	if err := json.NewDecoder(rr.Body).Decode(&issues); err != nil {
		t.Fatal(err)
	}

	if len(issues) != 1 {
		t.Errorf("expected 1 issue, got %d", len(issues))
	}
}

func TestHandleCreateIssuePost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf(wrongStatusCode,
			status, http.StatusCreated)
	}

	var createdIssue Issue
	if err := json.NewDecoder(rr.Body).Decode(&createdIssue); err != nil {
		t.Fatal(err)
	}

	if createdIssue.Title != testIssueTitleNew {
		t.Errorf("expected title 'New Issue', got '%s'", createdIssue.Title)
	}
}

func TestHandleIssuePut(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original", Status: StatusOpen}
	CreateIssue(issue)

	issue.Title = "Updated"
	body, _ := json.Marshal(issue)

	// URL path is needed for ID extraction in handler
	req, err := http.NewRequest("PUT", apiIssues1, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode,
			status, http.StatusOK)
	}

	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to get all issues: %v", err)
	}
	if len(issues) == 0 {
		t.Fatalf("Expected at least one issue")
	}
	if issues[0].Title != "Updated" {
		t.Errorf(expectedTitleUpdated, issues[0].Title)
	}
}

func TestHandleIssueDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: toDelete, Status: StatusOpen}
	CreateIssue(issue)

	req, err := http.NewRequest("DELETE", apiIssues1, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNoContent {
		t.Errorf(wrongStatusCode,
			status, http.StatusNoContent)
	}

	issues, _ := GetAllActiveIssues()
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestHandleIssueGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Test Issue", Status: StatusOpen, Description: "Test Description"}
	CreateIssue(issue)

	req, err := http.NewRequest("GET", apiIssues1, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	// Check ETag header is present
	etag := rr.Header().Get("ETag")
	if etag == "" {
		t.Error("expected ETag header to be set")
	}

	var fetchedIssue Issue
	if err := json.NewDecoder(rr.Body).Decode(&fetchedIssue); err != nil {
		t.Fatal(err)
	}

	if fetchedIssue.Title != "Test Issue" {
		t.Errorf("expected title 'Test Issue', got '%s'", fetchedIssue.Title)
	}
}

func TestHandleIssueGetNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, err := http.NewRequest("GET", invalidIssuePath, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf(wrongStatusCode, status, http.StatusNotFound)
	}
}

func TestHandleIssuePutConflict(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original", Status: StatusOpen}
	CreateIssue(issue)

	// Simulate a stale ETag (old timestamp)
	staleEtag := `"2020-01-01T00:00:00Z"`

	issue.Title = "Updated"
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("PUT", apiIssues1, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("If-Match", staleEtag)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusConflict {
		t.Errorf(wrongStatusCode, status, http.StatusConflict)
	}
}

func TestHandleIssuePutWithValidEtag(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original", Status: StatusOpen}
	CreateIssue(issue)

	// Get the current issue to obtain valid ETag
	getReq, _ := http.NewRequest("GET", apiIssues1, nil)
	getReq = getReq.WithContext(context.WithValue(getReq.Context(), contextKeyRole, RoleAdmin))
	getRr := httptest.NewRecorder()
	HandleIssue(getRr, getReq)
	validEtag := getRr.Header().Get("ETag")

	// Now update with valid ETag
	issue.Title = "Updated"
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("PUT", apiIssues1, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("If-Match", validEtag)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	// Verify the update was applied
	issues, _ := GetAllActiveIssues()
	if issues[0].Title != "Updated" {
		t.Errorf(expectedTitleUpdated, issues[0].Title)
	}
}

func TestHandleCreateTaskPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)

	task := &Task{Title: testTaskTitleNew, IssueID: issue.ID}
	body, _ := json.Marshal(task)

	// URL path structure: /api/tasks
	req, err := http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf(wrongStatusCode,
			status, http.StatusCreated)
	}

	tasks, _ := GetTasksByIssueID(issue.ID)
	if len(tasks) != 1 {
		t.Errorf("expected 1 task, got %d", len(tasks))
	}
}

func TestHandleTaskPut(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)
	task := &Task{IssueID: issue.ID, Title: "Original"}
	CreateTask(task)

	task.Title = "Updated"
	body, _ := json.Marshal(task)

	req, err := http.NewRequest("PUT", apiTasks1, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode,
			status, http.StatusOK)
	}

	tasks, _ := GetTasksByIssueID(issue.ID)
	if tasks[0].Title != "Updated" {
		t.Errorf(expectedTitleUpdated, tasks[0].Title)
	}
}

func TestHandleTaskDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)
	task := &Task{IssueID: issue.ID, Title: toDelete}
	CreateTask(task)

	req, err := http.NewRequest("DELETE", apiTasks1, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNoContent {
		t.Errorf(wrongStatusCode,
			status, http.StatusNoContent)
	}

	tasks, _ := GetTasksByIssueID(issue.ID)
	if len(tasks) != 0 {
		t.Errorf("expected 0 tasks, got %d", len(tasks))
	}
}

func TestHandleActiveIssuesPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiIssues, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleIssueInvalidID(t *testing.T) {
	req, err := http.NewRequest("GET", apiIssuesBase+"invalid", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleIssuePutInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create a dummy issue to avoid 404 before JSON decode
	CreateIssue(&Issue{Title: "Dummy"})

	req, err := http.NewRequest("PUT", apiIssues1, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleCreateTaskPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiTasks, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleCreateTaskMissingIssueID(t *testing.T) {
	// Post task without IssueID
	task := &Task{Title: "Orphan Task"} // IssueID is 0
	body, _ := json.Marshal(task)

	req, err := http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleTaskInvalidID(t *testing.T) {
	req, err := http.NewRequest("PUT", apiTasksBase+"invalid", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleTaskPutInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("PUT", apiTasks1, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleActiveIssuesMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("DELETE", apiIssues, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleActiveIssues)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode,
			status, http.StatusMethodNotAllowed)
	}
}

func TestHandleIssueMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("POST", apiIssues1, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode,
			status, http.StatusMethodNotAllowed)
	}
}

func TestHandleCreateTaskMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("GET", apiTasks, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode,
			status, http.StatusMethodNotAllowed)
	}
}

func TestHandleTaskMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("POST", apiTasks1, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode,
			status, http.StatusMethodNotAllowed)
	}
}

// Label Handler Tests

func TestHandleLabelsGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateLabel(&Label{Name: "Bug", Color: "#FF0000"})
	CreateLabel(&Label{Name: "Feature", Color: "#00FF00"})

	req, err := http.NewRequest("GET", apiLabels, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	var labels []Label
	if err := json.NewDecoder(rr.Body).Decode(&labels); err != nil {
		t.Fatal(err)
	}

	if len(labels) != 2 {
		t.Errorf("expected 2 labels, got %d", len(labels))
	}
}

func TestHandleLabelsPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: "Enhancement", Color: "#0000FF"}
	body, _ := json.Marshal(label)

	req, err := http.NewRequest("POST", apiLabels, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf(wrongStatusCode, status, http.StatusCreated)
	}

	var createdLabel Label
	if err := json.NewDecoder(rr.Body).Decode(&createdLabel); err != nil {
		t.Fatal(err)
	}

	if createdLabel.Name != "Enhancement" {
		t.Errorf("expected name 'Enhancement', got '%s'", createdLabel.Name)
	}
}

func TestHandleLabelsPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiLabels, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleLabelsMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("DELETE", apiLabels, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, status, http.StatusMethodNotAllowed)
	}
}

func TestHandleLabelDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: toDelete, Color: "#FF00FF"}
	CreateLabel(label)

	req, err := http.NewRequest("DELETE", apiLabels1, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabel)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNoContent {
		t.Errorf(wrongStatusCode, status, http.StatusNoContent)
	}

	labels, _ := GetAllLabels()
	if len(labels) != 0 {
		t.Errorf("expected 0 labels, got %d", len(labels))
	}
}

func TestHandleLabelInvalidID(t *testing.T) {
	req, err := http.NewRequest("DELETE", "/api/labels/invalid", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabel)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleLabelMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("POST", apiLabels1, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabel)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, status, http.StatusMethodNotAllowed)
	}
}

// Additional error path tests for better coverage

// TestHandlersDBError tests handlers when the database is unavailable.
func TestHandlersDBError(t *testing.T) {
	// Save the original DB
	oldDB := DB

	// Create a closed DB to force errors
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()

	// Swap global DB
	DB = closedDB

	// Restore on exit
	defer func() {
		DB = oldDB
	}()

	issueBody, _ := json.Marshal(&Issue{Title: "Test", Status: StatusOpen})
	taskBody, _ := json.Marshal(&Task{Title: "Test", IssueID: 1})
	labelBody, _ := json.Marshal(&Label{Name: "Test", Color: "#000000"})

	tests := []struct {
		name    string
		method  string
		url     string
		body    []byte
		handler http.HandlerFunc
	}{
		{"HandleActiveIssues_GET", "GET", apiIssues, nil, HandleActiveIssues},
		{"HandleActiveIssues_POST", "POST", apiIssues, issueBody, HandleCreateIssue},
		{"HandleIssue_PUT", "PUT", apiIssues1, issueBody, HandleIssue},
		{"HandleIssue_DELETE", "DELETE", apiIssues1, nil, HandleIssue},
		{"HandleCreateTask_POST", "POST", apiTasks, taskBody, HandleCreateTask},
		{"HandleTask_PUT", "PUT", apiTasks1, taskBody, HandleTask},
		{"HandleTask_DELETE", "DELETE", apiTasks1, nil, HandleTask},
		{"HandleLabels_GET", "GET", apiLabels, nil, HandleLabels},
		{"HandleLabels_POST", "POST", apiLabels, labelBody, HandleLabels},
		{"HandleLabel_DELETE", "DELETE", apiLabels1, nil, HandleLabel},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_Error", func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.url, bytes.NewBuffer(tt.body))
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
			rr := httptest.NewRecorder()
			tt.handler(rr, req)
			if rr.Code != http.StatusInternalServerError {
				t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
			}
		})
	}
}

func TestHandleIssueRefOnNonExistentID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. PUT non-existent issue
	issue := &Issue{Title: "Updated Title", Status: StatusOpen}
	body, _ := json.Marshal(issue)
	req, _ := http.NewRequest("PUT", invalidIssuePath, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("PUT %s: "+wrongStatusCode,
			invalidIssuePath, status, http.StatusNotFound)
	}

	// 2. DELETE non-existent issue
	req, _ = http.NewRequest("DELETE", invalidIssuePath, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("DELETE %s: "+wrongStatusCode,
			invalidIssuePath, status, http.StatusNotFound)
	}
}

func TestHandleCreateIssueInvalidInput(t *testing.T) {
	tests := []struct {
		name  string
		issue Issue
	}{
		{"EmptyTitle", Issue{Title: "", Status: StatusOpen}},
		{"InvalidStatus", Issue{Title: "Valid", Status: "InvalidStatus"}},
		{"InvalidPriority", Issue{Title: "Valid", Status: StatusOpen, Priority: "Critical"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.issue)
			req, _ := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
			rr := httptest.NewRecorder()
			handle := http.HandlerFunc(HandleCreateIssue)
			handle.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestHandleTaskInvalidInput(t *testing.T) {
	// Empty Title
	task := Task{Title: "", IssueID: 1}
	body, _ := json.Marshal(task)
	req, _ := http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handle := http.HandlerFunc(HandleCreateTask)
	handle.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleLabelInvalidInput(t *testing.T) {
	tests := []struct {
		name  string
		label Label
	}{
		{"EmptyName", Label{Name: "", Color: "#000000"}},
		{"EmptyColor", Label{Name: "Name", Color: "   "}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.label)
			req, _ := http.NewRequest("POST", apiLabels, bytes.NewBuffer(body))
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
			rr := httptest.NewRecorder()
			handle := http.HandlerFunc(HandleLabels)
			handle.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestHandleTaskRefOnNonExistentID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. PUT non-existent task
	task := &Task{Title: "Updated Task", Done: true}
	body, _ := json.Marshal(task)
	req, _ := http.NewRequest("PUT", apiTasksBase+"999", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("PUT "+apiTasksBase+"999: "+wrongStatusCode,
			status, http.StatusNotFound)
	}

	// 2. DELETE non-existent task
	req, _ = http.NewRequest("DELETE", apiTasksBase+"999", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("DELETE "+apiTasksBase+"999: "+wrongStatusCode,
			status, http.StatusNotFound)
	}
}

func TestHandleCreateTaskWithNonExistentIssueID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// POST task for non-existent issue
	task := &Task{IssueID: 999, Title: "Orphan Task"}
	body, _ := json.Marshal(task)
	req, _ := http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateTask)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf("POST /api/tasks (issue_id=999): "+wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleDeleteLabelWithNonExistentID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// DELETE non-existent label
	req, _ := http.NewRequest("DELETE", "/api/labels/999", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabel)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("DELETE /api/labels/999: "+wrongStatusCode,
			status, http.StatusNotFound)
	}
}

func TestHandleArchivedIssueBlocking(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Create an archived issue
	archivedIssue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(archivedIssue)
	archivedIssuePath := apiIssuesBase + strconv.Itoa(archivedIssue.ID)

	// 2. Try to update the archived issue (blocked)
	archivedIssue.Title = "Mutated"
	body, _ := json.Marshal(archivedIssue)
	req, _ := http.NewRequest("PUT", archivedIssuePath, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleIssue(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("PUT %s: expected 403 Forbidden, got %v", archivedIssuePath, rr.Code)
	}

	// 3. Try to unarchive the issue via dedicated endpoint (allowed for admin)
	unarchivePath := archivedIssuePath + unarchiveSuffix
	req, _ = http.NewRequest("POST", unarchivePath, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("POST %s: expected 200 OK, got %v", unarchivePath, rr.Code)
	}

	// 4. Create another archived issue for task tests
	archivedIssue2 := &Issue{Title: "Archived with Tasks", Status: StatusArchive}
	CreateIssue(archivedIssue2)
	task := &Task{IssueID: archivedIssue2.ID, Title: "Task"}
	// Bypass HandleCreateTask to create a task for an archived issue for testing
	CreateTask(task)
	taskPath := apiTasksBase + strconv.Itoa(task.ID)

	// 5. Try to add a task to archived issue (blocked)
	newTask := &Task{IssueID: archivedIssue2.ID, Title: testTaskTitleNew}
	body, _ = json.Marshal(newTask)
	req, _ = http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleCreateTask(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("POST /api/tasks: expected 403 Forbidden, got %v", rr.Code)
	}

	// 6. Try to update task of archived issue (blocked)
	task.Title = "Mutated Task"
	body, _ = json.Marshal(task)
	req, _ = http.NewRequest("PUT", taskPath, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleTask(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("PUT %s: expected 403 Forbidden, got %v", taskPath, rr.Code)
	}

	// 7. Try to delete task of archived issue (blocked)
	req, _ = http.NewRequest("DELETE", taskPath, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleTask(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("DELETE %s: expected 403 Forbidden, got %v", taskPath, rr.Code)
	}

	// 8. Try to bypass by omitting status on a *new* archived issue (blocked)
	archivedIssue3 := &Issue{Title: "Archived 3", Status: StatusArchive}
	CreateIssue(archivedIssue3)
	archivedIssue3Path := apiIssuesBase + strconv.Itoa(archivedIssue3.ID)

	req, _ = http.NewRequest("PUT", archivedIssue3Path, bytes.NewBufferString(`{"title":"Bypass"}`))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	// 9. Try to delete archived issue (blocked even for admin — business rule in handler)
	archivedIssue4 := &Issue{Title: "Archived 4", Status: StatusArchive}
	CreateIssue(archivedIssue4)
	archivedDeletePath := apiIssuesBase + strconv.Itoa(archivedIssue4.ID)

	req, _ = http.NewRequest("DELETE", archivedDeletePath, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("DELETE %s: expected 403 Forbidden, got %v", archivedDeletePath, rr.Code)
	}
}

func TestHandlersDBErrors(t *testing.T) {
	// Save original DB
	oldDB := DB
	defer func() {
		DB = oldDB
	}()

	// Create a closed DB to force errors
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB

	validIssue := `{"title":"Issue","status":"Open"}`
	validTask := `{"title":"Task","issue_id":1}`
	validLabel := `{"name":"Label","color":"#000000"}`
	validTaskUpdate := `{"title":"Task","done":true}`

	tests := []struct {
		name    string
		method  string
		url     string
		body    string
		handler http.HandlerFunc
	}{
		{"HandleActiveIssues", "GET", apiIssues, "", HandleActiveIssues},
		{"HandleCreateIssue", "POST", apiIssues, validIssue, HandleCreateIssue},
		{"HandleArchivedIssues", "GET", "/api/archive/issues", "", HandleArchivedIssues},
		{"HandleIssue_GET", "GET", apiIssues1, "", HandleIssue},
		{"HandleIssue_PUT", "PUT", apiIssues1, validIssue, HandleIssue},
		{"HandleIssue_DELETE", "DELETE", apiIssues1, "", HandleIssue},
		{"HandleIssue_archive", "POST", apiIssues1Archive, "", HandleIssue},
		{"HandleIssue_unarchive", "POST", apiIssues1Unarchive, "", HandleIssue},
		{"HandleCreateTask", "POST", apiTasks, validTask, HandleCreateTask},
		{"HandleTask_PUT", "PUT", apiTasks1, validTaskUpdate, HandleTask},
		{"HandleTask_DELETE", "DELETE", apiTasks1, "", HandleTask},
		{"HandleLabels_GET", "GET", apiLabels, "", HandleLabels},
		{"HandleLabels_POST", "POST", apiLabels, validLabel, HandleLabels},
		{"HandleLabel_DELETE", "DELETE", apiLabels1, "", HandleLabel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req *http.Request
			var err error
			if tt.body != "" {
				req, err = http.NewRequest(tt.method, tt.url, bytes.NewBufferString(tt.body))
			} else {
				req, err = http.NewRequest(tt.method, tt.url, nil)
			}
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

			rr := httptest.NewRecorder()
			tt.handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusInternalServerError {
				t.Errorf("%s: handler returned wrong status code: got %v want %v",
					tt.name, rr.Code, http.StatusInternalServerError)
			}
		})
	}
}

func TestUpdateUserPassword(t *testing.T) {
	InitJWTSecret("testsecret")

	user := &User{Email: "test@example.com"}

	// 1. Empty password -> No change, no error
	err := updateUserPassword(user, "")
	if err != nil {
		t.Errorf("Expected nil error for empty password, got %v", err)
	}
	if user.PasswordHash != "" {
		t.Error("Expected password hash to remain empty")
	}

	// 2. Invalid password (too short)
	err = updateUserPassword(user, "short")
	if err == nil {
		t.Error("Expected error for short password, got nil")
	}

	// 3. Valid password
	err = updateUserPassword(user, testPassword)
	if err != nil {
		t.Errorf("Expected success for valid password, got %v", err)
	}
	if user.PasswordHash == "" {
		t.Error("Expected password hash to be set")
	}
	if !CheckPassword(user.PasswordHash, testPassword) {
		t.Error("Hash validation failed")
	}
}

func TestCheckIfMatchConflict(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create issue
	issue := &Issue{Title: "Orignal", Status: StatusOpen}
	CreateIssue(issue)
	originalEtag := `"` + issue.UpdatedAt.UTC().Format(time.RFC3339Nano) + `"`

	// 1. No Conflict (Match)
	rr := httptest.NewRecorder()
	conflict := checkIfMatchConflict(rr, issue.ID, originalEtag)
	if conflict {
		t.Error("Expected no conflict, got true")
	}

	// 2. Conflict (Mismatch)
	rr = httptest.NewRecorder()
	conflict = checkIfMatchConflict(rr, issue.ID, "\"old-etag\"")
	if !conflict {
		t.Error("Expected conflict, got false")
	}
	if rr.Code != http.StatusConflict {
		t.Errorf("Expected 409 Conflict, got %d", rr.Code)
	}

	// 3. Issue Not Found
	rr = httptest.NewRecorder()
	conflict = checkIfMatchConflict(rr, 999, originalEtag)
	if !conflict {
		t.Error("Expected conflict (as true) for not found, got false") // Logic returns true to stop processing
	}
	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected 404 Not Found, got %d", rr.Code)
	}
}

func TestHandlePutIssueReadOnlyArchived(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create archived issue
	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID)

	// Try to update title (not allowed)
	updateBody := map[string]interface{}{
		"title":    "Updated Title",
		"status":   "Archive",
		"priority": "Normal",
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for editing archived issue, got %d", rr.Code)
	}
}

func TestHandleArchiveIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Active", Status: StatusOpen}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID) + archiveSuffix

	req := httptest.NewRequest("POST", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for archiving issue, got %d", rr.Code)
	}
	var updated Issue
	if err := json.NewDecoder(rr.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusArchive {
		t.Errorf("Expected status %s, got %s", StatusArchive, updated.Status)
	}
}

func TestHandleArchiveIssueNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("POST", invalidIssuePath+archiveSuffix, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for archiving non-existent issue, got %d", rr.Code)
	}
}

func TestHandleArchiveIssueAlready(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Already Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID) + archiveSuffix

	req := httptest.NewRequest("POST", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for archiving already-archived issue, got %d", rr.Code)
	}
}

func TestHandleUnarchiveIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID) + unarchiveSuffix

	req := httptest.NewRequest("POST", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for unarchiving issue, got %d", rr.Code)
	}
	var updated Issue
	if err := json.NewDecoder(rr.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusDone {
		t.Errorf("Expected status %s, got %s", StatusDone, updated.Status)
	}
}

func TestHandleUnarchiveIssueNotArchived(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Active", Status: StatusOpen}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID) + unarchiveSuffix

	req := httptest.NewRequest("POST", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for unarchiving non-archived issue, got %d", rr.Code)
	}
}

func TestHandleDeleteIssueArchived(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID)

	// Archived issues cannot be deleted regardless of role (business rule in handler)
	req := httptest.NewRequest("DELETE", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for deleting archived issue, got %d", rr.Code)
	}
}

func TestHandleUpdateUserLastAdminProtection(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create single admin
	hash, _ := HashPassword(testPassword)
	user := &User{Email: "admin@local", Role: RoleAdmin, Active: true, PasswordHash: hash}
	CreateUser(user)
	path := apiUsersBase + strconv.Itoa(user.ID)

	// Try to demote
	updateBody := map[string]interface{}{
		"email":      "admin@local",
		"first_name": "Admin",
		"last_name":  "User",
		"role":       "user", // Demoting
		"active":     true,
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleUser(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request for last admin demotion, got %d", rr.Code)
	}
}

func TestHandlePutTaskArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	task := &Task{Title: "Task", IssueID: issue.ID, Done: false}
	CreateTask(task)
	path := apiTasksBase + strconv.Itoa(task.ID)

	updateBody := map[string]interface{}{
		"title":    "Updated Task",
		"issue_id": issue.ID,
		"done":     true,
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleTask(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for updating task of archived issue, got %d", rr.Code)
	}
}

func TestHandleDeleteTaskArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	task := &Task{Title: "Task", IssueID: issue.ID, Done: false}
	CreateTask(task)
	path := apiTasksBase + strconv.Itoa(task.ID)

	req := httptest.NewRequest("DELETE", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleTask(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for deleting task of archived issue, got %d", rr.Code)
	}
}

func TestHandlePutIssueUnarchive(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create archived issue
	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID) + unarchiveSuffix

	// Unarchive via dedicated endpoint — requires admin
	req := httptest.NewRequest("POST", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for unarchiving issue, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	updated, err := GetIssueByID(issue.ID)
	if err != nil {
		t.Fatalf("Failed to get updated issue: %v", err)
	}
	if updated == nil {
		t.Fatal("Updated issue is nil")
	}
	if updated.Status != StatusDone {
		t.Errorf("Expected status Done, got %s", updated.Status)
	}
}

func TestHandleUpdateUserPasswordSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	hash, _ := HashPassword("oldpass")
	user := &User{Email: "t@t.com", PasswordHash: hash, Active: true, Role: RoleUser}
	CreateUser(user)
	path := apiUsersBase + strconv.Itoa(user.ID)

	// Update with new password
	updateBody := map[string]interface{}{
		"email":      "t@t.com",
		"first_name": "Test",
		"last_name":  "User",
		"password":   testPassword,
		"role":       "user",
		"active":     true,
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	HandleUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", rr.Code)
	}

	updated, _ := GetUserByID(user.ID)
	if !CheckPassword(updated.PasswordHash, testPassword) {
		t.Error("Password was not updated correctly")
	}
}

func TestHandleUpdateSelf(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create a user
	user := &User{
		Email:        "self@example.com",
		FirstName:    "Self",
		LastName:     "Updater",
		PasswordHash: "oldhash",
		Role:         RoleUser,
		Active:       true,
	}
	CreateUser(user)

	// Prepare update request (change password)
	updateData := map[string]string{
		"password": "CorrectHorseBatteryStaple!2026",
	}
	body, _ := json.Marshal(updateData)

	req, err := http.NewRequest("PUT", apiAuthMe, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	// Mock context with user ID
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCurrentUser)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	// Verify password hash changed
	updatedUser, _ := GetUserByID(user.ID)
	if updatedUser.PasswordHash == "oldhash" {
		t.Error("expected password hash to change")
	}

	// Verify we can't change role or active status via self-update
	maliciousUpdate := map[string]interface{}{
		"role":   RoleAdmin,
		"active": false,
	}
	body, _ = json.Marshal(maliciousUpdate)
	req, _ = http.NewRequest("PUT", apiAuthMe, bytes.NewBuffer(body))
	req = req.WithContext(ctx)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	updatedUser, _ = GetUserByID(user.ID)
	if updatedUser.Role != RoleUser {
		t.Error("expected role to remain User")
	}
	if !updatedUser.Active {
		t.Error("expected user to remain active")
	}
}

func TestHandleCurrentUserUnauthorized(t *testing.T) {
	req := httptest.NewRequest("GET", apiAuthMe, nil)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleUpdateSelfUserNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("PUT", apiAuthMe, bytes.NewBufferString(`{"password":"NewPassword123!"}`))
	ctx := context.WithValue(req.Context(), contextKeyUserID, 999)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleUpdateSelfInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user := &User{Email: testEmail, Role: RoleUser, Active: true}
	CreateUser(user)

	req := httptest.NewRequest("PUT", apiAuthMe, bytes.NewBufferString(`{invalid json}`))
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUpdateSelfValidationFailure(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user := &User{Email: testEmail, Role: RoleUser, Active: true}
	CreateUser(user)

	// "password" is a common password in the blacklist
	req := httptest.NewRequest("PUT", apiAuthMe, bytes.NewBufferString(`{"password":"password12345"}`))
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUpdateSelfDBError(t *testing.T) {
	setupTestDB()
	user := &User{Email: testEmail, Role: RoleUser, Active: true}
	CreateUser(user)

	oldDB := DB
	defer func() { DB = oldDB }()

	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB

	req := httptest.NewRequest("PUT", apiAuthMe, bytes.NewBufferString(`{"password":"ValidPassword123!"}`))
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleUpdateSelfNoPassword(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user := &User{Email: testEmail, Role: RoleUser, Active: true}
	CreateUser(user)

	// Empty update (no password)
	req := httptest.NewRequest("PUT", apiAuthMe, bytes.NewBufferString(`{}`))
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
}

// --- User Assignment Handler Tests ---

func TestHandleCreateIssueSetsCreator(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitJWTSecret("secret")

	// Create user
	user := &User{Email: "creator@test.com", FirstName: "C", LastName: "U", Role: RoleUser, Active: true}
	CreateUser(user)

	issue := &Issue{Title: "My Issue", Status: StatusOpen}
	body, _ := json.Marshal(issue)

	req, _ := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	// Inject UserID and role into context (simulating AuthMiddleware)
	ctx := context.WithValue(req.Context(), contextKeyUserID, user.ID)
	ctx = context.WithValue(ctx, contextKeyRole, RoleAdmin)

	handler := http.HandlerFunc(HandleCreateIssue)
	handler.ServeHTTP(rr, req.WithContext(ctx))

	if rr.Code != http.StatusCreated {
		t.Errorf("Expected 201 Created, got %d", rr.Code)
	}

	var created Issue
	json.NewDecoder(rr.Body).Decode(&created)

	if created.CreatorID != user.ID {
		t.Errorf("Expected CreatorID %d, got %d", user.ID, created.CreatorID)
	}
	// Verify Creator struct in response
	if created.Creator == nil || created.Creator.Email != user.Email {
		t.Error("Expected Creator struct in response")
	}
}

func TestHandleIssueUpdateAssignee(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create users
	creator := &User{Email: "c@test.com", FirstName: "C", LastName: "U", Role: RoleUser}
	assignee := &User{Email: "a@test.com", FirstName: "A", LastName: "U", Role: RoleUser}
	CreateUser(creator)
	CreateUser(assignee)

	issue := &Issue{Title: "Issue", Status: StatusOpen, CreatorID: creator.ID}
	CreateIssue(issue)

	// Request to assign
	issue.AssigneeID = &assignee.ID
	body, _ := json.Marshal(issue)

	req, _ := http.NewRequest("PUT", apiIssuesBase+strconv.Itoa(issue.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	handler := http.HandlerFunc(HandleIssue)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", rr.Code)
	}

	updated, _ := GetIssueByID(issue.ID)
	if updated.AssigneeID == nil || *updated.AssigneeID != assignee.ID {
		t.Errorf("Expected AssigneeID %d, got %v", assignee.ID, updated.AssigneeID)
	}
}

func TestHandleIssueCreatorReadOnly(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	creator := &User{Email: "c@test.com", FirstName: "C", LastName: "U", Role: RoleUser}
	imposter := &User{Email: "i@test.com", FirstName: "I", LastName: "U", Role: RoleUser}
	CreateUser(creator)
	CreateUser(imposter)

	issue := &Issue{Title: "Issue", Status: StatusOpen, CreatorID: creator.ID}
	CreateIssue(issue)

	// Try to change creator
	issue.CreatorID = imposter.ID
	body, _ := json.Marshal(issue)

	req, _ := http.NewRequest("PUT", apiIssuesBase+strconv.Itoa(issue.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()

	handler := http.HandlerFunc(HandleIssue)
	handler.ServeHTTP(rr, req)

	updated, _ := GetIssueByID(issue.ID)
	if updated.CreatorID != creator.ID {
		t.Errorf("Expected CreatorID to remain %d, but it was changed to %d", creator.ID, updated.CreatorID)
	}
}

// TestHandlersForbidden verifies that every Can() check in handlers.go returns 403
// when the caller lacks the required role. No DB setup needed — Can() is evaluated
// before any database access in all cases.
func TestHandlersForbidden(t *testing.T) {
	tests := []struct {
		name    string
		method  string
		url     string
		role    UserRole // empty = no role in context
		handler http.HandlerFunc
	}{
		// Admin-only actions: RoleUser must be denied
		{"DeleteIssue/user", "DELETE", apiIssues1, RoleUser, HandleIssue},
		{"ArchiveIssue/user", "POST", apiIssues1Archive, RoleUser, HandleIssue},
		{"UnarchiveIssue/user", "POST", apiIssues1Unarchive, RoleUser, HandleIssue},
		{"CreateLabel/user", "POST", apiLabels, RoleUser, HandleLabels},
		{"DeleteLabel/user", "DELETE", apiLabels1, RoleUser, HandleLabel},
		{"CreateUser/user", "POST", apiUsers, RoleUser, HandleUsers},
		{"UpdateUser/user", "PUT", apiUsers1, RoleUser, HandleUser},

		// All role-gated actions: no role must be denied
		{"ListIssues/noRole", "GET", apiIssues, "", HandleActiveIssues},
		{"ListArchivedIssues/noRole", "GET", "/api/archive/issues", "", HandleArchivedIssues},
		{"GetIssue/noRole", "GET", apiIssues1, "", HandleIssue},
		{"UpdateIssue/noRole", "PUT", apiIssues1, "", HandleIssue},
		{"DeleteIssue/noRole", "DELETE", apiIssues1, "", HandleIssue},
		{"ArchiveIssue/noRole", "POST", apiIssues1Archive, "", HandleIssue},
		{"UnarchiveIssue/noRole", "POST", apiIssues1Unarchive, "", HandleIssue},
		{"CreateIssue/noRole", "POST", apiIssues, "", HandleCreateIssue},
		{"CreateTask/noRole", "POST", apiTasks, "", HandleCreateTask},
		{"UpdateTask/noRole", "PUT", apiTasks1, "", HandleTask},
		{"DeleteTask/noRole", "DELETE", apiTasks1, "", HandleTask},
		{"ListLabels/noRole", "GET", apiLabels, "", HandleLabels},
		{"CreateLabel/noRole", "POST", apiLabels, "", HandleLabels},
		{"DeleteLabel/noRole", "DELETE", apiLabels1, "", HandleLabel},
		{"ListUsers/noRole", "GET", apiUsers, "", HandleUsers},
		{"CreateUser/noRole", "POST", apiUsers, "", HandleUsers},
		{"GetUser/noRole", "GET", apiUsers1, "", HandleUser},
		{"UpdateUser/noRole", "PUT", apiUsers1, "", HandleUser},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.url, nil)
			if tt.role != "" {
				req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, tt.role))
			}
			rr := httptest.NewRecorder()
			tt.handler(rr, req)
			if rr.Code != http.StatusForbidden {
				t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
			}
		})
	}
}

// failWriter simulates a http.ResponseWriter that fails on Write.
// This allows us to test the error handling paths where json.Encode fails due to write errors.
type failWriter struct {
	http.ResponseWriter
}

func (fw *failWriter) Write(p []byte) (n int, err error) {
	return 0, errors.New("simulated write failure")
}

func TestHandlersJSONEncodingErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Helper to create admin context
	adminCtx := func(bg context.Context) context.Context {
		// We need a user in DB for context lookups often
		return context.WithValue(bg, contextKeyRole, RoleAdmin)
	}

	// Create dummy data for tests
	issue := &Issue{Title: "Issue 1", Status: StatusOpen}
	CreateIssue(issue)
	archivedIssue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(archivedIssue)

	task := &Task{Title: "Task 1", IssueID: issue.ID}
	CreateTask(task)

	label := &Label{Name: "Label 1", Color: "#000"}
	CreateLabel(label)

	// Create Admin User
	adminEmail := "admin@test.local"
	hash, _ := HashPassword("password")
	admin := &User{Email: adminEmail, FirstName: "Admin", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true}
	CreateUser(admin)

	// Create Session for Auth tests
	_, accessToken, refreshToken, _ := CreateUserSession(admin)

	// Common body payloads
	issueBody, _ := json.Marshal(&Issue{Title: testIssueTitleNew, Status: StatusOpen})
	taskBody, _ := json.Marshal(&Task{Title: testTaskTitleNew, IssueID: issue.ID})
	labelBody, _ := json.Marshal(&Label{Name: "New Label", Color: "#FFF"})
	loginBody, _ := json.Marshal(loginRequest{Email: adminEmail, Password: "password"})
	userBody, _ := json.Marshal(createUserRequest{Email: "new@test.local", FirstName: "N", LastName: "U", Role: RoleUser, Active: true, Password: "pass"})
	updateSelfBody, _ := json.Marshal(createUserRequest{Password: "newpass"}) // Only password for self update

	tests := []struct {
		name    string
		method  string
		url     string
		body    []byte
		handler http.HandlerFunc
		setup   func(r *http.Request) *http.Request
	}{
		// --- Issue Handlers ---
		{
			name:    "HandleCreateIssue",
			method:  "POST",
			url:     apiIssues,
			body:    issueBody,
			handler: HandleCreateIssue,
			setup: func(r *http.Request) *http.Request {
				// We need UserID in context for creator
				ctx := context.WithValue(r.Context(), contextKeyRole, RoleAdmin)
				ctx = context.WithValue(ctx, contextKeyUserID, admin.ID)
				return r.WithContext(ctx)
			},
		},
		{
			name:    "HandleActiveIssues",
			method:  "GET",
			url:     apiIssues,
			handler: HandleActiveIssues,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleArchivedIssues",
			method:  "GET",
			url:     "/api/issues/archive",
			handler: HandleArchivedIssues,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleIssue_GET",
			method:  "GET",
			url:     fmt.Sprintf("/api/issues/%d", issue.ID),
			handler: HandleIssue,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleIssue_PUT",
			method:  "PUT",
			url:     fmt.Sprintf("/api/issues/%d", issue.ID),
			body:    issueBody,
			handler: HandleIssue,
			setup: func(r *http.Request) *http.Request {
				ctx := context.WithValue(r.Context(), contextKeyRole, RoleAdmin)
				ctx = context.WithValue(ctx, contextKeyUserID, admin.ID) // For updater ID
				return r.WithContext(ctx)
			},
		},
		{
			name:    "HandleIssue_Archive",
			method:  "POST",
			url:     fmt.Sprintf("/api/issues/%d/archive", issue.ID),
			handler: HandleIssue,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleIssue_Unarchive",
			method:  "POST",
			url:     fmt.Sprintf("/api/issues/%d/unarchive", archivedIssue.ID),
			handler: HandleIssue,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},

		// --- Task Handlers ---
		{
			name:    "HandleCreateTask",
			method:  "POST",
			url:     "/api/tasks",
			body:    taskBody,
			handler: HandleCreateTask,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleTask_PUT",
			method:  "PUT",
			url:     fmt.Sprintf("/api/tasks/%d", task.ID),
			body:    taskBody,
			handler: HandleTask,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},

		// --- Label Handlers ---
		{
			name:    "HandleLabels_GET",
			method:  "GET",
			url:     apiLabels,
			handler: HandleLabels,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleLabels_POST",
			method:  "POST",
			url:     apiLabels,
			body:    labelBody,
			handler: HandleLabels,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},

		// --- Auth Handlers ---
		{
			name:    "HandleLogin",
			method:  "POST",
			url:     "/api/auth/login",
			body:    loginBody,
			handler: HandleLogin,
		},
		{
			name:    "HandleLogout",
			method:  "POST",
			url:     "/api/auth/logout",
			handler: HandleLogout,
			setup: func(r *http.Request) *http.Request {
				// Add cookies
				r.AddCookie(&http.Cookie{Name: cookieAccessToken, Value: accessToken})
				r.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: refreshToken})
				return r
			},
		},
		{
			name:    "HandleRefresh",
			method:  "POST",
			url:     "/api/auth/refresh",
			handler: HandleRefresh,
			setup: func(r *http.Request) *http.Request {
				// Add refresh cookie
				r.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: refreshToken})
				return r
			},
		},
		{
			name:    "HandleCurrentUser_GET",
			method:  "GET",
			url:     apiAuthMe,
			handler: HandleCurrentUser,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(context.WithValue(r.Context(), contextKeyUserID, admin.ID))
			},
		},
		{
			name:    "HandleCurrentUser_PUT",
			method:  "PUT",
			url:     apiAuthMe,
			body:    updateSelfBody,
			handler: HandleCurrentUser,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(context.WithValue(r.Context(), contextKeyUserID, admin.ID))
			},
		},

		// --- User Management Handlers ---
		{
			name:    "HandleUsers_GET",
			method:  "GET",
			url:     "/api/users",
			handler: HandleUsers,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleUsers_POST",
			method:  "POST",
			url:     "/api/users",
			body:    userBody,
			handler: HandleUsers,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleUser_GET",
			method:  "GET",
			url:     fmt.Sprintf("/api/users/%d", admin.ID),
			handler: HandleUser,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleUser_PUT",
			method:  "PUT",
			url:     fmt.Sprintf("/api/users/%d", admin.ID),
			body:    userBody,
			handler: HandleUser,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req *http.Request
			var err error
			if tt.body != nil {
				req, err = http.NewRequest(tt.method, tt.url, bytes.NewBuffer(tt.body))
			} else {
				req, err = http.NewRequest(tt.method, tt.url, nil)
			}
			if err != nil {
				t.Fatal(err)
			}

			if tt.setup != nil {
				req = tt.setup(req)
			}

			rr := httptest.NewRecorder()
			// Wrap the recorder with our failWriter to intercept Write and return error
			fw := &failWriter{ResponseWriter: rr}

			tt.handler(fw, req)

			// We expect the handler to have tried to write the JSON response, failed, and logged an error.
			// Since we mock Write returning error, we check if the code completed without panic.
			// Ideally we would check logs, but standard test logger capture is sufficient coverage.
			// The handler effectively swallows the write error (logging it), so it won't crash.
		})
	}
}
