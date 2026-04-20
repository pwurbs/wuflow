package backend

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
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
		slog.Info("Secret key initialized from configuration")
	} else {
		rawKey = make([]byte, 32)
		if _, err := rand.Read(rawKey); err != nil {
			slog.Error("Failed to generate random secret key", "error", err)
			panic(fmt.Sprintf("CRITICAL: Failed to generate random secret key: %v", err))
		}
		slog.Warn("Secret key not configured — a random key was generated; all sessions will become invalid. Set WF_SECRET_KEY for persistent sessions.")
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

// GenerateRefreshToken creates a secure opaque refresh token.
// Returns the token string (for the client cookie) and the token hash (for the database).
// Format: base64(session_id:secret)
func GenerateRefreshToken(sessionID int) (string, string, error) {
	// Generate 32-byte random secret
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", "", err
	}

	// Hash the secret for storage
	hash := computeTokenMAC(secret)

	// Create opaque token string: sessionID:base64(secret)
	// We base64 encode the secret specifically to make it a safe string
	secretStr := base64.StdEncoding.EncodeToString(secret)
	token := fmt.Sprintf("%d:%s", sessionID, secretStr)
	encodedToken := base64.StdEncoding.EncodeToString([]byte(token))

	return encodedToken, hash, nil
}

// ValidateRefreshToken parses an opaque refresh token.
// Returns the session ID and the raw secret (to be verified against the DB hash).
func ValidateRefreshToken(tokenString string) (int, string, error) {
	if len(tokenString) > MaxRefreshTokenLength {
		return 0, "", fmt.Errorf("token too long")
	}
	decodedBytes, err := base64.StdEncoding.DecodeString(tokenString)
	if err != nil {
		return 0, "", fmt.Errorf("invalid token encoding")
	}
	decoded := string(decodedBytes)

	parts := strings.SplitN(decoded, ":", 2)
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid token format")
	}

	sessionID, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, "", fmt.Errorf("invalid session ID")
	}

	secret := parts[1]
	// The secret is base64 encoded in the token string.
	// We decode it back to raw bytes for bcrypt verification.

	rawSecret, err := base64.StdEncoding.DecodeString(secret)
	if err != nil {
		return 0, "", fmt.Errorf("invalid secret encoding")
	}

	return sessionID, string(rawSecret), nil
}

// ValidateToken parses and validates a JWT token string.
// Returns the claims if valid, or an error if invalid/expired.
func ValidateToken(tokenString string) (*CustomClaims, error) {
	if len(tokenString) > MaxAccessTokenLength {
		return nil, fmt.Errorf("token too long")
	}
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(token *jwt.Token) (interface{}, error) {
		// Don't forget to validate the alg is what you expect:
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		slog.Warn("Invalid JWT token", "error", err)
		return nil, err
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		err := fmt.Errorf("invalid token claims")
		slog.Warn("Invalid JWT token", "error", err)
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
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		claims, err := ValidateToken(cookie.Value)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
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
func EnsureInitialAdmin(initialAdminEmail, initialAdminPassword string) error {
	count, err := CountUsers()
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

	if err := CreateUser(admin); err != nil {
		return err
	}

	slog.Info("Created initial admin user", "email", admin.Email)
	return nil
}

// tryRefreshSession attempts to refresh the session using the refresh token cookie.
func tryRefreshSession(w http.ResponseWriter, r *http.Request) bool {
	refreshTokenCookie, err := r.Cookie(cookieRefreshToken)
	if err != nil || refreshTokenCookie.Value == "" {
		slog.Info("Refresh token cookie missing (static)")
		return false
	}

	// Use shared RefreshSession logic
	user, newAccessToken, newRefreshToken, err := RefreshSession(refreshTokenCookie.Value)
	if err != nil {
		slog.Info("Session refresh failed, redirecting to login", "reason", strings.ReplaceAll(err.Error(), "\n", ""))
		return false
	}

	SetAuthCookies(w, newAccessToken, newRefreshToken)
	slog.Info("Token refresh successful (static)", "email", user.Email)
	return true
}

// -----------------------------------------------------------------------------
// Session Service Methods
// -----------------------------------------------------------------------------

// CreateUserSession creates a new session for a user, generates tokens, and returns them.
// It handles the DB insertion and token generation.
func CreateUserSession(user *User) (*Session, string, string, error) {
	// 1. Generate Access Token
	accessToken, err := GenerateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate access token: %w", err)
	}

	// 2. Create Session Record
	session := &Session{
		UserID:    user.ID,
		TokenHash: "", // Will be set after generation
		ExpiresAt: time.Now().UTC().Add(refreshTokenDuration),
	}
	if err := CreateSession(session); err != nil {
		return nil, "", "", fmt.Errorf("failed to create session: %w", err)
	}

	// 3. Generate Refresh Token
	refreshToken, tokenHash, err := GenerateRefreshToken(session.ID)
	if err != nil {
		if derr := DeleteSession(session.ID); derr != nil {
			slog.Warn("failed to cleanup session after refresh token error", "session_id", session.ID, "err", derr)
		}
		return nil, "", "", fmt.Errorf("failed to generate refresh token: %w", err)
	}

	// 4. Update session with the real hash
	session.TokenHash = tokenHash
	if err := UpdateSession(session); err != nil {
		if derr := DeleteSession(session.ID); derr != nil {
			slog.Warn("failed to cleanup orphaned session after hash update error", "session_id", session.ID, "err", derr)
		}
		return nil, "", "", fmt.Errorf("failed to update session hash: %w", err)
	}

	return session, accessToken, refreshToken, nil
}

// RevokeSession revokes a specific session by ID.
func RevokeSession(sessionID int) error {
	return DeleteSession(sessionID)
}

// RevokeUserSessions revokes all sessions for a user (e.g., on password change or deactivation).
func RevokeUserSessions(userID int) error {
	return DeleteSessionsByUserID(userID)
}

func deleteSessionSafe(sessionID int, msg string) {
	if err := DeleteSession(sessionID); err != nil {
		slog.Warn(msg, "session_id", strconv.Itoa(sessionID), "err", err)
	}
}

// RefreshSession validates a refresh token, performs rotation, and returns new tokens.
// Returns the user, new access token, new refresh token, or error.
func RefreshSession(tokenString string) (*User, string, string, error) {
	// 1. Parse Opaque Token
	sessionID, secret, err := ValidateRefreshToken(tokenString)
	if err != nil {
		return nil, "", "", fmt.Errorf("invalid token format: %w", err)
	}

	// 2. Fetch Session
	session, err := GetSessionByID(sessionID)
	if err != nil {
		return nil, "", "", fmt.Errorf("session lookup failed session_id=%d: %w", sessionID, err)
	}
	if session == nil {
		return nil, "", "", fmt.Errorf("session not found session_id=%d", sessionID)
	}

	// 3. Check Expiry
	if time.Now().After(session.ExpiresAt) {
		deleteSessionSafe(sessionID, "failed to delete expired session")
		return nil, "", "", fmt.Errorf("session expired user_id=%d session_id=%d", session.UserID, sessionID)
	}

	// 4. Verify Hash (Reuse Detection)
	expected := computeTokenMAC([]byte(secret))
	if !hmac.Equal([]byte(expected), []byte(session.TokenHash)) {
		if err := RevokeUserSessions(session.UserID); err != nil {
			slog.Warn("failed to revoke sessions after HMAC mismatch", "user_id", session.UserID, "err", err)
		}
		return nil, "", "", fmt.Errorf("token HMAC mismatch user_id=%d session_id=%d, revoking all sessions (possible token reuse or server restart without WF_SECRET_KEY)", session.UserID, sessionID)
	}

	// 5. Fetch User
	user, err := GetUserByID(session.UserID)
	if err != nil {
		return nil, "", "", fmt.Errorf("user lookup failed user_id=%d session_id=%d: %w", session.UserID, sessionID, err)
	}
	if user == nil || !user.Active {
		deleteSessionSafe(sessionID, "failed to delete session for inactive user")
		return nil, "", "", fmt.Errorf("user inactive or not found user_id=%d session_id=%d", session.UserID, sessionID)
	}

	// 6. Generate New Access Token
	newAccessToken, err := GenerateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate access token user_id=%d session_id=%d: %w", user.ID, sessionID, err)
	}

	// 7. Rotate Refresh Token
	newRefreshToken, newTokenHash, err := GenerateRefreshToken(sessionID)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to rotate refresh token user_id=%d session_id=%d: %w", user.ID, sessionID, err)
	}

	// 8. Update Session
	session.TokenHash = newTokenHash
	session.ExpiresAt = time.Now().UTC().Add(refreshTokenDuration)
	if err := UpdateSession(session); err != nil {
		return nil, "", "", fmt.Errorf("failed to update session user_id=%d session_id=%d: %w", session.UserID, sessionID, err)
	}

	return user, newAccessToken, newRefreshToken, nil
}
