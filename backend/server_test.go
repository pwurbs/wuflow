package backend

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
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

func TestIsStaticAsset(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/style.css", true},
		{"/script.js", true},
		{"/image.png", true},
		{"/image.jpg", true},
		{"/font.woff2", true},
		{"/login.html", false}, // .html is not in the list
		{"/api/users", false},
	}

	for _, tt := range tests {
		if got := isStaticAsset(tt.path); got != tt.expected {
			t.Errorf("isStaticAsset(%q) = %v, want %v", tt.path, got, tt.expected)
		}
	}
}

func TestIsPublicAsset(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/logo.png", true},
		{"/js/login.js", true},
		{"/styles/pages/login.css", true},
		{"/js/app.js", false},
		{"/styles/main.css", false},
		{"/index.html", false},
	}

	for _, tt := range tests {
		if got := isPublicAsset(tt.path); got != tt.expected {
			t.Errorf("isPublicAsset(%q) = %v, want %v", tt.path, got, tt.expected)
		}
	}
}

func TestHandleLoginHTML(t *testing.T) {
	// Create a dummy handler that checks the path
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/login.html" {
			t.Errorf("Expected path /login.html, got %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := HandleLoginHTML(nextHandler)
	req := httptest.NewRequest("GET", "/login", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
	}
}

func TestHandleStaticFiles(t *testing.T) {
	InitJWTSecret("testsecret")

	t.Run("Public Asset", testPublicAsset)
	t.Run("Private Asset No Auth", testPrivateAssetNoAuth)
	t.Run("HTML No Auth", testHTMLNoAuth)
	t.Run("HTML Valid Auth", testHTMLValidAuth)
	t.Run("HTML Expired Access Valid Refresh", testHTMLExpiredAccessValidRefresh)
}

func testPublicAsset(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := HandleStaticFiles(nextHandler)
	req := httptest.NewRequest("GET", "/js/login.js", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for public asset, got %d", rr.Code)
	}
}

func testPrivateAssetNoAuth(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called for private asset without auth")
	})
	handler := HandleStaticFiles(nextHandler)
	req := httptest.NewRequest("GET", "/js/app.js", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusFound {
		t.Errorf("Expected 302 Redirect for private asset, got %d", rr.Code)
	}
}

func testHTMLNoAuth(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})
	handler := HandleStaticFiles(nextHandler)
	req := httptest.NewRequest("GET", "/index.html", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusFound {
		t.Errorf("Expected 302 Redirect, got %d", rr.Code)
	}
	if loc := rr.Header().Get("Location"); loc != "/login" {
		t.Errorf("Expected redirect to /login, got %s", loc)
	}
}

func testHTMLValidAuth(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := HandleStaticFiles(nextHandler)
	req := httptest.NewRequest("GET", "/", nil)

	// Create valid token
	user := &User{ID: 1, Email: "test@example.com", Role: RoleAdmin, Active: true}
	token, _ := GenerateAccessToken(user)
	req.AddCookie(&http.Cookie{Name: cookieAccessToken, Value: token})

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK for authenticated request, got %d", rr.Code)
	}
}

func testHTMLExpiredAccessValidRefresh(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	InitJWTSecret("testsecret")

	// Create user
	user := &User{Email: "refresh@example.com", Role: RoleUser, Active: true}
	if err := CreateUser(user); err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}
	// Fetch user to get ID
	u, _ := GetUserByEmail("refresh@example.com")
	user.ID = u.ID // Ensure ID is set

	// Create expired access token manually
	claims := CustomClaims{
		UserID: u.ID,
		Email:  u.Email,
		Role:   u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Minute)), // Expired 1 min ago
			Subject:   u.Email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	expiredAccessToken, _ := token.SignedString(jwtSecret)

	// Create Session
	session := &Session{
		UserID:    u.ID,
		ExpiresAt: time.Now().Add(refreshTokenDuration),
	}
	CreateSession(session)

	// Create valid refresh token
	validRefreshToken, tokenHash, _ := GenerateRefreshToken(session.ID)
	session.TokenHash = tokenHash
	UpdateSession(session)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := HandleStaticFiles(nextHandler)

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieAccessToken, Value: expiredAccessToken})
	req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: validRefreshToken})

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK (refreshed), got %d. Location: %s", rr.Code, rr.Header().Get("Location"))
	}

	// Check for new cookies (Set-Cookie header)
	cookies := rr.Result().Cookies()
	foundAccess := false
	foundRefresh := false
	for _, c := range cookies {
		if c.Name == cookieAccessToken {
			foundAccess = true
			if c.Value == expiredAccessToken {
				t.Error("Access token cookie was not updated")
			}
		}
		if c.Name == cookieRefreshToken {
			foundRefresh = true
		}
	}

	if !foundAccess {
		t.Error("Expected new access token cookie to be set")
	}
	if !foundRefresh {
		t.Error("Expected new refresh token cookie to be set")
	}
}
