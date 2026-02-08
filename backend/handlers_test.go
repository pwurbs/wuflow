package backend

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	apiIssues            = "/api/issues"
	apiIssues1           = "/api/issues/1"
	apiIssues1Tasks      = "/api/issues/1/tasks"
	apiTasks1            = "/api/tasks/1"
	apiLabels            = "/api/labels"
	apiLabels1           = "/api/labels/1"
	invalidJSON          = "invalid json"
	wrongStatusCode      = "handler returned wrong status code: got %v want %v"
	toDelete             = "To Delete"
	expectedTitleUpdated = "expected title 'Updated', got '%s'"
)

func TestHandleIssuesGet(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	CreateIssue(&Issue{Title: "Issue 1", Status: StatusOpen})

	req, err := http.NewRequest("GET", apiIssues, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssues)

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

func TestHandleIssuesPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "New Issue", Status: StatusOpen}
	body, _ := json.Marshal(issue)

	req, err := http.NewRequest("POST", apiIssues, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssues)

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

	issues, err := GetAllIssues()
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

	issues, _ := GetAllIssues()
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

	req, err := http.NewRequest("GET", "/api/issues/999", nil)
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
	issues, _ := GetAllIssues()
	if issues[0].Title != "Updated" {
		t.Errorf(expectedTitleUpdated, issues[0].Title)
	}
}

func TestHandleTasksPost(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)

	task := &Task{Title: "New Task"}
	body, _ := json.Marshal(task)

	// URL path structure: /api/issues/{id}/tasks
	req, err := http.NewRequest("POST", apiIssues1Tasks, bytes.NewBuffer(body))
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTasks)

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

func TestHandleIssuesPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiIssues, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssues)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleIssueInvalidID(t *testing.T) {
	req, err := http.NewRequest("GET", "/api/issues/invalid", nil)
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

func TestHandleTasksPostInvalidJSON(t *testing.T) {
	req, err := http.NewRequest("POST", apiIssues1Tasks, bytes.NewBufferString(invalidJSON))
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTasks)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleTasksPostInvalidIssueID(t *testing.T) {
	req, err := http.NewRequest("POST", "/api/issues/invalid/tasks", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTasks)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode,
			status, http.StatusBadRequest)
	}
}

func TestHandleTaskInvalidID(t *testing.T) {
	req, err := http.NewRequest("PUT", "/api/tasks/invalid", nil)
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

func TestHandleIssuesMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("DELETE", apiIssues, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleIssues)

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

func TestHandleTasksMethodNotAllowed(t *testing.T) {
	req, err := http.NewRequest("GET", apiIssues1Tasks, nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTasks)

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

func TestHandleTasksPostInvalidURL(t *testing.T) {
	// Test with URL that doesn't match expected pattern
	req, err := http.NewRequest("POST", "/api/issues/tasks", nil)
	if err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(HandleTasks)

	handler.ServeHTTP(rr, req)

	if status := rr.Code; status != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, status, http.StatusBadRequest)
	}
}

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

	issueBody, _ := json.Marshal(&Issue{Title: "Test"})
	taskBody, _ := json.Marshal(&Task{Title: "Test"})
	labelBody, _ := json.Marshal(&Label{Name: "Test"})

	tests := []struct {
		name    string
		method  string
		url     string
		body    []byte
		handler http.HandlerFunc
	}{
		{"HandleIssues_GET", "GET", apiIssues, nil, HandleIssues},
		{"HandleIssues_POST", "POST", apiIssues, issueBody, HandleIssues},
		{"HandleIssue_PUT", "PUT", apiIssues1, issueBody, HandleIssue},
		{"HandleIssue_DELETE", "DELETE", apiIssues1, nil, HandleIssue},
		{"HandleTasks_POST", "POST", apiIssues1Tasks, taskBody, HandleTasks},
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
			tt.handler(rr, req)
			if rr.Code != http.StatusInternalServerError {
				t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
			}
		})
	}
}
