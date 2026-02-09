package backend

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	wrongStatusCodeMsg = "handler returned wrong status code: got %v want %v"
)

func TestWithLogging(t *testing.T) {
	// Create a simple handler that returns 200 OK
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Wrap it with the logging middleware
	loggingHandler := WithLogging(nextHandler)

	// Create a request
	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	// Serve the request
	loggingHandler.ServeHTTP(rr, req)

	// Verify status code
	if status := rr.Code; status != http.StatusOK {
		t.Errorf(wrongStatusCodeMsg, status, http.StatusOK)
	}

	// Verify body
	if body := rr.Body.String(); body != "OK" {
		t.Errorf("handler returned unexpected body: got %v want %v", body, "OK")
	}

	// We can't easily verify stdout capture here without more complex setup,
	// but we've verified the middleware passes through correctly.
}

func TestParseLogLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected slog.Level
		wantErr  bool
	}{
		{"debug", slog.LevelDebug, false},
		{"DEBUG", slog.LevelDebug, false},
		{"info", slog.LevelInfo, false},
		{"warn", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		{"invalid", slog.LevelInfo, true},
	}

	for _, tt := range tests {
		got, err := parseLogLevel(tt.input)
		if (err != nil) != tt.wantErr {
			t.Errorf("parseLogLevel(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			continue
		}
		if !tt.wantErr && got != tt.expected {
			t.Errorf("parseLogLevel(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestResponseWriterWrapper(t *testing.T) {
	rr := httptest.NewRecorder()
	wrapper := &responseWriterWrapper{ResponseWriter: rr, statusCode: http.StatusOK}

	content := []byte("test content")
	n, err := wrapper.Write(content)
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}
	if n != len(content) {
		t.Errorf("Expected to write %d bytes, wrote %d", len(content), n)
	}
	if wrapper.written != int64(len(content)) {
		t.Errorf("Expected written to be %d, got %d", len(content), wrapper.written)
	}

	wrapper.WriteHeader(http.StatusCreated)
	if wrapper.statusCode != http.StatusCreated {
		t.Errorf("Expected statusCode to be %d, got %d", http.StatusCreated, wrapper.statusCode)
	}
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
			name:           "GET /api/issues (Method Not Allowed)",
			method:         "GET",
			path:           "/api/issues",
			handler:        HandleCreateIssue, // Handler for /api/issues
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "POST /api/issues (Success)",
			method:         "POST",
			path:           "/api/issues",
			handler:        HandleCreateIssue, // Handler for /api/issues
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "GET /api/issues/active",
			method:         "GET",
			path:           "/api/issues/active",
			handler:        HandleActiveIssues,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /api/issues/archived",
			method:         "GET",
			path:           "/api/issues/archived",
			handler:        HandleArchivedIssues,
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
			var req *http.Request
			if tt.method == "POST" {
				// Need body for create
				issue := &Issue{Title: "New Issue", Status: StatusOpen}
				body, _ := json.Marshal(issue)
				req = httptest.NewRequest(tt.method, tt.path, bytes.NewBuffer(body))
			} else {
				req = httptest.NewRequest(tt.method, tt.path, nil)
			}

			rr := httptest.NewRecorder()

			tt.handler(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf(wrongStatusCodeMsg,
					status, tt.expectedStatus)
			}
		})
	}
}
