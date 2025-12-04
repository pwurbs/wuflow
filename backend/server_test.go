package backend

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleIssuesRoute(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	tests := []struct {
		name           string
		method         string
		url            string
		body           interface{}
		expectedStatus int
		expectedBody   string // optional substring match
	}{
		{
			name:           "Route to HandleTasks (POST) - Success",
			method:         "POST",
			url:            "/api/issues/1/tasks",
			body:           map[string]interface{}{"title": "New Task"},
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "Route to HandleTasks (PUT) - Method Not Allowed",
			method:         "PUT",
			url:            "/api/issues/1/tasks",
			body:           nil,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "Route to HandleIssue (PUT) - Success",
			method:         "PUT",
			url:            "/api/issues/1",
			body:           map[string]interface{}{"title": "Updated Issue", "status": "todo", "position": 1},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Route to HandleIssue (POST) - Method Not Allowed",
			method:         "POST",
			url:            "/api/issues/1",
			body:           nil,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "Route to HandleIssue (Invalid ID)",
			method:         "PUT",
			url:            "/api/issues/invalid",
			body:           nil,
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "Invalid ID",
		},
	}

	// Pre-populate DB for happy paths
	// We need an issue with ID 1 for the task creation and issue update to work without DB errors (FK constraints or not found)
	// CreateIssue uses AUTOINCREMENT, so first issue should be ID 1.
	i := &Issue{Title: "Test Issue", Status: "todo", Position: 1}
	if err := CreateIssue(i); err != nil {
		t.Fatalf("Failed to create seed issue: %v", err)
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var reqBody []byte
			var err error
			if tt.body != nil {
				reqBody, err = json.Marshal(tt.body)
				if err != nil {
					t.Fatalf("Failed to marshal body: %v", err)
				}
			}

			req, err := http.NewRequest(tt.method, tt.url, bytes.NewBuffer(reqBody))
			if err != nil {
				t.Fatalf("Failed to create request: %v", err)
			}

			rr := httptest.NewRecorder()
			handler := http.HandlerFunc(HandleIssuesRoute)

			handler.ServeHTTP(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf("handler returned wrong status code: got %v want %v",
					status, tt.expectedStatus)
			}

			if tt.expectedBody != "" {
				if body := rr.Body.String(); !strings.Contains(body, tt.expectedBody) {
					t.Errorf("handler returned unexpected body: got %v want substring %v",
						body, tt.expectedBody)
				}
			}
		})
	}
}
