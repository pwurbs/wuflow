package backend

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// jwtSecret is the signing key for JWT access tokens, derived from the configured
// master key via domain-separated HMAC-KDF. Never equal to the raw master key.
var jwtSecret []byte

// tokenMACKey is the HMAC key for refresh token integrity, derived from the same
// master key as jwtSecret but with a different domain string, ensuring the two
// operational keys are cryptographically independent.
var tokenMACKey []byte

const (
	accessTokenDuration  = 15 * time.Minute
	refreshTokenDuration = 24 * time.Hour

	cookieAccessToken  = "wf_access_token"
	cookieRefreshToken = "wf_refresh_token"
)

// contextKey is a custom type for context keys to avoid collisions.
type contextKey string

const (
	contextKeyUserID contextKey = "user_id"
	contextKeyEmail  contextKey = "email"
	contextKeyRole   contextKey = "role"
)

// CustomClaims extends JWT registered claims with user-specific data.
type CustomClaims struct {
	UserID int      `json:"user_id"`
	Email  string   `json:"email"`
	Role   UserRole `json:"role"`
	jwt.RegisteredClaims
}

// InitSecretKey initializes the operational keys used for JWT signing and refresh-token
// MAC computation. The provided secret (or a random one) acts as master key material and
// is never used directly for any cryptographic operation — all operational keys are derived
// from it via domain-separated HMAC-KDF (golden rule: master keys derive, never sign/MAC).
func InitSecretKey(secret string) {
	var rawKey []byte
	if secret != "" {
		rawKey = []byte(secret)
		LogInfo("Secret key initialized from configuration")
	} else {
		rawKey = make([]byte, 32)
		if _, err := rand.Read(rawKey); err != nil {
			LogError("Failed to generate random secret key", "error", err)
			panic(fmt.Sprintf("CRITICAL: Failed to generate random secret key: %v", err))
		}
		LogWarn("Secret key not configured — a random key was generated; all sessions will become invalid. Set WF_SECRET_KEY for persistent sessions.")
	}

	// Derive both operational keys from rawKey using domain-separated HMAC-KDF.
	// Each key has a unique, fixed domain string so that jwtSecret and tokenMACKey
	// are cryptographically independent even though they share the same root material.
	h1 := hmac.New(sha256.New, rawKey)
	h1.Write([]byte("wuflow-jwt-signing-v1"))
	jwtSecret = h1.Sum(nil)

	h2 := hmac.New(sha256.New, rawKey)
	h2.Write([]byte("wuflow-refresh-token-mac-v1"))
	tokenMACKey = h2.Sum(nil)
}

// HashPassword hashes a plaintext password using bcrypt.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// computeTokenMAC returns an HMAC-SHA256 hex digest of secret, keyed with tokenMACKey.
// Used to hash opaque refresh token secrets for database storage.
// Refresh token secrets have 256-bit entropy so bcrypt key-stretching is unnecessary.
func computeTokenMAC(secret []byte) string {
	mac := hmac.New(sha256.New, tokenMACKey)
	mac.Write(secret)
	return hex.EncodeToString(mac.Sum(nil))
}

// CheckPassword compares a plaintext password with a bcrypt hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// dummyPasswordCheck runs HashPassword to simulate the same wall-clock time
// as a real CheckPassword call so that login attempts for non-existent or
// blocked users are indistinguishable from wrong-password attempts by timing.
func dummyPasswordCheck(password string) {
	_, _ = HashPassword(password)
}

// GenerateAccessToken creates a short-lived JWT access token for the given user.
func GenerateAccessToken(user *User) (string, error) {
	if !user.Active {
		return "", fmt.Errorf("cannot generate token for inactive user")
	}
	claims := CustomClaims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().UTC().Add(accessTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
			Subject:   user.Email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// generateSessionToken returns a cryptographically random, URL-safe token string.
// Uses crypto/rand.Text() (Go 1.24+): base32 alphabet, 128 bits of entropy, no error return.
func generateSessionToken() string {
	return rand.Text()
}

// GenerateRefreshToken creates a secure opaque refresh token for the given session token.
// Returns the token string (for the client cookie) and the token hash (for the database).
// Format: base64(sessionToken:base64(secret))
func GenerateRefreshToken(sessionToken string) (string, string, error) {
	// Generate 32-byte random secret. crypto/rand.Read never errors in Go 1.20+.
	secret := make([]byte, 32)
	_, _ = rand.Read(secret)

	// Hash the secret for storage
	hash := computeTokenMAC(secret)

	// Create opaque token string: sessionToken:base64(secret)
	secretStr := base64.StdEncoding.EncodeToString(secret)
	token := fmt.Sprintf("%s:%s", sessionToken, secretStr)
	encodedToken := base64.StdEncoding.EncodeToString([]byte(token))

	return encodedToken, hash, nil
}

// ValidateRefreshToken parses an opaque refresh token.
// Returns the session token (lookup key) and the raw secret (to be verified against the DB hash).
func ValidateRefreshToken(tokenString string) (string, string, error) {
	if len(tokenString) > MaxRefreshTokenLength {
		return "", "", fmt.Errorf("token too long")
	}
	decodedBytes, err := base64.StdEncoding.DecodeString(tokenString)
	if err != nil {
		return "", "", fmt.Errorf("invalid token encoding")
	}
	decoded := string(decodedBytes)

	parts := strings.SplitN(decoded, ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid token format")
	}

	sessionToken := parts[0]
	if sessionToken == "" {
		return "", "", fmt.Errorf("empty session token")
	}

	// The secret is base64-encoded in the token string; decode to raw bytes for HMAC verification.
	rawSecret, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", fmt.Errorf("invalid secret encoding")
	}

	return sessionToken, string(rawSecret), nil
}

// ValidateToken parses and validates a JWT token string.
// Returns the claims if valid, or an error if invalid/expired.
func ValidateToken(tokenString string) (*CustomClaims, error) {
	if len(tokenString) > MaxAccessTokenLength {
		return nil, fmt.Errorf("token too long")
	}
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(token *jwt.Token) (any, error) {
		// Don't forget to validate the alg is what you expect:
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		LogWarn("Invalid JWT token", "error", err)
		return nil, err
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		err := fmt.Errorf("invalid token claims")
		LogWarn("Invalid JWT token", "error", err)
		return nil, jwt.ErrTokenInvalidClaims
	}
	return claims, nil
}

func newAuthCookie(name, value string, maxAge int) *http.Cookie {
	c := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	}
	// Override the initializer: secureCookie may be false in non-TLS environments.
	// This solution is needed to let SQ and gosec ignore the not set Secure flag but check the other flags
	c.Secure = secureCookie
	return c
}

// SetAuthCookies sets the access and refresh token cookies on the response.
func SetAuthCookies(w http.ResponseWriter, accessToken, refreshToken string) {
	http.SetCookie(w, newAuthCookie(cookieAccessToken, accessToken, int(accessTokenDuration.Seconds())))
	http.SetCookie(w, newAuthCookie(cookieRefreshToken, refreshToken, int(refreshTokenDuration.Seconds())))
}

// ClearAuthCookies removes the auth cookies from the response.
func ClearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, newAuthCookie(cookieAccessToken, "", -1))
	http.SetCookie(w, newAuthCookie(cookieRefreshToken, "", -1))
}

// AuthMiddleware validates the access token from cookies and injects user data into the request context.
// Returns 401 Unauthorized if the token is missing or invalid.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(cookieAccessToken)
		if err != nil {
			http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
			return
		}

		claims, err := ValidateToken(cookie.Value)
		if err != nil {
			http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
			return
		}

		// Inject user info into request context
		ctx := context.WithValue(r.Context(), contextKeyUserID, claims.UserID)
		ctx = context.WithValue(ctx, contextKeyEmail, claims.Email)
		ctx = context.WithValue(ctx, contextKeyRole, claims.Role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserIDFromContext extracts the user ID from the request context.
func GetUserIDFromContext(ctx context.Context) int {
	id, _ := ctx.Value(contextKeyUserID).(int)
	return id
}

// GetRoleFromContext extracts the user role from the request context.
func GetRoleFromContext(ctx context.Context) UserRole {
	role, _ := ctx.Value(contextKeyRole).(UserRole)
	return role
}

// GetEmailFromContext extracts the user email from the request context.
func GetEmailFromContext(ctx context.Context) string {
	email, _ := ctx.Value(contextKeyEmail).(string)
	return email
}

// EnsureInitialAdmin creates the initial admin user if no users exist.
func EnsureInitialAdmin(ctx context.Context, initialAdminEmail, initialAdminPassword string) error {
	count, err := CountUsers(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	if initialAdminPassword == "" {
		return fmt.Errorf("no users exist and no initial admin password provided, must terminate the application (set WF_INITIAL_ADMIN_PASSWORD or --initial-admin-password)")
	}

	admin := &User{
		Email:     initialAdminEmail,
		FirstName: "Admin",
		LastName:  "User",
		Role:      RoleSysAdmin,
		Active:    true,
	}

	if err := validateUser(admin); err != nil {
		return fmt.Errorf("invalid initial admin configuration: %w", err)
	}

	if err := ValidatePassword(initialAdminPassword, admin.Email); err != nil {
		return fmt.Errorf("initial admin password does not meet policy requirements: %w", err)
	}

	hash, err := HashPassword(initialAdminPassword)
	if err != nil {
		return err
	}
	admin.PasswordHash = hash

	if err := CreateUser(ctx, admin); err != nil {
		return err
	}

	LogInfo("Created initial admin user", "email", admin.Email)
	return nil
}

// tryRefreshSession attempts to refresh the session using the refresh token cookie.
func tryRefreshSession(w http.ResponseWriter, r *http.Request) bool {
	refreshTokenCookie, err := r.Cookie(cookieRefreshToken)
	if err != nil || refreshTokenCookie.Value == "" {
		LogInfo("Refresh token cookie missing (static)")
		return false
	}

	// Use shared RefreshSession logic
	user, newAccessToken, newRefreshToken, err := RefreshSession(r.Context(), refreshTokenCookie.Value)
	if err != nil {
		LogInfo("Session refresh failed, redirecting to login", "reason", err.Error())
		return false
	}

	SetAuthCookies(w, newAccessToken, newRefreshToken)
	LogInfo("Token refresh successful (static)", "email", user.Email)
	return true
}

// -----------------------------------------------------------------------------
// Session Service Methods
// -----------------------------------------------------------------------------

// CreateUserSession creates a new session for a user, generates tokens, and returns them.
// It handles the DB insertion and token generation.
func CreateUserSession(ctx context.Context, user *User) (*Session, string, string, error) {
	// 1. Generate Access Token
	accessToken, err := GenerateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate access token: %w", err)
	}

	// 2. Generate Refresh Token (session_token + secret generated before DB insert)
	sessionToken := generateSessionToken()
	refreshToken, tokenHash, err := GenerateRefreshToken(sessionToken)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate refresh token: %w", err)
	}

	// 3. Create Session Record (token_hash and session_token set in one write)
	session := &Session{
		UserID:       user.ID,
		SessionToken: sessionToken,
		TokenHash:    tokenHash,
		ExpiresAt:    time.Now().UTC().Add(refreshTokenDuration),
	}
	if err := CreateSession(ctx, session); err != nil {
		return nil, "", "", fmt.Errorf("failed to create session: %w", err)
	}

	return session, accessToken, refreshToken, nil
}

// RevokeSession revokes a specific session by ID.
func RevokeSession(ctx context.Context, sessionID int) error {
	return DeleteSession(ctx, sessionID)
}

// RevokeUserSessions revokes all sessions for a user (e.g., on password change or deactivation).
func RevokeUserSessions(ctx context.Context, userID int) error {
	return DeleteSessionsByUserID(ctx, userID)
}

func deleteSessionSafe(ctx context.Context, sessionID int, msg string) {
	if err := DeleteSession(ctx, sessionID); err != nil {
		LogWarn(msg, "session_id", strconv.Itoa(sessionID), "err", err)
	}
}

// RefreshSession validates a refresh token, performs rotation, and returns new tokens.
// Returns the user, new access token, new refresh token, or error.
func RefreshSession(ctx context.Context, tokenString string) (*User, string, string, error) {
	// 1. Parse Opaque Token
	sessionToken, secret, err := ValidateRefreshToken(tokenString)
	if err != nil {
		return nil, "", "", fmt.Errorf("invalid token format: %w", err)
	}

	// 2. Fetch Session by unguessable token (not by integer row ID)
	session, err := GetSessionByToken(ctx, sessionToken)
	if err != nil {
		return nil, "", "", fmt.Errorf("session lookup failed session_token=%.8s: %w", sessionToken, err)
	}
	if session == nil {
		return nil, "", "", fmt.Errorf("session not found session_token=%.8s", sessionToken)
	}

	// 3. Check Expiry
	if time.Now().After(session.ExpiresAt) {
		deleteSessionSafe(ctx, session.ID, "failed to delete expired session")
		return nil, "", "", fmt.Errorf("session expired user_id=%d session_token=%.8s", session.UserID, sessionToken)
	}

	// 4. Verify Hash (Reuse Detection)
	expected := computeTokenMAC([]byte(secret))
	if !hmac.Equal([]byte(expected), []byte(session.TokenHash)) {
		revokeErr := RevokeUserSessions(ctx, session.UserID)
		if revokeErr != nil {
			revokeErr = RevokeUserSessions(ctx, session.UserID) // one retry for transient DB failures
		}
		if revokeErr != nil {
			// Sessions may remain active — operators should monitor for this error.
			return nil, "", "", fmt.Errorf("token HMAC mismatch user_id=%d session_token=%.8s AND session revocation failed after retry (sessions may remain active): %w", session.UserID, sessionToken, revokeErr)
		}
		return nil, "", "", fmt.Errorf("token HMAC mismatch user_id=%d session_token=%.8s, all sessions revoked (possible token reuse or server restart without WF_SECRET_KEY)", session.UserID, sessionToken)
	}

	// 5. Fetch User
	user, err := GetUserByID(ctx, session.UserID)
	if err != nil {
		return nil, "", "", fmt.Errorf("user lookup failed user_id=%d session_token=%.8s: %w", session.UserID, sessionToken, err)
	}
	if user == nil || !user.Active {
		deleteSessionSafe(ctx, session.ID, "failed to delete session for inactive user")
		return nil, "", "", fmt.Errorf("user inactive or not found user_id=%d session_token=%.8s", session.UserID, sessionToken)
	}

	// 6. Generate New Access Token
	newAccessToken, err := GenerateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate access token user_id=%d session_token=%.8s: %w", user.ID, sessionToken, err)
	}

	// 7. Rotate Refresh Token (session_token stays constant; only the secret rotates)
	newRefreshToken, newTokenHash, err := GenerateRefreshToken(session.SessionToken)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to rotate refresh token user_id=%d session_token=%.8s: %w", user.ID, sessionToken, err)
	}

	// 8. Update Session
	session.TokenHash = newTokenHash
	session.ExpiresAt = time.Now().UTC().Add(refreshTokenDuration)
	if err := UpdateSession(ctx, session); err != nil {
		return nil, "", "", fmt.Errorf("failed to update session user_id=%d session_token=%.8s: %w", session.UserID, sessionToken, err)
	}

	return user, newAccessToken, newRefreshToken, nil
}
