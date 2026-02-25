package backend

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const (
	apiAuthLogin            = "/api/auth/login"
	apiAuthLogout           = "/api/auth/logout"
	apiAuthRefresh          = "/api/auth/refresh"
	apiAuthMe               = "/api/auth/me"
	apiUsers                = "/api/users"
	apiUsersBase            = "/api/users/"
	apiUsers1               = apiUsersBase + "1"
	apiTest                 = "/api/test"
	testPassword            = "SecurePass123!"
	testEmail               = "test@example.com"
	testEmailTwo            = "t@t.com"
	testEmailThree          = "a@b.com"
	testUserEmail           = "user@test.com"
	expectedEmail           = "expected email %s, got %s"
	expectedRole            = "expected role admin, got %s"
	sqliteMemoryDSN         = ":memory:"
	adminEmailLocal         = "admin@local"
	errGetUserByEmailFailed = "GetUserByEmail failed: %v"
)

// --- Password Hashing ---

func TestHashAndCheckPassword(t *testing.T) {
	hash, err := HashPassword(testPassword)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if !CheckPassword(hash, testPassword) {
		t.Error("CheckPassword should return true for correct password")
	}
	if CheckPassword(hash, "WrongPassword123!") {
		t.Error("CheckPassword should return false for wrong password")
	}
}

// --- JWT Tokens ---

func TestJWTTokenGeneration(t *testing.T) {
	InitSecretKey("")

	user := &User{ID: 1, Email: testEmail, Role: RoleAdmin, Active: true}

	accessToken, err := GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ValidateToken(accessToken)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.UserID != 1 {
		t.Errorf("expected UserID 1, got %d", claims.UserID)
	}
	if claims.Email != testEmail {
		t.Errorf(expectedEmail, testEmail, claims.Email)
	}
	if claims.Role != RoleAdmin {
		t.Errorf(expectedRole, claims.Role)
	}
}

func TestOpaqueRefreshToken(t *testing.T) {
	sessionID := 123
	token, hash, err := GenerateRefreshToken(sessionID)
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}

	if token == "" {
		t.Error("expected non-empty token")
	}
	if hash == "" {
		t.Error("expected non-empty hash")
	}

	// Validate
	gotSessionID, gotSecret, err := ValidateRefreshToken(token)
	if err != nil {
		t.Fatalf("ValidateRefreshToken failed: %v", err)
	}
	if gotSessionID != sessionID {
		t.Errorf("expected sessionID %d, got %d", sessionID, gotSessionID)
	}
	if gotSecret == "" {
		t.Error("expected non-empty secret")
	}

	// Note: We cannot verify the hash against the secret easily here without bcrypt dependency in test or helper,
	// but the fact that it parsed cleanly is good.
	// We could verify the hash matches if we really wanted to be sure.
	// But let's assume bcrypt works.
}

func TestValidateRefreshTokenInvalid(t *testing.T) {
	// 1. Invalid Base64
	_, _, err := ValidateRefreshToken("invalid-base64")
	if err == nil {
		t.Error("expected error for invalid base64")
	}

	// 2. Invalid Format (no colon)
	// "bad:format" encoded
	encodedBad := "YmFkZm9ybWF0" // base64("badformat")
	_, _, err = ValidateRefreshToken(encodedBad)
	if err == nil {
		t.Error("expected error for missing colon")
	}

	// 3. Invalid Session ID
	// "abc:secret"
	encodedBadID := "YWJjOnNlY3JldA==" // base64("abc:secret")
	_, _, err = ValidateRefreshToken(encodedBadID)
	if err == nil {
		t.Error("expected error for invalid session ID")
	}
}

func TestValidateTokenInvalid(t *testing.T) {
	InitSecretKey("")

	if _, err := ValidateToken("invalid.token.string"); err == nil {
		t.Error("expected error for invalid token, got nil")
	}
}

func TestInitSecretKeyCustom(t *testing.T) {
	InitSecretKey("my-custom-secret")

	user := &User{ID: 1, Email: testEmail, Role: RoleAdmin, Active: true}
	token, err := GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed with custom secret: %v", err)
	}
	if claims.Email != testEmail {
		t.Errorf(expectedEmail, testEmail, claims.Email)
	}

	// Token from different secret should fail
	InitSecretKey("different-secret")
	if _, err := ValidateToken(token); err == nil {
		t.Error("expected error validating token with different secret")
	}
}

// --- Cookie Functions ---

func TestSetAndClearAuthCookies(t *testing.T) {
	rr := httptest.NewRecorder()
	SetAuthCookies(rr, "access-value", "refresh-value")

	cookies := rr.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("expected 2 cookies, got %d", len(cookies))
	}

	rr2 := httptest.NewRecorder()
	ClearAuthCookies(rr2)

	cookies = rr2.Result().Cookies()
	for _, c := range cookies {
		if c.MaxAge != -1 {
			t.Errorf("expected MaxAge -1 for cleared cookie %s, got %d", c.Name, c.MaxAge)
		}
	}
}

// --- Auth Middleware ---

func TestAuthMiddlewareNoCookie(t *testing.T) {
	InitSecretKey("")

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", apiTest, nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddlewareInvalidToken(t *testing.T) {
	InitSecretKey("")

	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	req := httptest.NewRequest("GET", apiTest, nil)
	req.AddCookie(&http.Cookie{Name: cookieAccessToken, Value: "bad-token"})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddlewareValidToken(t *testing.T) {
	InitSecretKey("")

	user := &User{ID: 1, Email: testEmail, Role: RoleAdmin, Active: true}
	token, _ := GenerateAccessToken(user)

	var capturedUserID int
	var capturedRole UserRole
	handler := AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUserID = GetUserIDFromContext(r.Context())
		capturedRole = GetRoleFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", apiTest, nil)
	req.AddCookie(&http.Cookie{Name: cookieAccessToken, Value: token})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
	if capturedUserID != 1 {
		t.Errorf("expected user ID 1, got %d", capturedUserID)
	}
	if capturedRole != RoleAdmin {
		t.Errorf(expectedRole, capturedRole)
	}
}

// --- Admin Middleware ---

// --- CSP Middleware ---

// --- Context Helpers ---

func TestGetUserIDFromContextEmpty(t *testing.T) {
	ctx := context.Background()
	if id := GetUserIDFromContext(ctx); id != 0 {
		t.Errorf("expected 0 for empty context, got %d", id)
	}
}

func TestGetRoleFromContextEmpty(t *testing.T) {
	ctx := context.Background()
	if role := GetRoleFromContext(ctx); role != "" {
		t.Errorf("expected empty role for empty context, got %s", role)
	}
}

// --- EnsureInitialAdmin ---

func TestEnsureInitialAdmin(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	err := EnsureInitialAdmin(adminEmailLocal, testPassword)
	if err != nil {
		t.Fatalf("EnsureInitialAdmin failed: %v", err)
	}

	user, err := GetUserByEmail(adminEmailLocal)
	if err != nil {
		t.Fatalf(errGetUserByEmailFailed, err)
	}
	if user == nil {
		t.Fatal("expected admin user to be created")
	}
	if user.Role != RoleAdmin {
		t.Errorf(expectedRole, user.Role)
	}
	if !user.Active {
		t.Error("expected admin to be active")
	}
}

func TestEnsureInitialAdminCustomEmail(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	customEmail := "custom-admin@example.com"
	err := EnsureInitialAdmin(customEmail, testPassword)
	if err != nil {
		t.Fatalf("EnsureInitialAdmin failed: %v", err)
	}

	user, err := GetUserByEmail(customEmail)
	if err != nil {
		t.Fatalf(errGetUserByEmailFailed, err)
	}
	if user == nil {
		t.Fatal("expected custom admin user to be created")
	}
	if user.Email != customEmail {
		t.Errorf("expected email %s, got %s", customEmail, user.Email)
	}
	if user.Role != RoleAdmin {
		t.Errorf(expectedRole, user.Role)
	}
}

func TestEnsureInitialAdminSkipsExisting(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create a user first
	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true})

	// Should skip because users exist
	err := EnsureInitialAdmin(adminEmailLocal, testPassword)
	if err != nil {
		t.Fatalf("EnsureInitialAdmin should succeed when users exist: %v", err)
	}

	count, _ := CountUsers()
	if count != 1 {
		t.Errorf("expected 1 user (no new admin), got %d", count)
	}
}

func TestEnsureInitialAdminNoPassword(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	err := EnsureInitialAdmin(adminEmailLocal, "")
	if err == nil {
		t.Error("expected error when no password provided and no users exist")
	}
}

func TestEnsureInitialAdminWeakPassword(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	err := EnsureInitialAdmin(adminEmailLocal, "short")
	if err == nil {
		t.Error("expected error for weak password")
	}
}

// --- Login Handler ---

func TestHandleLoginSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	body, _ := json.Marshal(map[string]string{"email": testEmail, "password": testPassword})
	req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}

	// Check cookies are set
	cookies := rr.Result().Cookies()
	if len(cookies) < 2 {
		t.Errorf("expected at least 2 cookies, got %d", len(cookies))
	}
}

func TestHandleLoginInvalidPassword(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	body, _ := json.Marshal(map[string]string{"email": testEmail, "password": "WrongPassword123!"})
	req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleLoginUserNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	body, _ := json.Marshal(map[string]string{"email": "noone@test.com", "password": testPassword})
	req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleLoginInactiveUser(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: false})

	body, _ := json.Marshal(map[string]string{"email": testEmail, "password": testPassword})
	req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleLoginInvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBufferString(invalidJSON))
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleLoginMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", apiAuthLogin, nil)
	rr := httptest.NewRecorder()
	HandleLogin(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- Logout Handler ---

func TestHandleLogoutSuccess(t *testing.T) {
	InitSecretKey("")

	req := httptest.NewRequest("POST", apiAuthLogout, nil)
	rr := httptest.NewRecorder()
	HandleLogout(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}

	// Check cookies are cleared
	for _, c := range rr.Result().Cookies() {
		if c.MaxAge != -1 {
			t.Errorf("expected MaxAge -1 for cookie %s, got %d", c.Name, c.MaxAge)
		}
	}
}

func TestHandleLogoutMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", apiAuthLogout, nil)
	rr := httptest.NewRecorder()
	HandleLogout(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- Refresh Handler ---

func TestHandleRefreshSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	user, _ := GetUserByEmail(testEmail)

	// Create Session first
	session := &Session{
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(refreshTokenDuration),
	}
	CreateSession(session)

	refreshToken, tokenHash, _ := GenerateRefreshToken(session.ID)
	session.TokenHash = tokenHash
	UpdateSession(session)

	req := httptest.NewRequest("POST", apiAuthRefresh, nil)
	req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: refreshToken})
	rr := httptest.NewRecorder()
	HandleRefresh(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
}

func TestHandleRefreshNoCookie(t *testing.T) {
	req := httptest.NewRequest("POST", apiAuthRefresh, nil)
	rr := httptest.NewRecorder()
	HandleRefresh(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleRefreshInvalidToken(t *testing.T) {
	InitSecretKey("")

	req := httptest.NewRequest("POST", apiAuthRefresh, nil)
	req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: "bad-token"})
	rr := httptest.NewRecorder()
	HandleRefresh(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleRefreshInactiveUser(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	user, _ := GetUserByEmail(testEmail)

	// Create Session first
	session := &Session{
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(refreshTokenDuration),
	}
	CreateSession(session)

	refreshToken, tokenHash, _ := GenerateRefreshToken(session.ID)
	session.TokenHash = tokenHash
	UpdateSession(session)

	// Deactivate user after generating token
	user.Active = false
	UpdateUser(user)

	req := httptest.NewRequest("POST", apiAuthRefresh, nil)
	req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: refreshToken})
	rr := httptest.NewRecorder()
	HandleRefresh(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
	}
}

func TestHandleRefreshMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("GET", apiAuthRefresh, nil)
	rr := httptest.NewRecorder()
	HandleRefresh(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- Current User Handler ---

func TestHandleCurrentUser(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	req := httptest.NewRequest("GET", apiAuthMe, nil)
	ctx := context.WithValue(req.Context(), contextKeyUserID, 1)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}

	var user User
	json.NewDecoder(rr.Body).Decode(&user)
	if user.Email != testEmail {
		t.Errorf(expectedEmail, testEmail, user.Email)
	}
}

func TestHandleCurrentUserNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiAuthMe, nil)
	ctx := context.WithValue(req.Context(), contextKeyUserID, 999)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleCurrentUserMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("POST", apiAuthMe, nil)
	ctx := context.WithValue(req.Context(), contextKeyUserID, 1)
	rr := httptest.NewRecorder()
	HandleCurrentUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- User DB Functions ---

func TestCreateAndGetUser(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	user := &User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true}

	if err := CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if user.ID == 0 {
		t.Error("expected user ID to be set")
	}

	// GetUserByEmail
	found, err := GetUserByEmail(testEmail)
	if err != nil {
		t.Fatalf(errGetUserByEmailFailed, err)
	}
	if found == nil || found.Email != testEmail {
		t.Error("expected to find user by email")
	}

	// GetUserByID
	foundByID, err := GetUserByID(user.ID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if foundByID == nil || foundByID.ID != user.ID {
		t.Error("expected to find user by ID")
	}
}

func TestGetAllUsers(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: "a@test.com", FirstName: "A", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})
	CreateUser(&User{Email: "b@test.com", FirstName: "B", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true})

	users, err := GetAllUsers()
	if err != nil {
		t.Fatalf("GetAllUsers failed: %v", err)
	}
	if len(users) != 2 {
		t.Errorf("expected 2 users, got %d", len(users))
	}
}

func TestUpdateUser(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	user := &User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true}
	CreateUser(user)

	user.FirstName = "Updated"
	if err := UpdateUser(user); err != nil {
		t.Fatalf("UpdateUser failed: %v", err)
	}

	updated, _ := GetUserByID(user.ID)
	if updated.FirstName != "Updated" {
		t.Errorf("expected FirstName 'Updated', got '%s'", updated.FirstName)
	}
}

func TestHandleUpdateUserRoleChangeRevokesSession(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	// 1. Setup Admin (acting as caller) and Target User
	adminHash, _ := HashPassword(testPassword)
	admin := &User{Email: "admin@test.com", FirstName: "Admin", LastName: "User", PasswordHash: adminHash, Role: RoleAdmin, Active: true}
	CreateUser(admin)

	targetHash, _ := HashPassword(testPassword)
	target := &User{Email: "target@test.com", FirstName: "Target", LastName: "User", PasswordHash: targetHash, Role: RoleAdmin, Active: true}
	if err := CreateUser(target); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	// Verify creation role
	savedTarget, _ := GetUserByID(target.ID)
	if savedTarget.Role != RoleAdmin {
		t.Fatalf("Setup failed: expected target to be RoleAdmin, got %s", savedTarget.Role)
	}

	// 2. Target logs in (creates session)
	session, _, _, _ := CreateUserSession(target)

	// 3. Admin updates Target's role to RoleUser
	// Prepare request body
	bodyMap := map[string]interface{}{
		"email":      target.Email,
		"first_name": target.FirstName,
		"last_name":  target.LastName,
		"role":       RoleUser,
		"active":     true,
	}
	body, _ := json.Marshal(bodyMap)

	// Add Admin Context
	// Note: We need to use a request that will be routed correctly if we were using a router.
	// Since HandleUser parses the URL path, we need to construct a valid path.
	targetURL := apiUsersBase + strconv.Itoa(target.ID)

	rr := httptest.NewRecorder()

	// Create a fresh request with correct path for HandleUser parsing
	req := httptest.NewRequest("PUT", targetURL, bytes.NewBuffer(body))
	// Add Admin Context
	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)

	HandleUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusOK {
		t.Fatalf("HandleUser update failed: code %d, body %s", rr.Code, rr.Body.String())
	}

	// 4. Verify Session is Revoked
	s, err := GetSessionByID(session.ID)
	if err != nil {
		t.Errorf("GetSessionByID error: %v", err)
	}
	if s != nil {
		t.Error("Session should have been revoked (deleted) after role change, but was found")
	}
}

func TestRefreshSessionReuseRevokesAll(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	// 1. Setup User
	hash, _ := HashPassword(testPassword)
	user := &User{Email: "victim@test.com", FirstName: "Victim", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true}
	CreateUser(user)

	// 2. Create Two Sessions (Device A and Device B)
	// Session A
	sessionA, _, refreshA, err := CreateUserSession(user)
	if err != nil {
		t.Fatalf("Failed to create session A: %v", err)
	}
	// Session B
	sessionB, _, _, err := CreateUserSession(user)
	if err != nil {
		t.Fatalf("Failed to create session B: %v", err)
	}

	// 3. Legitimate Refresh of Session A (Rotates Token)
	// This makes 'refreshA' invalid (old)
	_, _, _, err = RefreshSession(refreshA)
	if err != nil {
		t.Fatalf("First refresh failed: %v", err)
	}

	// 4. Attacker tries to use old 'refreshA' again (Token Reuse)
	_, _, _, err = RefreshSession(refreshA)
	if err == nil {
		t.Fatal("Expected error on reuse, got nil")
	}
	if !strings.HasPrefix(err.Error(), "token HMAC mismatch") {
		t.Errorf("Expected 'token HMAC mismatch' error, got '%v'", err)
	}

	// 5. Verify Family Revocation
	// Both Session A and Session B should be gone

	// Check Session A (should satisfy family revocation, even if it was just rotated)
	// Note: RefreshSession deletes the *old* session ID if reuse is detected via DeleteSession(sessionID)
	// OR RevokeUserSessions(userID) which deletes ALL sessions.
	// We need to re-fetch sessionA to see if it still exists.
	// Wait, RefreshSession rotates sessionA, so sessionA.ID stays the same?
	// Yes, `CreateUserSession` -> `RefreshSession` updates `session.TokenHash`. ID remains checks out.

	sA, err := GetSessionByID(sessionA.ID)
	if sA != nil {
		t.Error("Session A should be revoked (family revocation)")
	}

	// Check Session B (The innocent bystander session)
	sB, err := GetSessionByID(sessionB.ID)
	if sB != nil {
		t.Error("Session B should be revoked (family revocation)")
	}
}

func TestUpdateUserNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	err := UpdateUser(&User{ID: 999, Email: testEmail, FirstName: "T", LastName: "U", PasswordHash: "h", Role: RoleUser})
	if err != ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestCreateUserDuplicateEmail(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "A", LastName: "B", PasswordHash: hash, Role: RoleUser, Active: true})

	err := CreateUser(&User{Email: testEmail, FirstName: "C", LastName: "D", PasswordHash: hash, Role: RoleUser, Active: true})
	if err != ErrDuplicateEmail {
		t.Errorf("expected ErrDuplicateEmail, got %v", err)
	}
}

func TestCountUsers(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	count, _ := CountUsers()
	if count != 0 {
		t.Errorf("expected 0 users, got %d", count)
	}

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "T", LastName: "U", PasswordHash: hash, Role: RoleUser, Active: true})

	count, _ = CountUsers()
	if count != 1 {
		t.Errorf("expected 1 user, got %d", count)
	}
}

func TestCountActiveAdmins(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: "admin1@test.com", FirstName: "A", LastName: "U", PasswordHash: hash, Role: RoleAdmin, Active: true})
	CreateUser(&User{Email: "admin2@test.com", FirstName: "B", LastName: "U", PasswordHash: hash, Role: RoleAdmin, Active: false})
	CreateUser(&User{Email: testUserEmail, FirstName: "C", LastName: "U", PasswordHash: hash, Role: RoleUser, Active: true})

	count, _ := CountActiveAdmins()
	if count != 1 {
		t.Errorf("expected 1 active admin, got %d", count)
	}
}

func TestGetUserByEmailNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user, err := GetUserByEmail("nobody@test.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user != nil {
		t.Error("expected nil user for non-existent email")
	}
}

func TestGetUserByIDNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user, err := GetUserByID(999)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user != nil {
		t.Error("expected nil user for non-existent ID")
	}
}

// --- User DB Errors (closed DB) ---

func TestUserDBErrors(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	closedDB, _ := sql.Open("sqlite3", sqliteMemoryDSN)
	closedDB.Close()
	DB = closedDB

	tests := []struct {
		name string
		f    func() error
	}{
		{"CreateUser", func() error { return CreateUser(&User{Email: testEmailTwo}) }},
		{"UpdateUser", func() error { return UpdateUser(&User{ID: 1, Email: testEmailTwo}) }},
		{"GetUserByEmail", func() error { _, err := GetUserByEmail(testEmailTwo); return err }},
		{"GetUserByID", func() error { _, err := GetUserByID(1); return err }},
		{"GetAllUsers", func() error { _, err := GetAllUsers(); return err }},
		{"CountUsers", func() error { _, err := CountUsers(); return err }},
		{"CountActiveAdmins", func() error { _, err := CountActiveAdmins(); return err }},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_Error", func(t *testing.T) {
			if tt.f() == nil {
				t.Error("expected error, got nil")
			}
		})
	}
}

// --- User Handler Tests ---

func TestHandleUsersGetList(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	req := httptest.NewRequest("GET", apiUsers, nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleUsers(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}

	var users []User
	json.NewDecoder(rr.Body).Decode(&users)
	if len(users) != 1 {
		t.Errorf("expected 1 user, got %d", len(users))
	}
}

func TestHandleUsersCreateSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "Test",
		"last_name":  "User",
		"password":   testPassword,
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("POST", apiUsers, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusCreated {
		t.Errorf(wrongStatusCode+"\nbody: %s", rr.Code, http.StatusCreated, rr.Body.String())
	}
}

func TestHandleUsersCreateDuplicateEmail(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "A", LastName: "B", PasswordHash: hash, Role: RoleUser, Active: true})

	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "C",
		"last_name":  "D",
		"password":   testPassword,
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("POST", apiUsers, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusConflict {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusConflict)
	}
}

func TestHandleUsersCreateInvalidJSON(t *testing.T) {
	req := httptest.NewRequest("POST", apiUsers, bytes.NewBufferString(invalidJSON))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUsersCreateMissingPassword(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "Test",
		"last_name":  "User",
		"password":   "",
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("POST", apiUsers, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUsersCreateWeakPassword(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "Test",
		"last_name":  "User",
		"password":   "short",
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("POST", apiUsers, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUsersCreateInvalidEmail(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"email":      "invalid",
		"first_name": "Test",
		"last_name":  "User",
		"password":   testPassword,
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("POST", apiUsers, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUsers(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUsersMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("DELETE", apiUsers, nil)
	rr := httptest.NewRecorder()
	HandleUsers(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- HandleUser (GET/PUT by ID) ---

func TestHandleUserGetSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	user := &User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true}
	CreateUser(user)

	req := httptest.NewRequest("GET", apiUsersBase+strconv.Itoa(user.ID), nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleUser(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusOK)
	}
}

func TestHandleUserGetNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	req := httptest.NewRequest("GET", apiUsersBase+"999", nil)
	req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
	rr := httptest.NewRecorder()
	HandleUser(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleUserInvalidID(t *testing.T) {
	req := httptest.NewRequest("GET", apiUsersBase+"invalid", nil)
	rr := httptest.NewRecorder()
	HandleUser(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUserPutSuccess(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	user := &User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true}
	CreateUser(user)

	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "Updated",
		"last_name":  "Name",
		"password":   "",
		"role":       "admin",
		"active":     true,
	})

	req := httptest.NewRequest("PUT", apiUsersBase+strconv.Itoa(user.ID), bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusOK {
		t.Errorf(wrongStatusCode+"\nbody: %s", rr.Code, http.StatusOK, rr.Body.String())
	}

	updated, _ := GetUserByID(user.ID)
	if updated.FirstName != "Updated" {
		t.Errorf("expected first name 'Updated', got '%s'", updated.FirstName)
	}
}

func TestHandleUserPutNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "T",
		"last_name":  "U",
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("PUT", apiUsersBase+"999", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusNotFound {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusNotFound)
	}
}

func TestHandleUserPutInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "T", LastName: "U", PasswordHash: hash, Role: RoleAdmin, Active: true})

	req := httptest.NewRequest("PUT", apiUsers1, bytes.NewBufferString(invalidJSON))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUserPutLastAdminProtection(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	CreateUser(&User{Email: testEmail, FirstName: "Admin", LastName: "User", PasswordHash: hash, Role: RoleAdmin, Active: true})

	// Try to demote the only admin
	body, _ := json.Marshal(map[string]interface{}{
		"email":      testEmail,
		"first_name": "Admin",
		"last_name":  "User",
		"role":       "user",
		"active":     true,
	})

	req := httptest.NewRequest("PUT", apiUsers1, bytes.NewBuffer(body))
	rr := httptest.NewRecorder()

	ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
	HandleUser(rr, req.WithContext(ctx))

	if rr.Code != http.StatusBadRequest {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusBadRequest)
	}
}

func TestHandleUserMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest("DELETE", apiUsers1, nil)
	rr := httptest.NewRecorder()
	HandleUser(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf(wrongStatusCode, rr.Code, http.StatusMethodNotAllowed)
	}
}

// --- Password Validation ---

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		email    string
		wantErr  bool
	}{
		{"valid", "StrongPass12345!", testUserEmail, false},
		{"too short", "short", testUserEmail, true},
		{"same as email", testUserEmail, testUserEmail, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePassword(tt.password, tt.email)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidatePassword(%q, %q) error = %v, wantErr %v", tt.password, tt.email, err, tt.wantErr)
			}
		})
	}
}

// --- User Validation ---

func TestValidateUser(t *testing.T) {
	tests := []struct {
		name    string
		user    *User
		wantErr bool
	}{
		{"valid", &User{Email: testEmailThree, FirstName: "A", LastName: "B", Role: RoleUser}, false},
		{"empty email", &User{Email: "", FirstName: "A", LastName: "B", Role: RoleUser}, true},
		{"no @", &User{Email: "invalid", FirstName: "A", LastName: "B", Role: RoleUser}, true},
		{"empty first name", &User{Email: testEmailThree, FirstName: "", LastName: "B", Role: RoleUser}, true},
		{"empty last name", &User{Email: testEmailThree, FirstName: "A", LastName: "", Role: RoleUser}, true},
		{"invalid role", &User{Email: testEmailThree, FirstName: "A", LastName: "B", Role: "superadmin"}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateUser(tt.user)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateUser() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// --- Auth Handler DB Errors ---

func TestAuthHandlersDBError(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	closedDB, _ := sql.Open("sqlite3", sqliteMemoryDSN)
	closedDB.Close()
	DB = closedDB
	InitSecretKey("")

	t.Run("Login_DBError", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"email": testEmail, "password": testPassword})
		req := httptest.NewRequest("POST", apiAuthLogin, bytes.NewBuffer(body))
		rr := httptest.NewRecorder()
		HandleLogin(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
		}
	})

	t.Run("Refresh_DBError", func(t *testing.T) {
		// Mock a token for a session ID (DB is closed so it handles 500)
		token, _, _ := GenerateRefreshToken(1)
		req := httptest.NewRequest("POST", apiAuthRefresh, nil)
		req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: token})
		rr := httptest.NewRecorder()
		HandleRefresh(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusUnauthorized)
		}
	})

	t.Run("CurrentUser_DBError", func(t *testing.T) {
		req := httptest.NewRequest("GET", apiAuthMe, nil)
		ctx := context.WithValue(req.Context(), contextKeyUserID, 1)
		rr := httptest.NewRecorder()
		HandleCurrentUser(rr, req.WithContext(ctx))
		if rr.Code != http.StatusInternalServerError {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
		}
	})

	t.Run("HandleUsers_GET_DBError", func(t *testing.T) {
		req := httptest.NewRequest("GET", apiUsers, nil)
		req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
		rr := httptest.NewRecorder()
		HandleUsers(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
		}
	})

	t.Run("HandleUser_GET_DBError", func(t *testing.T) {
		req := httptest.NewRequest("GET", apiUsers1, nil)
		req = req.WithContext(context.WithValue(req.Context(), contextKeyRole, RoleAdmin))
		rr := httptest.NewRecorder()
		HandleUser(rr, req)
		if rr.Code != http.StatusInternalServerError {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
		}
	})

	t.Run("HandleUser_PUT_DBError", func(t *testing.T) {
		body, _ := json.Marshal(map[string]interface{}{
			"email": testEmail, "first_name": "T", "last_name": "U", "role": "user", "active": true,
		})
		req := httptest.NewRequest("PUT", apiUsers1, bytes.NewBuffer(body))
		rr := httptest.NewRecorder()

		ctx := context.WithValue(req.Context(), contextKeyRole, RoleAdmin)
		HandleUser(rr, req.WithContext(ctx))
		if rr.Code != http.StatusInternalServerError {
			t.Errorf(wrongStatusCode, rr.Code, http.StatusInternalServerError)
		}
	})
}

// --- Session Revocation ---

func TestRevokeSession(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword("pass")
	CreateUser(&User{Email: "revoke@test.com", FirstName: "R", LastName: "U", PasswordHash: hash, Role: RoleUser, Active: true})
	user, _ := GetUserByEmail("revoke@test.com")

	session := &Session{
		UserID:    user.ID,
		TokenHash: "to-revoke",
		ExpiresAt: time.Now().Add(time.Hour),
	}
	CreateSession(session)

	// Revoke
	if err := RevokeSession(session.ID); err != nil {
		t.Fatalf("RevokeSession failed: %v", err)
	}

	// Verify gone
	s, _ := GetSessionByID(session.ID)
	if s != nil {
		t.Error("expected session to be revoked (deleted)")
	}
}

func TestRevokeUserSessions(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword("pass")
	CreateUser(&User{Email: "revoke_all@test.com", FirstName: "R", LastName: "A", PasswordHash: hash, Role: RoleUser, Active: true})
	user, _ := GetUserByEmail("revoke_all@test.com")

	CreateSession(&Session{UserID: user.ID, TokenHash: "1", ExpiresAt: time.Now().Add(time.Hour)})
	CreateSession(&Session{UserID: user.ID, TokenHash: "2", ExpiresAt: time.Now().Add(time.Hour)})

	if err := RevokeUserSessions(user.ID); err != nil {
		t.Fatalf("RevokeUserSessions failed: %v", err)
	}

	// Verify all gone for user
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM sessions WHERE user_id = ?", user.ID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 sessions, got %d", count)
	}
}

func TestCreateUserSession(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()
	InitSecretKey("")

	hash, _ := HashPassword("pass")
	CreateUser(&User{Email: "session@test.com", FirstName: "S", LastName: "C", PasswordHash: hash, Role: RoleUser, Active: true})
	user, _ := GetUserByEmail("session@test.com")

	session, accessToken, refreshToken, err := CreateUserSession(user)
	if err != nil {
		t.Fatalf("CreateUserSession failed: %v", err)
	}

	if session == nil {
		t.Fatal("expected session to be returned")
	}
	if accessToken == "" {
		t.Error("expected access token")
	}
	if refreshToken == "" {
		t.Error("expected refresh token")
	}
	if session.UserID != user.ID {
		t.Errorf("expected session user ID %d, got %d", user.ID, session.UserID)
	}

	// Verify DB has hash
	stored, _ := GetSessionByID(session.ID)
	if stored == nil {
		t.Error("expected session to be persisted")
	} else if stored.TokenHash == "" {
		t.Error("expected token hash to be set in DB")
	}
}

func TestGenerateAccessTokenInactiveUser(t *testing.T) {
	InitSecretKey("")
	user := &User{ID: 1, Email: "inactive@test.com", Role: RoleUser, Active: false}
	_, err := GenerateAccessToken(user)
	if err == nil {
		t.Error("expected error for inactive user, got nil")
	}
}

func TestValidateRefreshTokenInvalidSecretEncoding(t *testing.T) {
	// Outer base64 is valid; session ID is valid; but secret part is not valid base64.
	inner := "1:!!!" // "!!!" cannot be decoded as base64
	token := base64.StdEncoding.EncodeToString([]byte(inner))
	_, _, err := ValidateRefreshToken(token)
	if err == nil {
		t.Error("expected error for invalid secret encoding, got nil")
	}
	if !strings.Contains(err.Error(), "invalid secret encoding") {
		t.Errorf("expected 'invalid secret encoding', got %q", err.Error())
	}
}

func TestEnsureInitialAdminCountUsersError(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	closedDB, _ := sql.Open("sqlite3", sqliteMemoryDSN)
	closedDB.Close()
	DB = closedDB

	err := EnsureInitialAdmin(adminEmailLocal, "SomePassword1!")
	if err == nil {
		t.Error("expected error with closed DB, got nil")
	}
}

func TestTryRefreshSessionEmptyCookie(t *testing.T) {
	InitSecretKey("")
	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieRefreshToken, Value: ""})
	rr := httptest.NewRecorder()
	if tryRefreshSession(rr, req) {
		t.Error("expected false for empty refresh token cookie")
	}
}

func TestCreateUserSessionInactiveUser(t *testing.T) {
	InitSecretKey("")
	user := &User{ID: 1, Email: "inactive@test.com", Role: RoleUser, Active: false}
	_, _, _, err := CreateUserSession(user)
	if err == nil {
		t.Error("expected error for inactive user, got nil")
	}
}

func TestCreateUserSessionDBError(t *testing.T) {
	oldDB := DB
	defer func() { DB = oldDB }()

	closedDB, _ := sql.Open("sqlite3", sqliteMemoryDSN)
	closedDB.Close()
	DB = closedDB
	InitSecretKey("")

	user := &User{ID: 1, Email: "active@test.com", Role: RoleUser, Active: true}
	_, _, _, err := CreateUserSession(user)
	if err == nil {
		t.Error("expected error with closed DB, got nil")
	}
}
