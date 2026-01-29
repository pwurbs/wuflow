package backend

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	testIssueTitle     = "Test Issue"
	wrongStatusCodeMsg = "handler returned wrong status code: got %v want %v"
)

type issueRouteTestCase struct {
	name           string
	method         string
	url            string
	body           interface{}
	expectedStatus int
	expectedBody   string
}

func TestHandleIssuesRoute(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	tests := []issueRouteTestCase{
		{
			name:           "Route to HandleTasks (POST) - Success",
			method:         "POST",
			url:            apiIssues1Tasks,
			body:           map[string]interface{}{"title": "New Task"},
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "Route to HandleTasks (PUT) - Method Not Allowed",
			method:         "PUT",
			url:            apiIssues1Tasks,
			body:           nil,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "Route to HandleIssue (PUT) - Success",
			method:         "PUT",
			url:            apiIssues1,
			body:           map[string]interface{}{"title": "Updated Issue", "status": "todo", "position": 1},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Route to HandleIssue (POST) - Method Not Allowed",
			method:         "POST",
			url:            apiIssues1,
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
		{
			name:           "Update Issue with Label (PUT) - Success",
			method:         "PUT",
			url:            apiIssues1,
			body:           map[string]interface{}{"title": "Labeled Issue", "status": "todo", "label": map[string]interface{}{"id": 1}},
			expectedStatus: http.StatusOK,
		},
	}

	seedIssueForTest(t)

	for _, tt := range tests {
		executeIssueTest(t, tt)
	}
}

func seedIssueForTest(t *testing.T) {
	// Pre-populate DB for happy paths
	// We need an issue with ID 1 for the task creation and issue update to work without DB errors (FK constraints or not found)
	// CreateIssue uses AUTOINCREMENT, so first issue should be ID 1.
	i := &Issue{Title: testIssueTitle, Status: "todo", Position: 1}
	if err := CreateIssue(i); err != nil {
		t.Fatalf("Failed to create seed issue: %v", err)
	}
}

func executeIssueTest(t *testing.T, tt issueRouteTestCase) {
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
			t.Errorf(wrongStatusCodeMsg,
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

// TestServerRoutes tests that the server routes are properly configured
func TestServerRoutes(t *testing.T) {
	// We can't test StartServer directly as it blocks with ListenAndServe
	// But we can test that the routes work correctly by simulating requests
	setupTestDB()
	defer teardownTestDB()

	// Create a test issue for route testing
	CreateIssue(&Issue{Title: "Test Issue", Status: StatusOpen})

	tests := []struct {
		name           string
		method         string
		path           string
		handler        http.HandlerFunc
		expectedStatus int
	}{
		{
			name:           "GET /api/issues",
			method:         "GET",
			path:           "/api/issues",
			handler:        HandleIssues,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /api/labels",
			method:         "GET",
			path:           "/api/labels",
			handler:        HandleLabels,
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rr := httptest.NewRecorder()

			tt.handler(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf(wrongStatusCodeMsg,
					status, tt.expectedStatus)
			}
		})
	}
}

// TestHandleIssuesRouteEdgeCases tests edge cases for HandleIssuesRoute
func TestHandleIssuesRouteEdgeCases(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create test issue
	CreateIssue(&Issue{Title: testIssueTitle, Status: StatusOpen})

	tests := []struct {
		name           string
		method         string
		url            string
		expectedStatus int
	}{
		{
			name:           "DELETE request to /api/issues/1/tasks",
			method:         "DELETE",
			url:            "/api/issues/1/tasks",
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "GET request to /api/issues/1/tasks",
			method:         "GET",
			url:            "/api/issues/1/tasks",
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.url, nil)
			rr := httptest.NewRecorder()

			HandleIssuesRoute(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf(wrongStatusCodeMsg,
					status, tt.expectedStatus)
			}
		})
	}
}
