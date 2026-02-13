package backend

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
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
)

func TestHandleActiveIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateIssue(&Issue{Title: "Issue 1", Status: StatusOpen})

	req, err := http.NewRequest("GET", apiIssues, nil)
	if err != nil {
		t.Fatal(err)
	}

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

	issue := &Issue{Title: "New Issue", Status: StatusOpen}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

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

	if createdIssue.Title != "New Issue" {
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

	task := &Task{Title: "New Task", IssueID: issue.ID}
	body, _ := json.Marshal(task)

	// URL path structure: /api/tasks
	req, err := http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

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

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
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

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleLabels)

	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
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
	closedDB, _ := sql.Open("sqlite3", ":memory:")
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
			rr := httptest.NewRecorder()
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
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
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssue)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("PUT %s: "+wrongStatusCode,
			invalidIssuePath, status, http.StatusNotFound)
	}

	// 2. DELETE non-existent issue
	req, _ = http.NewRequest("DELETE", invalidIssuePath, nil)
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
			rr := httptest.NewRecorder()
			handle := http.HandlerFunc(HandleLabels)
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
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
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTask)
	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusNotFound {
		t.Errorf("PUT "+apiTasksBase+"999: "+wrongStatusCode,
			status, http.StatusNotFound)
	}

	// 2. DELETE non-existent task
	req, _ = http.NewRequest("DELETE", apiTasksBase+"999", nil)
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
	rr := httptest.NewRecorder()
	HandleIssue(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("PUT %s: expected 403 Forbidden, got %v", archivedIssuePath, rr.Code)
	}

	// 3. Try to unarchive the issue (allowed)
	archivedIssue.Status = StatusDone
	body, _ = json.Marshal(archivedIssue)
	req, _ = http.NewRequest("PUT", archivedIssuePath, bytes.NewBuffer(body))
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("PUT %s (unarchive): expected 200 OK, got %v", archivedIssuePath, rr.Code)
	}

	// 4. Create another archived issue for task tests
	archivedIssue2 := &Issue{Title: "Archived with Tasks", Status: StatusArchive}
	CreateIssue(archivedIssue2)
	task := &Task{IssueID: archivedIssue2.ID, Title: "Task"}
	// Bypass HandleCreateTask to create a task for an archived issue for testing
	CreateTask(task)
	taskPath := apiTasksBase + strconv.Itoa(task.ID)

	// 5. Try to add a task to archived issue (blocked)
	newTask := &Task{IssueID: archivedIssue2.ID, Title: "New Task"}
	body, _ = json.Marshal(newTask)
	req, _ = http.NewRequest("POST", apiTasks, bytes.NewBuffer(body))
	rr = httptest.NewRecorder()
	HandleCreateTask(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("POST /api/tasks: expected 403 Forbidden, got %v", rr.Code)
	}

	// 6. Try to update task of archived issue (blocked)
	task.Title = "Mutated Task"
	body, _ = json.Marshal(task)
	req, _ = http.NewRequest("PUT", taskPath, bytes.NewBuffer(body))
	rr = httptest.NewRecorder()
	HandleTask(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("PUT %s: expected 403 Forbidden, got %v", taskPath, rr.Code)
	}

	// 7. Try to delete task of archived issue (blocked)
	req, _ = http.NewRequest("DELETE", taskPath, nil)
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
	rr = httptest.NewRecorder()
	HandleIssue(rr, req)
	// 9. Try to delete archived issue (blocked)
	archivedIssue4 := &Issue{Title: "Archived 4", Status: StatusArchive}
	CreateIssue(archivedIssue4)
	archivedDeletePath := apiIssuesBase + strconv.Itoa(archivedIssue4.ID)

	req, _ = http.NewRequest("DELETE", archivedDeletePath, nil)
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
	closedDB, _ := sql.Open("sqlite3", ":memory:")
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

			rr := httptest.NewRecorder()
			// Inject admin role into context so handlers with internal role checks pass
			ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
			req = req.WithContext(ctx)
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
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected 403 Forbidden for editing archived issue, got %d", rr.Code)
	}
}

func TestHandleDeleteIssueArchived(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Archived", Status: StatusArchive}
	CreateIssue(issue)
	path := apiIssuesBase + strconv.Itoa(issue.ID)

	req := httptest.NewRequest("DELETE", path, nil)
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
	rr := httptest.NewRecorder()

	HandleUser(rr, req) // This tests handleUpdateUser which calls checkLastAdminProtection

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
	path := apiIssuesBase + strconv.Itoa(issue.ID)

	// Unarchive it (set status to Done)
	updateBody := map[string]interface{}{
		"title":    "Archived",
		"status":   "Done", // Valid transition
		"priority": "Normal",
	}
	body, _ := json.Marshal(updateBody)
	req := httptest.NewRequest("PUT", path, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	HandleIssue(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for unarchiving issue, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	updated, _ := GetIssueByID(issue.ID)
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
