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
	apiLabels            = "/api/projects/1/labels"
	apiLabelsBase        = "/api/projects/1/labels/"
	apiLabels1           = apiLabelsBase + "1"
	apiProjects               = "/api/projects"
	apiProjectsBase           = "/api/projects/"
	apiProjects1              = apiProjectsBase + "1"
	apiProjects1IssuesActive   = apiProjectsBase + "1/issues/active"
	apiProjects1IssuesArchived = apiProjectsBase + "1/issues/archived"
	apiProjects1IssuesOpen     = apiProjectsBase + "1/issues/open"
	invalidJSON          = "invalid json"
	wrongStatusCode      = "handler returned wrong status code: got %v want %v"
	toDelete             = "To Delete"
	expectedTitleUpdated = "expected title 'Updated', got '%s'"
	testDBPath           = ":memory:"
	testIssueTitleNew    = "New Issue"
	testTaskTitleNew     = "New Task"
	testAssigneeEmail    = "user@example.com"
	expectedFalseDBError  = "expected false on DB error"
	dropIssuesTable       = "DROP TABLE issues"
	dropProjectsTable     = "DROP TABLE projects"
	expectedResMsg       = "expected %v, got %v"
	expectedCodeMsg      = "expected code %v, got %v"
)

func TestHandleActiveIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateIssue(&Issue{Title: "Issue 1", Status: StatusTodo, ProjectID: 1})

	req, err := http.NewRequest("GET", apiProjects1IssuesActive, nil)
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)

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

	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1}
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

func TestHandleCreateIssueInvalidAssignee(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	invalidAssigneeID := 999
	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, AssigneeID: &invalidAssigneeID}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleCreateIssueInvalidLabel(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, Label: &Label{ID: 999}}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleCreateIssueInvalidPosition(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, Position: -1}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleCreateIssueInvalidDeadline(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	invalidDeadline := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, Deadline: &invalidDeadline}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleCreateIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleIssuePut(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: toDelete, Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Test Issue", Status: StatusOpen, ProjectID: 1, Description: "Test Description"}
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

	issue := &Issue{Title: "Original", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Original", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
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
	CreateIssue(&Issue{Title: "Dummy", ProjectID: 1})

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
	req, err := http.NewRequest("DELETE", apiProjects1IssuesActive, nil)
	if err != nil {
		t.Fatal(err)
	}

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)

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

	CreateLabel(&Label{Name: "Bug", Color: "#FF0000", ProjectID: 1})
	CreateLabel(&Label{Name: "Feature", Color: "#00FF00", ProjectID: 1})

	req, err := http.NewRequest("GET", apiLabels, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)

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

func TestHandleProjectPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: "Enhancement", Color: "#0000FF"}
	body, _ := json.Marshal(label)

	req, err := http.NewRequest("POST", apiLabels, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
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

func TestHandleProjectPostAdmin(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: "AdminLabel", Color: "#123456"}
	body, _ := json.Marshal(label)

	req, err := http.NewRequest("POST", apiLabels, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf(wrongStatusCode, status, http.StatusCreated)
	}
}

func TestHandleProjectPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiLabels, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
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
	handler := http.HandlerFunc(HandleProject)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, status, http.StatusMethodNotAllowed)
	}
}

func TestHandleLabelDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: toDelete, Color: "#FF00FF", ProjectID: 1}
	CreateLabel(label)

	req, err := http.NewRequest("DELETE", apiLabels1, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNoContent {
		t.Errorf(wrongStatusCode, status, http.StatusNoContent)
	}

	labels, _ := GetLabelsByProject(1)
	if len(labels) != 0 {
		t.Errorf("expected 0 labels, got %d", len(labels))
	}
}

func TestHandleLabelInvalidID(t *testing.T) {
	req, err := http.NewRequest("DELETE", "/api/projects/1/labels/invalid", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)

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
	handler := http.HandlerFunc(HandleProject)

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

	issueBody, _ := json.Marshal(&Issue{Title: "Test", Status: StatusOpen, ProjectID: 1})
	taskBody, _ := json.Marshal(&Task{Title: "Test", IssueID: 1})
	labelBody, _ := json.Marshal(&Label{Name: "Test", Color: "#000000"})

	tests := []struct {
		name    string
		method  string
		url     string
		body    []byte
		handler http.HandlerFunc
	}{
		{"HandleActiveIssues_GET", "GET", apiProjects1IssuesActive, nil, HandleProject},
		{"HandleActiveIssues_POST", "POST", apiIssues, issueBody, HandleCreateIssue},
		{"HandleIssue_PUT", "PUT", apiIssues1, issueBody, HandleIssue},
		{"HandleIssue_DELETE", "DELETE", apiIssues1, nil, HandleIssue},
		{"HandleCreateTask_POST", "POST", apiTasks, taskBody, HandleCreateTask},
		{"HandleTask_PUT", "PUT", apiTasks1, taskBody, HandleTask},
		{"HandleTask_DELETE", "DELETE", apiTasks1, nil, HandleTask},
		{"HandleProject_GET", "GET", apiLabels, nil, HandleProject},
		{"HandleProject_POST", "POST", apiLabels, labelBody, HandleProject},
		{"HandleProject_DELETE", "DELETE", apiLabels1, nil, HandleProject},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_Error", func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.url, bytes.NewBuffer(tt.body))
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
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
	issue := &Issue{Title: "Updated Title", Status: StatusOpen, ProjectID: 1}
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
		{"EmptyTitle", Issue{Title: "", Status: StatusOpen, ProjectID: 1}},
		{"InvalidStatus", Issue{Title: "Valid", Status: "InvalidStatus", ProjectID: 1}},
		{"InvalidPriority", Issue{Title: "Valid", Status: StatusOpen, Priority: "Critical", ProjectID: 1}},
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

func TestHandleProjectInvalidInput(t *testing.T) {
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
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
			rr := httptest.NewRecorder()
			handle := http.HandlerFunc(HandleProject)
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
	req, _ := http.NewRequest("DELETE", "/api/projects/1/labels/999", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("DELETE /api/projects/1/labels/999: "+wrongStatusCode,
			status, http.StatusNotFound)
	}
}

func TestHandleArchivedIssueBlocking(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Create an archived issue
	archivedIssue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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
	archivedIssue2 := &Issue{Title: "Archived with Tasks", Status: StatusArchive, ProjectID: 1}
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
	archivedIssue3 := &Issue{Title: "Archived 3", Status: StatusArchive, ProjectID: 1}
	CreateIssue(archivedIssue3)
	archivedIssue3Path := apiIssuesBase + strconv.Itoa(archivedIssue3.ID)

	req, _ = http.NewRequest("PUT", archivedIssue3Path, bytes.NewBufferString(`{"title":"Bypass"}`))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	// 9. Try to delete archived issue (blocked even for admin — business rule in handler)
	archivedIssue4 := &Issue{Title: "Archived 4", Status: StatusArchive, ProjectID: 1}
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

	validIssue := `{"title":"Issue","status":"Open","project_id":1}`
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
		{"HandleActiveIssues", "GET", apiProjects1IssuesActive, "", HandleProject},
		{"HandleCreateIssue", "POST", apiIssues, validIssue, HandleCreateIssue},
		{"HandleArchivedIssues", "GET", apiProjects1IssuesArchived, "", HandleProject},
		{"HandleIssue_GET", "GET", apiIssues1, "", HandleIssue},
		{"HandleIssue_PUT", "PUT", apiIssues1, validIssue, HandleIssue},
		{"HandleIssue_DELETE", "DELETE", apiIssues1, "", HandleIssue},
		{"HandleIssue_archive", "POST", apiIssues1Archive, "", HandleIssue},
		{"HandleIssue_unarchive", "POST", apiIssues1Unarchive, "", HandleIssue},
		{"HandleCreateTask", "POST", apiTasks, validTask, HandleCreateTask},
		{"HandleTask_PUT", "PUT", apiTasks1, validTaskUpdate, HandleTask},
		{"HandleTask_DELETE", "DELETE", apiTasks1, "", HandleTask},
		{"HandleProject_GET", "GET", apiLabels, "", HandleProject},
		{"HandleProject_POST", "POST", apiLabels, validLabel, HandleProject},
		{"HandleProject_DELETE", "DELETE", apiLabels1, "", HandleProject},
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
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

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
	InitSecretKey("testsecret")

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
	issue := &Issue{Title: "Orignal", Status: StatusOpen, ProjectID: 1}
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
	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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

	issue := &Issue{Title: "Active", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Already Archived", Status: StatusArchive, ProjectID: 1}
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

	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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

	issue := &Issue{Title: "Active", Status: StatusOpen, ProjectID: 1}
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

	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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

func TestHandleUpdateUserLastSysAdminProtection(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create single sysadmin
	hash, _ := HashPassword(testPassword)
	user := &User{Email: "admin@local", Role: RoleSysAdmin, Active: true, PasswordHash: hash}
	CreateUser(user)
	path := apiUsersBase + strconv.Itoa(user.ID)

	// Try to demote the only sysadmin
	updateBody := map[string]interface{}{
		"email":      "admin@local",
		"first_name": "Admin",
		"last_name":  "User",
		"role":       "user", // Demoting
		"active":     true,
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	rr := httptest.NewRecorder()

	HandleUser(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 Bad Request for last sysadmin demotion, got %d", rr.Code)
	}
}

func TestHandlePutTaskArchivedIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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

	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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
	issue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
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
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
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

func TestIssueContentHash(t *testing.T) {
	deadline := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)
	assigneeID := 7
	issue := &Issue{
		Title:        "Title",
		Description:  "Desc",
		Status:       StatusOpen,
		Priority:     PriorityNormal,
		Label:        &Label{ID: 42},
		AssigneeID:   &assigneeID,
		Deadline:     &deadline,
		PlannedDates: []string{"2025-01-01"},
		ProjectID:    1,
	}

	h := issueContentHash(issue)

	// Deterministic
	if issueContentHash(issue) != h {
		t.Error("hash should be deterministic")
	}
	// Label change → different hash (covers label != nil branch)
	i2 := *issue
	i2.Label = &Label{ID: 99}
	if issueContentHash(&i2) == h {
		t.Error("expected different hash when label changes")
	}
	// Deadline removal → different hash (covers deadline != nil branch)
	i3 := *issue
	i3.Deadline = nil
	if issueContentHash(&i3) == h {
		t.Error("expected different hash when deadline is removed")
	}
	// Position change → same hash (position is excluded by design)
	i4 := *issue
	i4.Position = issue.Position + 10
	if issueContentHash(&i4) != h {
		t.Error("expected same hash when only position changes")
	}
}

func TestPersistIssueUpdatePositionOnlyNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Non-existent ID → UpdateIssuePosition returns ErrIssueNotFound
	current := &Issue{ID: 9999, Title: "Test", Status: StatusOpen, ProjectID: 1}
	modified := *current
	modified.Position = current.Position + 1

	rr := httptest.NewRecorder()
	if persistIssueUpdate(rr, &modified, current, "test@example.com") {
		t.Error("expected false for not-found position update")
	}
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestPersistIssueUpdatePositionOnlyDBError(t *testing.T) {
	setupTestDB()
	issue := &Issue{Title: "Test", Status: StatusOpen, ProjectID: 1}
	CreateIssue(issue)

	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	modified := *issue
	modified.Position = issue.Position + 1

	rr := httptest.NewRecorder()
	if persistIssueUpdate(rr, &modified, issue, "test@example.com") {
		t.Error(expectedFalseDBError)
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestPersistIssueUpdateContentNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Non-existent ID → UpdateIssue returns ErrIssueNotFound
	current := &Issue{ID: 9999, Title: "Test", Status: StatusOpen, ProjectID: 1}
	modified := *current
	modified.Title = "Changed"

	rr := httptest.NewRecorder()
	if persistIssueUpdate(rr, &modified, current, "test@example.com") {
		t.Error("expected false for not-found content update")
	}
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestPersistIssueUpdateContentDBError(t *testing.T) {
	setupTestDB()
	issue := &Issue{Title: "Test", Status: StatusOpen, ProjectID: 1}
	CreateIssue(issue)

	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	modified := *issue
	modified.Title = "Changed"

	rr := httptest.NewRecorder()
	if persistIssueUpdate(rr, &modified, issue, "test@example.com") {
		t.Error(expectedFalseDBError)
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
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
	InitSecretKey("secret")

	// Create user
	user := &User{Email: "creator@test.com", FirstName: "C", LastName: "U", Role: RoleUser, Active: true}
	CreateUser(user)

	issue := &Issue{Title: "My Issue", Status: StatusOpen, ProjectID: 1}
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
	creator := &User{Email: "c@test.com", FirstName: "C", LastName: "U", Role: RoleUser, Active: true}
	assignee := &User{Email: "a@test.com", FirstName: "A", LastName: "U", Role: RoleUser, Active: true}
	CreateUser(creator)
	CreateUser(assignee)

	issue := &Issue{Title: "Issue", Status: StatusOpen, CreatorID: creator.ID, ProjectID: 1}
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, CreatorID: creator.ID, ProjectID: 1}
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
		// Admin+Sysadmin actions: RoleUser must be denied
		{"DeleteIssue/user", "DELETE", apiIssues1, RoleUser, HandleIssue},
		{"ArchiveIssue/user", "POST", apiIssues1Archive, RoleUser, HandleIssue},
		{"UnarchiveIssue/user", "POST", apiIssues1Unarchive, RoleUser, HandleIssue},

		// Admin-only actions: RoleUser must be denied
		{"CreateLabel/user", "POST", apiLabels, RoleUser, HandleProject},
		{"DeleteLabel/user", "DELETE", apiLabels1, RoleUser, HandleProject},
		{"CreateUser/user", "POST", apiUsers, RoleUser, HandleUsers},
		{"UpdateUser/user", "PUT", apiUsers1, RoleUser, HandleUser},

		// Sysadmin-only actions: RoleAdmin must also be denied
		{"CreateUser/admin", "POST", apiUsers, RoleAdmin, HandleUsers},
		{"UpdateUser/admin", "PUT", apiUsers1, RoleAdmin, HandleUser},

		// All role-gated actions: no role must be denied
		{"ListIssues/noRole", "GET", apiProjects1IssuesActive, "", HandleProject},
		{"ListArchivedIssues/noRole", "GET", apiProjects1IssuesArchived, "", HandleProject},
		{"GetIssue/noRole", "GET", apiIssues1, "", HandleIssue},
		{"UpdateIssue/noRole", "PUT", apiIssues1, "", HandleIssue},
		{"DeleteIssue/noRole", "DELETE", apiIssues1, "", HandleIssue},
		{"ArchiveIssue/noRole", "POST", apiIssues1Archive, "", HandleIssue},
		{"UnarchiveIssue/noRole", "POST", apiIssues1Unarchive, "", HandleIssue},
		{"CreateIssue/noRole", "POST", apiIssues, "", HandleCreateIssue},
		{"CreateTask/noRole", "POST", apiTasks, "", HandleCreateTask},
		{"UpdateTask/noRole", "PUT", apiTasks1, "", HandleTask},
		{"DeleteTask/noRole", "DELETE", apiTasks1, "", HandleTask},
		{"ListLabels/noRole", "GET", apiLabels, "", HandleProject},
		{"CreateLabel/noRole", "POST", apiLabels, "", HandleProject},
		{"DeleteLabel/noRole", "DELETE", apiLabels1, "", HandleProject},
		{"ListUsers/noRole", "GET", apiUsers, "", HandleUsers},
		{"CreateUser/noRole", "POST", apiUsers, "", HandleUsers},
		{"GetUser/noRole", "GET", apiUsers1, "", HandleUser},
		{"UpdateUser/noRole", "PUT", apiUsers1, "", HandleUser},

		// Sysadmin-only project mutations: RoleUser must be denied
		{"CreateProject/user", "POST", apiProjects, RoleUser, HandleProjects},
		{"UpdateProject/user", "PUT", apiProjects1, RoleUser, HandleProject},
		{"DeleteProject/user", "DELETE", apiProjects1, RoleUser, HandleProject},

		// Sysadmin-only project mutations: RoleAdmin must also be denied
		{"CreateProject/admin", "POST", apiProjects, RoleAdmin, HandleProjects},
		{"UpdateProject/admin", "PUT", apiProjects1, RoleAdmin, HandleProject},
		{"DeleteProject/admin", "DELETE", apiProjects1, RoleAdmin, HandleProject},

		// Project actions: no role must deny everything
		{"ListProjects/noRole", "GET", apiProjects, "", HandleProjects},
		{"CreateProject/noRole", "POST", apiProjects, "", HandleProjects},
		{"UpdateProject/noRole", "PUT", apiProjects1, "", HandleProject},
		{"DeleteProject/noRole", "DELETE", apiProjects1, "", HandleProject},
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
		return context.WithValue(bg, contextKeyRole, RoleSysAdmin)
	}

	// Create dummy data for tests
	issue := &Issue{Title: "Issue 1", Status: StatusOpen, ProjectID: 1}
	CreateIssue(issue)
	archivedIssue := &Issue{Title: "Archived", Status: StatusArchive, ProjectID: 1}
	CreateIssue(archivedIssue)

	task := &Task{Title: "Task 1", IssueID: issue.ID}
	CreateTask(task)

	label := &Label{Name: "Label 1", Color: "#000", ProjectID: 1}
	CreateLabel(label)

	// Create Admin User
	adminEmail := "admin@test.local"
	hash, _ := HashPassword("password")
	admin := &User{Email: adminEmail, FirstName: "Admin", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true}
	CreateUser(admin)

	// Create Session for Auth tests
	_, accessToken, refreshToken, _ := CreateUserSession(admin)

	// Common body payloads
	issueBody, _ := json.Marshal(&Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1})
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
			url:     apiProjects1IssuesActive,
			handler: HandleProject,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleArchivedIssues",
			method:  "GET",
			url:     apiProjects1IssuesArchived,
			handler: HandleProject,
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
			name:    "HandleProject_GET",
			method:  "GET",
			url:     apiLabels,
			handler: HandleProject,
			setup: func(r *http.Request) *http.Request {
				return r.WithContext(adminCtx(r.Context()))
			},
		},
		{
			name:    "HandleProject_POST",
			method:  "POST",
			url:     apiLabels,
			body:    labelBody,
			handler: HandleProject,
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

func TestCheckAssignee(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create an active user
	activeUser := &User{Email: "active@example.com", Active: true}
	if err := CreateUser(activeUser); err != nil {
		t.Fatalf("Failed to create active user: %v", err)
	}

	// Create an inactive user
	inactiveUser := &User{Email: "inactive@example.com", Active: false}
	if err := CreateUser(inactiveUser); err != nil {
		t.Fatalf("Failed to create inactive user: %v", err)
	}

	tests := []struct {
		name         string
		issue        *Issue
		current      *Issue
		expectedRes  bool
		expectedCode int
	}{
		{
			name:         "Nil AssigneeID",
			issue:        &Issue{AssigneeID: nil},
			current:      nil,
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "New Active Assignee",
			issue:        &Issue{AssigneeID: &activeUser.ID},
			current:      nil,
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "New Inactive Assignee",
			issue:        &Issue{AssigneeID: &inactiveUser.ID},
			current:      nil,
			expectedRes:  false,
			expectedCode: http.StatusBadRequest,
		},
		{
			name:         "Non-existent Assignee",
			issue:        &Issue{AssigneeID: ptrInt(999)},
			current:      nil,
			expectedRes:  false,
			expectedCode: http.StatusBadRequest,
		},
		{
			name:         "Same Assignee (now inactive)",
			issue:        &Issue{AssigneeID: &inactiveUser.ID},
			current:      &Issue{AssigneeID: &inactiveUser.ID},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Same Assignee (now active)",
			issue:        &Issue{AssigneeID: &activeUser.ID},
			current:      &Issue{AssigneeID: &activeUser.ID},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Changed to Active Assignee",
			issue:        &Issue{AssigneeID: &activeUser.ID},
			current:      &Issue{AssigneeID: &inactiveUser.ID},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Changed to Inactive Assignee",
			issue:        &Issue{AssigneeID: &inactiveUser.ID},
			current:      &Issue{AssigneeID: &activeUser.ID},
			expectedRes:  false,
			expectedCode: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			res := checkAssignee(rr, tt.issue, tt.current, testAssigneeEmail)
			if res != tt.expectedRes {
				t.Errorf(expectedResMsg, tt.expectedRes, res)
			}
			if !tt.expectedRes && rr.Code != tt.expectedCode {
				t.Errorf(expectedCodeMsg, tt.expectedCode, rr.Code)
			}
		})
	}
}

func TestCheckAssigneeDBError(t *testing.T) {
	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	id := 1
	issue := &Issue{AssigneeID: &id}
	rr := httptest.NewRecorder()
	res := checkAssignee(rr, issue, nil, testAssigneeEmail)
	if res {
		t.Error(expectedFalseDBError)
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}

	// Test Same Assignee error case
	rr = httptest.NewRecorder()
	res = checkAssignee(rr, issue, &Issue{AssigneeID: &id}, testAssigneeEmail)
	if res {
		t.Error(expectedFalseDBError)
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestCheckLabel(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	label := &Label{Name: "Bug", Color: "#FF0000", ProjectID: 1}
	if err := CreateLabel(label); err != nil {
		t.Fatalf("Failed to create label: %v", err)
	}

	tests := []struct {
		name         string
		issue        *Issue
		expectedRes  bool
		expectedCode int
	}{
		{
			name:         "Nil Label",
			issue:        &Issue{Label: nil},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Existent Label",
			issue:        &Issue{Label: &Label{ID: label.ID}, ProjectID: 1},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Non-existent Label",
			issue:        &Issue{Label: &Label{ID: 999}},
			expectedRes:  false,
			expectedCode: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			res := checkLabel(rr, tt.issue, testAssigneeEmail)
			if res != tt.expectedRes {
				t.Errorf(expectedResMsg, tt.expectedRes, res)
			}
			if !tt.expectedRes && rr.Code != tt.expectedCode {
				t.Errorf(expectedCodeMsg, tt.expectedCode, rr.Code)
			}
		})
	}
}

func TestCheckLabelDBError(t *testing.T) {
	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	issue := &Issue{Label: &Label{ID: 1}}
	rr := httptest.NewRecorder()
	res := checkLabel(rr, issue, testAssigneeEmail)
	if res {
		t.Error(expectedFalseDBError)
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func ptrInt(i int) *int { return &i }

func TestCheckProject(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "P1"}
	if err := CreateProject(p); err != nil {
		t.Fatalf("Failed to create project: %v", err)
	}

	tests := []struct {
		name         string
		issue        *Issue
		expectedRes  bool
		expectedCode int
	}{
		{
			name:         "Existent Project",
			issue:        &Issue{ProjectID: p.ID},
			expectedRes:  true,
			expectedCode: http.StatusOK,
		},
		{
			name:         "Non-existent Project",
			issue:        &Issue{ProjectID: 999},
			expectedRes:  false,
			expectedCode: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			res := checkProject(rr, tt.issue, testAssigneeEmail)
			if res != tt.expectedRes {
				t.Errorf(expectedResMsg, tt.expectedRes, res)
			}
			if !tt.expectedRes && rr.Code != tt.expectedCode {
				t.Errorf(expectedCodeMsg, tt.expectedCode, rr.Code)
			}
		})
	}
}

func TestHandleListProjects(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateProject(&Project{Name: "Proj 1"})

	req, _ := http.NewRequest("GET", apiProjects, nil)
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(handleListProjects)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	var projects []Project
	json.NewDecoder(rr.Body).Decode(&projects)
	// Seed 1 (default) + ours
	if len(projects) != 2 {
		t.Errorf("expected 2 projects, got %d", len(projects))
	}
}

func TestHandleCreateProject(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := Project{Name: "New Proj"}
	body, _ := json.Marshal(p)

	req, _ := http.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(handleCreateProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusCreated {
		t.Errorf(wrongStatusCode, status, http.StatusCreated)
	}

	var created Project
	json.NewDecoder(rr.Body).Decode(&created)
	if created.Name != "new proj" {
		t.Errorf("expected 'new proj', got '%s'", created.Name)
	}
}

func TestHandleProjectUpdate(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "Old"}
	CreateProject(p)

	p.Name = "New"
	body, _ := json.Marshal(p)

	path := apiProjectsBase + strconv.Itoa(p.ID)
	req, _ := http.NewRequest("PUT", path, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}
}

func TestHandleProjectDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: toDelete}
	CreateProject(p)

	path := apiProjectsBase + strconv.Itoa(p.ID)
	req, _ := http.NewRequest("DELETE", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCode, status, http.StatusOK)
	}

	// Verify it's gone
	p2, _ := GetProjectByID(p.ID)
	if p2 != nil {
		t.Error("expected project to be deleted")
	}
}

func TestHandleProjectDeleteDefaultBlocked(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, _ := http.NewRequest("DELETE", apiProjects1, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleProjectDeleteWithIssuesBlocked(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "Has Issues"}
	CreateProject(p)
	CreateIssue(&Issue{Title: "I1", ProjectID: p.ID})

	path := apiProjectsBase + strconv.Itoa(p.ID)
	req, _ := http.NewRequest("DELETE", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleProject)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

func TestHandleProjectsMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("PATCH", apiProjects, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProjects(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleProjectMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", apiProjects1, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleProjectInvalidID(t *testing.T) {
	req := httptest.NewRequest("PUT", apiProjectsBase+"abc", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCreateProjectInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("POST", apiProjects, bytes.NewBufferString(invalidJSON))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleCreateProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCreateProjectValidationFailure(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Project{Name: ""})
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleCreateProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCreateProjectDuplicateName(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateProject(&Project{Name: "dupe"})

	body, _ := json.Marshal(Project{Name: "Dupe"})
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleCreateProject(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusConflict)
	}
}

func TestHandleUpdateProjectInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "Upd"}
	CreateProject(p)

	req := httptest.NewRequest("PUT", apiProjectsBase+strconv.Itoa(p.ID), bytes.NewBufferString(invalidJSON))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUpdateProjectValidationFailure(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "Upd"}
	CreateProject(p)

	body, _ := json.Marshal(Project{Name: ""})
	req := httptest.NewRequest("PUT", apiProjectsBase+strconv.Itoa(p.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUpdateProjectNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Project{Name: "Ghost"})
	req := httptest.NewRequest("PUT", apiProjectsBase+"999", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleUpdateProjectDuplicateName(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateProject(&Project{Name: "existing"})
	p := &Project{Name: "torename"}
	CreateProject(p)

	body, _ := json.Marshal(Project{Name: "Existing"})
	req := httptest.NewRequest("PUT", apiProjectsBase+strconv.Itoa(p.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusConflict)
	}
}

func TestHandleDeleteProjectNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "GoneProject"}
	CreateProject(p)
	path := apiProjectsBase + strconv.Itoa(p.ID)
	DeleteProject(p.ID) // pre-delete so the handler hits ErrProjectNotFound

	req := httptest.NewRequest("DELETE", path, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

// ── Project-scoped issue endpoint tests ─────────────────────────────────────

func TestHandleProjectActiveIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateIssue(&Issue{Title: "Active Issue", Status: StatusTodo, ProjectID: 1})

	req := httptest.NewRequest("GET", apiProjects1IssuesActive, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var issues []Issue
	if err := json.NewDecoder(rr.Body).Decode(&issues); err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 {
		t.Errorf("expected 1 issue, got %d", len(issues))
	}
}

func TestHandleProjectArchivedIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	i := &Issue{Title: "Archived Issue", Status: StatusArchive, ProjectID: 1}
	CreateIssue(i)

	req := httptest.NewRequest("GET", apiProjects1IssuesArchived, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var issues []Issue
	if err := json.NewDecoder(rr.Body).Decode(&issues); err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 {
		t.Errorf("expected 1 archived issue, got %d", len(issues))
	}
}

func TestHandleProjectIssuesInvalidID(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/projects/abc/issues/active", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleProjectIssuesNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", "/api/projects/999/issues/active", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleProjectIssuesActiveMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("POST", apiProjects1IssuesActive, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleProjectIssuesForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiProjects1IssuesActive, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, ""))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// ── line 367: checkProject failure path in handlePutIssue ────────────────────

func TestHandleUpdateIssueInvalidProject(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Test", Status: StatusOpen, ProjectID: 1}
	CreateIssue(issue)

	updated := &Issue{Title: "Test", Status: StatusOpen, ProjectID: 999}
	body, _ := json.Marshal(updated)

	req := httptest.NewRequest("PUT", apiIssuesBase+strconv.Itoa(issue.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleIssue(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

// ── lines 1347, 1353: HandleProjects dispatcher success paths ────────────────

func TestHandleProjectsGetDispatch(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiProjects, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProjects(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
}

func TestHandleProjectsPostDispatch(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Project{Name: "Dispatched"})
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusCreated)
	}
}

// ── lines 1361-1366: handleListProjects DB error ─────────────────────────────

func TestHandleListProjectsDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	req := httptest.NewRequest("GET", apiProjects, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleListProjects(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1369-1371: handleListProjects json encode error ────────────────────

func TestHandleListProjectsEncodeError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiProjects, nil)
	handleListProjects(&failWriter{ResponseWriter: httptest.NewRecorder()}, req)
	// no panic is the assertion; error branch executes the slog.Error
}

// ── lines 1388-1390: handleCreateProject generic DB error ────────────────────

func TestHandleCreateProjectDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	oldDB := DB
	closedDB, _ := sql.Open("sqlite3", testDBPath)
	closedDB.Close()
	DB = closedDB
	defer func() { DB = oldDB }()

	body, _ := json.Marshal(Project{Name: "Fail"})
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleCreateProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1396-1398: handleCreateProject json encode error ───────────────────

func TestHandleCreateProjectEncodeError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Project{Name: "EncodeErr"})
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	handleCreateProject(&failWriter{ResponseWriter: httptest.NewRecorder()}, req)
}

// ── lines 1425-1426: HandleProject unknown sub-resource ──────────────────────

func TestHandleProjectUnknownSubResource(t *testing.T) {
	req := httptest.NewRequest("GET", apiProjectsBase+"1/unknown", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

// ── lines 1478-1482: handleProjectActiveIssues DB error from GetActiveIssuesByProject

func TestHandleProjectActiveIssuesDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Drop issues table so projectExists (queries projects) succeeds
	// but GetActiveIssuesByProject (queries issues) fails.
	if _, err := DB.Exec(dropIssuesTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", apiProjects1IssuesActive, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1491-1494: handleProjectArchivedIssues method not allowed ──────────

func TestHandleProjectArchivedIssuesMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("POST", apiProjects1IssuesArchived, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// ── lines 1504-1507: handleProjectArchivedIssues project not found ───────────

func TestHandleProjectArchivedIssuesNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", "/api/projects/999/issues/archived", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

// ── lines 1510-1514: handleProjectArchivedIssues DB error from GetArchivedIssuesByProject

func TestHandleProjectArchivedIssuesDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Drop issues table so projectExists succeeds but GetArchivedIssuesByProject fails.
	if _, err := DB.Exec(dropIssuesTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", apiProjects1IssuesArchived, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── handleProjectOpenIssues tests ────────────────────────────────────────────

func TestHandleProjectOpenIssuesSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	project := &Project{Name: "Test Project"}
	CreateProject(project)
	open := &Issue{Title: "Open Issue", Status: StatusOpen, ProjectID: project.ID}
	active := &Issue{Title: "Todo Issue", Status: StatusTodo, ProjectID: project.ID}
	CreateIssue(open)
	CreateIssue(active)

	req := httptest.NewRequest("GET", apiProjectsBase+strconv.Itoa(project.ID)+"/issues/open", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var issues []Issue
	if err := json.NewDecoder(rr.Body).Decode(&issues); err != nil {
		t.Fatal(err)
	}
	if len(issues) != 1 {
		t.Errorf("expected 1 open issue, got %d", len(issues))
	}
	if issues[0].Status != StatusOpen {
		t.Errorf("expected status Open, got %s", issues[0].Status)
	}
}

func TestHandleProjectOpenIssuesMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("POST", apiProjects1IssuesOpen, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleProjectOpenIssuesForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiProjects1IssuesOpen, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, ""))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

func TestHandleProjectOpenIssuesNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", "/api/projects/999/issues/open", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleProjectOpenIssuesDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if _, err := DB.Exec(dropIssuesTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", apiProjects1IssuesOpen, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleProjectOpenIssuesProjectExistsDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Drop projects table so projectExists fails with a DB error.
	if _, err := DB.Exec(dropProjectsTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", apiProjects1IssuesOpen, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleProjectOpenIssuesTasksDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create an open issue so the query returns rows, then drop the tasks table
	// so GetAllTasks fails inside GetOpenIssuesByProject.
	CreateIssue(&Issue{Title: "Open Issue", Status: StatusOpen, ProjectID: 1})
	if _, err := DB.Exec("DROP TABLE tasks"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", apiProjects1IssuesOpen, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── TestGetActiveIssuesByProject excludes Open status ────────────────────────

func TestGetActiveIssuesByProjectExcludesOpen(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	project := &Project{Name: "Test Project"}
	CreateProject(project)
	openIssue := &Issue{Title: "Open Issue", Status: StatusOpen, ProjectID: project.ID}
	todoIssue := &Issue{Title: "Todo Issue", Status: StatusTodo, ProjectID: project.ID}
	CreateIssue(openIssue)
	CreateIssue(todoIssue)

	issues, err := GetActiveIssuesByProject(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range issues {
		if i.Status == StatusOpen {
			t.Errorf("GetActiveIssuesByProject returned an Open issue (id=%d)", i.ID)
		}
	}
	if len(issues) != 1 {
		t.Errorf("expected 1 active issue, got %d", len(issues))
	}
}

// ── lines 1542-1544: handleUpdateProject generic DB error ────────────────────

func TestHandleUpdateProjectDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "ToCorrupt"}
	CreateProject(p)

	// Drop projects table so UpdateProject fails with a generic DB error
	// (not ErrProjectNotFound or ErrDuplicateProjectName).
	if _, err := DB.Exec(dropProjectsTable); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(Project{Name: "NewName"})
	req := httptest.NewRequest("PUT", apiProjectsBase+strconv.Itoa(p.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1549-1551: handleUpdateProject json encode error ───────────────────

func TestHandleUpdateProjectEncodeError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "EncodeErrUpd"}
	CreateProject(p)

	body, _ := json.Marshal(Project{Name: "EncodeErrUpd2"})
	req := httptest.NewRequest("PUT", apiProjectsBase+strconv.Itoa(p.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	handleUpdateProject(&failWriter{ResponseWriter: httptest.NewRecorder()}, req, p.ID)
}

// ── lines 1566-1570: handleDeleteProject CountIssuesByProject DB error ───────

func TestHandleDeleteProjectCountDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "CountFail"}
	CreateProject(p)

	// Drop issues table so CountIssuesByProject fails.
	if _, err := DB.Exec(dropIssuesTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("DELETE", apiProjectsBase+strconv.Itoa(p.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1583-1585: handleDeleteProject generic DeleteProject DB error ───────

func TestHandleDeleteProjectGenericDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "DeleteFail"}
	CreateProject(p)

	// Drop projects table so DeleteProject fails with a generic error.
	// CountIssuesByProject still works because it queries the issues table.
	if _, err := DB.Exec(dropProjectsTable); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("DELETE", apiProjectsBase+strconv.Itoa(p.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	HandleProject(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// ── lines 1591-1593: handleDeleteProject json encode error ───────────────────

func TestHandleDeleteProjectEncodeError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	p := &Project{Name: "EncodeErrDel"}
	CreateProject(p)

	req := httptest.NewRequest("DELETE", apiProjectsBase+strconv.Itoa(p.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	handleDeleteProject(&failWriter{ResponseWriter: httptest.NewRecorder()}, req, p.ID)
}

func TestProjectNameCaseNormalisation(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Creating "Default" should be stored as "default" (id=1 seeded at startup)
	p := Project{Name: "MyProject"}
	body, _ := json.Marshal(p)
	req := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyEmail, testAssigneeEmail))
	rr := httptest.NewRecorder()
	handleCreateProject(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rr.Code)
	}
	var created Project
	json.NewDecoder(rr.Body).Decode(&created)
	if created.Name != "myproject" {
		t.Errorf("expected name 'myproject', got '%s'", created.Name)
	}

	// Creating "MYPROJECT" (same in lowercase) should return 409
	body2, _ := json.Marshal(Project{Name: "MYPROJECT"})
	req2 := httptest.NewRequest("POST", apiProjects, bytes.NewBuffer(body2))
	req2 = req2.WithContext(context.WithValue(req2.Context(), contextKeyEmail, testAssigneeEmail))
	rr2 := httptest.NewRecorder()
	handleCreateProject(rr2, req2)
	if rr2.Code != http.StatusConflict {
		t.Errorf("expected 409 for duplicate name, got %d", rr2.Code)
	}
}

// ---------------------------------------------------------------------------
// handleProjectStatusConfig
// ---------------------------------------------------------------------------

const apiStatusConfig = "/api/projects/1/statusconfig"

func TestHandleProjectStatusConfigGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, err := http.NewRequest("GET", apiStatusConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var cfg StatusConfig
	if err := json.NewDecoder(rr.Body).Decode(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Stage1Name != "Pending" || cfg.Stage2Name != "Working" {
		t.Errorf("expected default config, got %+v", cfg)
	}
}

func TestHandleProjectStatusConfigGetCustomValues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	UpsertStatusConfig(&StatusConfig{ProjectID: 1, Stage1Name: "Review", Stage2Name: "QA", Stage3Name: "Staging"})

	req, err := http.NewRequest("GET", apiStatusConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var cfg StatusConfig
	if err := json.NewDecoder(rr.Body).Decode(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Stage1Name != "Review" || cfg.Stage2Name != "QA" || cfg.Stage3Name != "Staging" {
		t.Errorf("unexpected config: %+v", cfg)
	}
}

func TestHandleProjectStatusConfigGetForbidden(t *testing.T) {
	req, err := http.NewRequest("GET", apiStatusConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	// No role in context → denied

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

func TestHandleProjectStatusConfigGetDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE project_status_config")

	req, err := http.NewRequest("GET", apiStatusConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleProjectStatusConfigPut(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	payload := StatusConfig{Stage1Name: "Review", Stage2Name: "QA", Stage3Name: "", Stage4Name: ""}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", apiStatusConfig, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin)
	ctx = context.WithValue(ctx, contextKeyEmail, testAssigneeEmail)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var resp StatusConfig
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.Stage1Name != "Review" || resp.Stage2Name != "QA" {
		t.Errorf("unexpected response config: %+v", resp)
	}
	if resp.ProjectID != 1 {
		t.Errorf("expected ProjectID 1 in response, got %d", resp.ProjectID)
	}
}

func TestHandleProjectStatusConfigPutForbiddenUser(t *testing.T) {
	payload := StatusConfig{Stage1Name: "Review"}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", apiStatusConfig, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

func TestHandleProjectStatusConfigPutInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("PUT", apiStatusConfig, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleProjectStatusConfigPutValidationFails(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	payload := StatusConfig{Stage1Name: "Bad!Name"}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", apiStatusConfig, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleProjectStatusConfigPutDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE project_status_config")

	payload := StatusConfig{Stage1Name: "Review", Stage2Name: "Working"}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", apiStatusConfig, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin)
	ctx = context.WithValue(ctx, contextKeyEmail, testAssigneeEmail)
	req = req.WithContext(ctx)

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

func TestHandleProjectStatusConfigMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("DELETE", apiStatusConfig, nil)
	if err != nil {
		t.Fatal(err)
	}
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleSysAdmin))

	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// ---------------------------------------------------------------------------
// Release handlers
// ---------------------------------------------------------------------------

const (
	apiReleases       = "/api/releases/"
	apiProjectReleases = "/api/projects/1/releases"
)

func makeAdminCtx(r *http.Request) *http.Request {
	ctx := context.WithValue(r.Context(), contextKeyRole, RoleAdmin)
	ctx = context.WithValue(ctx, contextKeyEmail, testAssigneeEmail)
	return r.WithContext(ctx)
}

func TestHandleProjectReleasesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := CreateRelease(&Release{ProjectID: 1, Name: "v1.0"}); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("GET", apiProjectReleases, nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var releases []Release
	if err := json.NewDecoder(rr.Body).Decode(&releases); err != nil {
		t.Fatal(err)
	}
	if len(releases) != 1 {
		t.Errorf("expected 1 release, got %d", len(releases))
	}
}


func TestHandleProjectReleasesPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Release{Name: "v2.0"})
	req, _ := http.NewRequest("POST", apiProjectReleases, bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusCreated)
	}
	var rel Release
	if err := json.NewDecoder(rr.Body).Decode(&rel); err != nil {
		t.Fatal(err)
	}
	if rel.Name != "v2.0" {
		t.Errorf("expected name 'v2.0', got '%s'", rel.Name)
	}
}

func TestHandleProjectReleasesPostDuplicate(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := CreateRelease(&Release{ProjectID: 1, Name: "v1.0"}); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	body, _ := json.Marshal(Release{Name: "v1.0"})
	req, _ := http.NewRequest("POST", apiProjectReleases, bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusConflict)
	}
}

func TestHandleProjectReleasesPostForbidden(t *testing.T) {
	body, _ := json.Marshal(Release{Name: "v1.0"})
	req, _ := http.NewRequest("POST", apiProjectReleases, bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

func TestHandleProjectReleasesMethodNotAllowed(t *testing.T) {
	req, _ := http.NewRequest("DELETE", apiProjectReleases, nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleReleaseGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("GET", apiReleases+strconv.Itoa(rel.ID), nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var got Release
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "v1.0" {
		t.Errorf("expected name 'v1.0', got '%s'", got.Name)
	}
}

func TestHandleReleaseGetNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, _ := http.NewRequest("GET", apiReleases+"9999", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleReleaseGetInvalidID(t *testing.T) {
	req, _ := http.NewRequest("GET", apiReleases+"abc", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleReleasePut(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	rel.Name = "v1.1"
	body, _ := json.Marshal(rel)
	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(rel.ID), bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var got Release
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "v1.1" {
		t.Errorf("expected name 'v1.1', got '%s'", got.Name)
	}
}

func TestHandleReleasePutNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(Release{Name: "ghost"})
	req, _ := http.NewRequest("PUT", apiReleases+"9999", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleReleasePutClosedForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	if err := TriggerRelease(rel.ID, false); err != nil {
		t.Fatalf("TriggerRelease failed: %v", err)
	}

	rel.Name = "changed"
	body, _ := json.Marshal(rel)
	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(rel.ID), bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

func TestHandleReleaseDelete(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("DELETE", apiReleases+strconv.Itoa(rel.ID), nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNoContent)
	}
}

func TestHandleReleaseDeleteNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, _ := http.NewRequest("DELETE", apiReleases+"9999", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleReleaseTrigger(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	body, _ := json.Marshal(map[string]bool{"archive_done": false})
	req, _ := http.NewRequest("POST", apiReleases+strconv.Itoa(rel.ID)+"/release", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var got Release
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Status != ReleaseStatusClosed {
		t.Errorf("expected status closed, got %s", got.Status)
	}
}

func TestHandleReleaseTriggerNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(map[string]bool{"archive_done": false})
	req, _ := http.NewRequest("POST", apiReleases+"9999/release", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleReleaseTriggerInvalidBody(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("POST", apiReleases+strconv.Itoa(rel.ID)+"/release", bytes.NewBufferString("not-json"))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleReleaseReopen(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	if err := TriggerRelease(rel.ID, false); err != nil {
		t.Fatalf("TriggerRelease failed: %v", err)
	}

	req, _ := http.NewRequest("POST", apiReleases+strconv.Itoa(rel.ID)+"/reopen", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	var got Release
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Status != ReleaseStatusOpen {
		t.Errorf("expected status open, got %s", got.Status)
	}
}

func TestHandleReleaseReopenNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, _ := http.NewRequest("POST", apiReleases+"9999/reopen", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleReleaseSubpathMethodNotAllowed(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("GET", apiReleases+strconv.Itoa(rel.ID)+"/release", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleReleaseSubpathUnknown(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("POST", apiReleases+strconv.Itoa(rel.ID)+"/unknown", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleReleaseMethodNotAllowed(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("PATCH", apiReleases+strconv.Itoa(rel.ID), nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestCheckReleaseInvalidRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	releaseID := 9999
	issue := &Issue{ProjectID: 1, ReleaseID: &releaseID}
	rr := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", apiIssues, nil)
	req = makeAdminCtx(req)

	result := checkRelease(rr, issue, testAssigneeEmail)
	if result {
		t.Error("expected checkRelease to return false for non-existent release")
	}
	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleCreateIssueWithValidRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, ReleaseID: &rel.ID}
	body, _ := json.Marshal(issue)

	req, _ := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleCreateIssue).ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusCreated)
	}
}

func TestHandleCreateIssueWithInvalidRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	invalidReleaseID := 9999
	issue := &Issue{Title: testIssueTitleNew, Status: StatusOpen, ProjectID: 1, ReleaseID: &invalidReleaseID}
	body, _ := json.Marshal(issue)

	req, _ := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleCreateIssue).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

// ---------------------------------------------------------------------------
// Release handler error and forbidden paths
// ---------------------------------------------------------------------------

// unknownRole is a UserRole value that has no permissions in the policy table.
const unknownRole UserRole = "unknown"

// --- checkRelease DB error (lines 123-127) ---

func TestCheckReleaseDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	releaseID := 1
	issue := &Issue{ProjectID: 1, ReleaseID: &releaseID}
	rr := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", apiIssues, nil)
	req = makeAdminCtx(req)

	result := checkRelease(rr, issue, testAssigneeEmail)
	if result {
		t.Error("expected checkRelease to return false on DB error")
	}
	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- issueContentHash with ReleaseID (lines 371-373) ---

func TestHandleIssuePutWithReleaseID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1, ReleaseID: &rel.ID}
	if err := CreateIssue(issue); err != nil {
		t.Fatalf("CreateIssue failed: %v", err)
	}

	issue.Title = "Updated"
	body, _ := json.Marshal(issue)
	req, _ := http.NewRequest("PUT", apiIssuesBase+strconv.Itoa(issue.ID), bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleIssue).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
}

// --- handleProjectReleasesGet forbidden (lines 1637-1640) ---

func TestHandleProjectReleasesGetUnknownRoleForbidden(t *testing.T) {
	req, _ := http.NewRequest("GET", apiProjectReleases, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, unknownRole))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// --- handleProjectReleasesGet DB error (lines 1642-1646) ---

func TestHandleProjectReleasesGetDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	req, _ := http.NewRequest("GET", apiProjectReleases, nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handleProjectReleasesPost invalid JSON (lines 1659-1661) ---

func TestHandleProjectReleasesPostInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req, _ := http.NewRequest("POST", apiProjectReleases, bytes.NewBufferString(invalidJSON))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

// --- handleProjectReleasesPost DB error (lines 1669-1671) ---

func TestHandleProjectReleasesPostDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	body, _ := json.Marshal(Release{Name: "v1.0"})
	req, _ := http.NewRequest("POST", apiProjectReleases, bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleProject).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- HandleRelease sub-path forbidden (lines 1702-1705) ---

func TestHandleReleaseTriggerForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	body, _ := json.Marshal(map[string]bool{"archive_done": false})
	req, _ := http.NewRequest("POST", apiReleases+strconv.Itoa(rel.ID)+"/release", bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// --- HandleRelease GET forbidden (lines 1719-1722) ---

func TestHandleReleaseGetForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("GET", apiReleases+strconv.Itoa(rel.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, unknownRole))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// --- HandleRelease PUT forbidden (lines 1725-1728) ---

func TestHandleReleasePutForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	rel.Name = "v1.1"
	body, _ := json.Marshal(rel)
	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(rel.ID), bytes.NewBuffer(body))
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// --- HandleRelease DELETE forbidden (lines 1731-1734) ---

func TestHandleReleaseDeleteForbidden(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("DELETE", apiReleases+strconv.Itoa(rel.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleUser))
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusForbidden)
	}
}

// --- handleGetRelease DB error (lines 1743-1747) ---

func TestHandleReleaseGetDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	req, _ := http.NewRequest("GET", apiReleases+"1", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handlePutRelease invalid JSON (lines 1760-1762) ---

func TestHandleReleasePutInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(rel.ID), bytes.NewBufferString(invalidJSON))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

// --- handlePutRelease GetReleaseByID DB error (lines 1766-1770) ---

func TestHandleReleasePutGetDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	body, _ := json.Marshal(Release{Name: "v1.0"})
	req, _ := http.NewRequest("PUT", apiReleases+"1", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handlePutRelease UpdateRelease duplicate name (lines 1785-1787) ---

func TestHandleReleasePutDuplicateName(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := CreateRelease(&Release{ProjectID: 1, Name: "v1.0"}); err != nil {
		t.Fatalf("CreateRelease r1 failed: %v", err)
	}
	r2 := &Release{ProjectID: 1, Name: "v2.0"}
	if err := CreateRelease(r2); err != nil {
		t.Fatalf("CreateRelease r2 failed: %v", err)
	}

	r2.Name = "v1.0"
	body, _ := json.Marshal(r2)
	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(r2.ID), bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusConflict)
	}
}

// --- handlePutRelease UpdateRelease internal DB error (lines 1789-1791) ---

func TestHandleReleasePutUpdateDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	DB.Exec("DROP TABLE releases")

	rel.Name = "v1.1"
	body, _ := json.Marshal(rel)
	req, _ := http.NewRequest("PUT", apiReleases+strconv.Itoa(rel.ID), bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handleDeleteRelease internal DB error (lines 1812-1814) ---

func TestHandleReleaseDeleteDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	req, _ := http.NewRequest("DELETE", apiReleases+"1", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handleTriggerRelease internal DB error (lines 1835-1837) ---

func TestHandleReleaseTriggerDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	body, _ := json.Marshal(map[string]bool{"archive_done": false})
	req, _ := http.NewRequest("POST", apiReleases+"1/release", bytes.NewBuffer(body))
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}

// --- handleReopenRelease internal DB error (lines 1858-1860) ---

func TestHandleReleaseReopenDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	DB.Exec("DROP TABLE releases")

	req, _ := http.NewRequest("POST", apiReleases+"1/reopen", nil)
	req = makeAdminCtx(req)
	rr := httptest.NewRecorder()
	http.HandlerFunc(HandleRelease).ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
	}
}
