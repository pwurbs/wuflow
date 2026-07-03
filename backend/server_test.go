package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	wrongStatusCodeMsg = "handler returned wrong status code: got %v want %v"
	expectedStatusMsg  = "expected status %d, got %d"
	apiTestPath        = "/api/test"
)

func TestValidatePathMiddleware(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		expectedStatus int
		expectNext     bool
	}{
		{
			name:           "Valid request without query params",
			path:           apiIssues,
			expectedStatus: http.StatusOK,
			expectNext:     true,
		},
		{
			name:           "Invalid request with query params",
			path:           apiIssues + "?foo=bar",
			expectedStatus: http.StatusBadRequest,
			expectNext:     false,
		},
		{
			name:           "Invalid request with empty value param",
			path:           apiIssues + "?foo=",
			expectedStatus: http.StatusBadRequest,
			expectNext:     false,
		},
		{
			name:           "Invalid request with flag param",
			path:           apiIssues + "?debug",
			expectedStatus: http.StatusBadRequest,
			expectNext:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextCalled := false
			nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("OK"))
			})

			middleware := ValidatePathMiddleware(nextHandler)

			req := httptest.NewRequest("GET", tt.path, nil)
			w := httptest.NewRecorder()

			middleware.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf(expectedStatusMsg, tt.expectedStatus, w.Code)
			}
			if nextCalled != tt.expectNext {
				t.Errorf("expected next handler to be called: %v, got %v", tt.expectNext, nextCalled)
			}
		})
	}
}

func TestLimitBodyMiddleware(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	middleware := LimitBodyMiddleware(nextHandler)

	t.Run("Under limit", func(t *testing.T) {
		body := make([]byte, 32*1024) // Exactly 32 KB
		req := httptest.NewRequest("POST", "/", bytes.NewReader(body))
		w := httptest.NewRecorder()
		middleware.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf(expectedStatusMsg, http.StatusOK, w.Code)
		}
	})

	t.Run("Over limit", func(t *testing.T) {
		body := make([]byte, 32*1024+1) // 32 KB + 1 byte
		req := httptest.NewRequest("POST", "/", bytes.NewReader(body))
		w := httptest.NewRecorder()
		middleware.ServeHTTP(w, req)

		// The middleware itself doesn't return 413, it just wraps the body.
		// The error happens when the next handler tries to read it.
		if w.Code != http.StatusInternalServerError {
			t.Errorf(expectedStatusMsg, http.StatusInternalServerError, w.Code)
		}
		if !strings.Contains(w.Body.String(), "http: request body too large") {
			t.Errorf("expected error message to contain 'too large', got %q", w.Body.String())
		}
	})
}

func TestRequireJSONMiddleware(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	middleware := RequireJSONMiddleware(nextHandler)

	tests := []struct {
		name           string
		method         string
		contentType    string
		expectedStatus int
	}{
		{"GET No Content-Type", "GET", "", http.StatusOK},
		{"POST No Content-Type", "POST", "", http.StatusUnsupportedMediaType},
		{"POST Plain Text", "POST", "text/plain", http.StatusUnsupportedMediaType},
		{"POST JSON", "POST", contentTypeJSON, http.StatusOK},
		{"POST JSON charset", "POST", contentTypeJSON + "; charset=utf-8", http.StatusOK},
		{"PUT No Content-Type", "PUT", "", http.StatusUnsupportedMediaType},
		{"PUT JSON", "PUT", contentTypeJSON, http.StatusOK},
		{"DELETE No Content-Type", "DELETE", "", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/", nil)
			if tt.contentType != "" {
				req.Header.Set(headerContentType, tt.contentType)
			}
			w := httptest.NewRecorder()
			middleware.ServeHTTP(w, req)
			if w.Code != tt.expectedStatus {
				t.Errorf(expectedStatusMsg, tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestSecurityHeadersMiddleware(t *testing.T) {
	nextCalled := false
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := SecurityHeadersMiddleware(nextHandler)
	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	middleware.ServeHTTP(rr, req)

	expectedCSP := "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
	if got := rr.Header().Get("Content-Security-Policy"); got != expectedCSP {
		t.Errorf("CSP header mismatch:\ngot:  %q\nwant: %q", got, expectedCSP)
	}

	if !nextCalled {
		t.Error("Expected next handler to be called")
	}
}

func TestWithLogging(t *testing.T) {
	nextCalled := false
	// Create a simple handler that returns 200 OK
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
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

	if !nextCalled {
		t.Error("Expected next handler to be called")
	}

	// We can't easily verify stdout capture here without more complex setup,
	// but we've verified the middleware passes through correctly.
}

// captureLogs swaps safeLogger for one that writes JSON to a buffer at the
// given level, and returns the buffer plus a restore func. Used to assert
// that a middleware emits an expected log line.
func captureLogs(t *testing.T, level slog.Level) (*bytes.Buffer, func()) {
	t.Helper()
	buf := &bytes.Buffer{}
	orig := safeLogger
	safeLogger = slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: level}))
	return buf, func() { safeLogger = orig }
}

func TestTimeoutMiddleware_HandlerCompletesInTime(t *testing.T) {
	// Handler runs synchronously and completes well within the deadline.
	// Expectations: no WARN log, ctx.Err() is nil during handler execution,
	// status 200 is propagated.
	buf, restore := captureLogs(t, slog.LevelWarn)
	defer restore()

	var ctxErrDuringHandler error
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctxErrDuringHandler = r.Context().Err()
		w.WriteHeader(http.StatusOK)
	})
	h := TimeoutMiddleware(100 * time.Millisecond)(next)

	req := httptest.NewRequest("GET", "/api/x", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(expectedStatusMsg, http.StatusOK, rr.Code)
	}
	if ctxErrDuringHandler != nil {
		t.Errorf("expected no ctx error during handler, got %v", ctxErrDuringHandler)
	}
	if strings.Contains(buf.String(), "Request exceeded application timeout") {
		t.Errorf("did not expect a timeout WARN, got: %s", buf.String())
	}
}

func TestTimeoutMiddleware_DeadlineFires(t *testing.T) {
	// Handler sleeps past the deadline, then checks its own ctx.
	// Expectations: ctx.Err() reports DeadlineExceeded by the time the handler
	// returns, and the middleware emits a WARN log line afterwards.
	buf, restore := captureLogs(t, slog.LevelWarn)
	defer restore()

	var ctxErrAfterSleep error
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Sleep longer than the configured timeout so the deadline fires.
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
		}
		ctxErrAfterSleep = r.Context().Err()
		w.WriteHeader(http.StatusOK)
	})
	timeout := 20 * time.Millisecond
	h := TimeoutMiddleware(timeout)(next)

	req := httptest.NewRequest("POST", "/api/slow", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if !errors.Is(ctxErrAfterSleep, context.DeadlineExceeded) {
		t.Errorf("expected context.DeadlineExceeded inside handler, got %v", ctxErrAfterSleep)
	}

	// The WARN log line must be emitted with the expected fields.
	out := buf.String()
	if !strings.Contains(out, "Request exceeded application timeout") {
		t.Fatalf("expected timeout WARN log, got: %s", out)
	}
	// Spot-check that structured fields are present in the JSON record.
	// slog's JSON handler renders time.Duration as nanoseconds (int), not "20ms".
	for _, want := range []string{`"method":"POST"`, `"path":"/api/slow"`, `"timeout":20000000`} {
		if !strings.Contains(out, want) {
			t.Errorf("WARN log missing field %s, got: %s", want, out)
		}
	}
}

func TestTimeoutMiddleware_PropagatesDeadlineToContext(t *testing.T) {
	// Verify that the context handed to the handler carries a deadline derived
	// from the configured timeout — this is the behaviour DB queries rely on.
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadline, ok := r.Context().Deadline()
		if !ok {
			t.Error("expected context to have a deadline set")
			return
		}
		remaining := time.Until(deadline)
		if remaining <= 0 || remaining > time.Second {
			t.Errorf("deadline outside expected window: remaining=%v", remaining)
		}
	})
	h := TimeoutMiddleware(500 * time.Millisecond)(next)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
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
	CreateIssue(context.Background(), &Issue{Title: "Test Issue", Status: StatusOpen})

	tests := []struct {
		name           string
		method         string
		path           string
		handler        http.HandlerFunc
		expectedStatus int
	}{
		{
			name:           "GET /api/projects/1/issues (Method Not Allowed)",
			method:         "GET",
			path:           "/api/projects/1/issues",
			handler:        nil,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "POST /api/projects/1/issues (Success)",
			method:         "POST",
			path:           "/api/projects/1/issues",
			handler:        nil,
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "GET /api/projects/1/issues/active",
			method:         "GET",
			path:           "/api/projects/1/issues/active",
			handler:        nil,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /api/projects/1/issues/archived",
			method:         "GET",
			path:           "/api/projects/1/issues/archived",
			handler:        nil,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /api/projects/1/issues/open",
			method:         "GET",
			path:           "/api/projects/1/issues/open",
			handler:        nil,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "GET /api/projects/1/labels",
			method:         "GET",
			path:           "/api/projects/1/labels",
			handler:        nil,
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
			req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))

			rr := httptest.NewRecorder()

			testAPI.ServeHTTP(rr, req)

			if status := rr.Code; status != tt.expectedStatus {
				t.Errorf(wrongStatusCodeMsg,
					status, tt.expectedStatus)
			}
		})
	}
}

// TestAPIMux exercises the public APIMux() constructor (and therefore its
// commonAPI / authAPI middleware-wrapping closures) — production code paths
// that the bareAPIMux-based tests would otherwise miss.
func TestAPIMux(t *testing.T) {
	mux := APIMux("test-version")
	if mux == nil {
		t.Fatal("APIMux returned nil")
	}

	// /api/auth/me is wrapped with authAPI: missing access cookie → 401
	// (AuthMiddleware short-circuits before any handler/DB access).
	req := httptest.NewRequest("GET", "/api/auth/me", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("authAPI route should reject missing auth with 401, got %d", rr.Code)
	}

	// commonAPI wiring: POST /api/auth/login without Content-Type → 415
	// (RequireJSONMiddleware in commonAPI rejects before handler runs).
	req = httptest.NewRequest("POST", "/api/auth/login", bytes.NewBufferString(`{}`))
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnsupportedMediaType {
		t.Errorf("commonAPI should enforce JSON Content-Type with 415, got %d", rr.Code)
	}
}

func TestIsPublicAsset(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/logo.png", true},
		{"/favicon.ico", true},
		{"/favicon-16x16.png", true},
		{"/favicon-32x32.png", true},
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
	InitSecretKey("testsecret")

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

	InitSecretKey("testsecret")

	// Create user
	user := &User{Email: "refresh@example.com", Role: RoleUser, Active: true}
	if err := CreateUser(context.Background(), user); err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}
	// Fetch user to get ID
	u, _ := GetUserByEmail(context.Background(), "refresh@example.com")
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
	sessionTok := generateSessionToken()
	validRefreshToken, tokenHash, _ := GenerateRefreshToken(sessionTok)
	session := &Session{
		UserID:       u.ID,
		SessionToken: sessionTok,
		TokenHash:    tokenHash,
		ExpiresAt:    time.Now().Add(refreshTokenDuration),
	}
	CreateSession(context.Background(), session)

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

func dummyTestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var dummy map[string]any
		if err := json.NewDecoder(r.Body).Decode(&dummy); err != nil {
			if strings.Contains(err.Error(), "http: request body too large") {
				http.Error(w, "Body too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func TestMiddlewareIntegration(t *testing.T) {
	// logging -> csp -> validatePath -> limitBody -> requireJSON -> handler
	stack := WithLogging(SecurityHeadersMiddleware(ValidatePathMiddleware(LimitBodyMiddleware(RequireJSONMiddleware(http.HandlerFunc(dummyTestHandler))))))

	t.Run("Body too large", func(t *testing.T) {
		body := make([]byte, 33*1024)
		req := httptest.NewRequest("POST", apiTestPath, bytes.NewReader(body))
		req.Header.Set(headerContentType, contentTypeJSON)
		w := httptest.NewRecorder()
		stack.ServeHTTP(w, req)

		if w.Code != http.StatusRequestEntityTooLarge && w.Code != http.StatusBadRequest {
			t.Errorf("Expected status 413 or 400, got %d", w.Code)
		}
	})

	t.Run("Missing Content-Type", func(t *testing.T) {
		req := httptest.NewRequest("POST", apiTestPath, strings.NewReader(`{"foo":"bar"}`))
		w := httptest.NewRecorder()
		stack.ServeHTTP(w, req)

		if w.Code != http.StatusUnsupportedMediaType {
			t.Errorf("Expected status 415, got %d", w.Code)
		}
	})

	t.Run("Forbidden query parameters", func(t *testing.T) {
		req := httptest.NewRequest("GET", apiTestPath+"?foo=bar", nil)
		w := httptest.NewRecorder()
		stack.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected status 400, got %d", w.Code)
		}
		if !strings.Contains(w.Body.String(), "Query parameters are not allowed") {
			t.Errorf("Expected specific error message, got %q", w.Body.String())
		}
	})

	t.Run("Valid request", func(t *testing.T) {
		req := httptest.NewRequest("POST", apiTestPath, strings.NewReader(`{"foo":"bar"}`))
		req.Header.Set(headerContentType, contentTypeJSON)
		w := httptest.NewRecorder()
		stack.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("Expected status 200, got %d", w.Code)
		}
	})
}

func TestUserRateLimitMiddleware(t *testing.T) {
	origLimiter := apiLimiter
	apiLimiter = newKeyedLimiter[int](apiMaxRequests, apiRateWindow, apiCleanupEvery)
	origEnabled := apiRateLimitEnabled
	apiRateLimitEnabled = true
	defer func() {
		apiLimiter = origLimiter
		apiRateLimitEnabled = origEnabled
	}()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := UserRateLimitMiddleware(next)

	ctxWith := func(id int) *http.Request {
		req := httptest.NewRequest(http.MethodPost, apiIssues, nil)
		return req.WithContext(context.WithValue(req.Context(), contextKeyUserID, id))
	}

	t.Run("request without user ID passes through", func(t *testing.T) {
		// No userID in context (unauthenticated) — middleware defers to AuthMiddleware.
		req := httptest.NewRequest(http.MethodGet, apiIssues+"/active", nil)
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for request with no user ID, got %d", rr.Code)
		}
	})

	t.Run("GET bypasses rate limiter even when quota exhausted", func(t *testing.T) {
		const uid = 30
		apiLimiter.counts[uid] = &failEntry{count: apiMaxRequests + 10, windowEnd: time.Now().Add(apiRateWindow)}
		req := httptest.NewRequest(http.MethodGet, apiIssues+"/active", nil)
		req = req.WithContext(context.WithValue(req.Context(), contextKeyUserID, uid))
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 for GET (read-only bypass), got %d", rr.Code)
		}
	})

	t.Run("POST allowed under limit", func(t *testing.T) {
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, ctxWith(10))
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("POST blocked after limit", func(t *testing.T) {
		apiLimiter.counts[20] = &failEntry{count: apiMaxRequests, windowEnd: time.Now().Add(apiRateWindow)}
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, ctxWith(20))
		if rr.Code != http.StatusTooManyRequests {
			t.Errorf("expected 429, got %d", rr.Code)
		}
	})

	t.Run("zero userID passes through", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, apiIssues, nil)
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req) // no userID in context
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 pass-through for zero userID, got %d", rr.Code)
		}
	})

	t.Run("disabled rate limit passes through even when quota exhausted", func(t *testing.T) {
		const uid = 99
		apiLimiter.counts[uid] = &failEntry{count: apiMaxRequests + 10, windowEnd: time.Now().Add(apiRateWindow)}
		apiRateLimitEnabled = false
		defer func() { apiRateLimitEnabled = true }()
		req := httptest.NewRequest(http.MethodPost, apiIssues, nil)
		req = req.WithContext(context.WithValue(req.Context(), contextKeyUserID, uid))
		rr := httptest.NewRecorder()
		mw.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("disabled rate limit should pass through, got %d", rr.Code)
		}
	})
}

func TestNeuteredFileSystem(t *testing.T) {
	fsMap := fstest.MapFS{
		"index.html":     &fstest.MapFile{Data: []byte("main index")},
		"test.txt":       &fstest.MapFile{Data: []byte("test")},
		"dir/index.html": &fstest.MapFile{Data: []byte("dir index")},
		"dir/test.txt":   &fstest.MapFile{Data: []byte("test in dir")},
		"nodir/test.txt": &fstest.MapFile{Data: []byte("no index in this dir")},
	}
	nfs := neuteredFileSystem{http.FS(fsMap)}

	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"File exists", "test.txt", false},
		{"Directory with index", "dir", false},
		{"Directory without index", "nodir", true},
		{"File inside directory without index", "nodir/test.txt", false},
		{"Non-existent file", "nonexistent.txt", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := nfs.Open(tt.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("neuteredFileSystem.Open(%q) error = %v, wantErr %v", tt.path, err, tt.wantErr)
			}
			if f != nil {
				f.Close()
			}
		})
	}
}
