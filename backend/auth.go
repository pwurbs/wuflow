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

// jwtSecret is a randomly generated secret used to sign JWT tokens.
// It is regenerated on each server start, invalidating all existing tokens.
var jwtSecret []byte

const (
	accessTokenDuration  = 15 * time.Minute
	refreshTokenDuration = 24 * time.Hour

	cookieAccessToken  = "wf_access_token"
	cookieRefreshToken = "wf_refresh_token"
)

// computeTokenMAC returns an HMAC-SHA256 hex digest of secret, keyed with jwtSecret.
// Used to hash opaque refresh token secrets for database storage.
// Refresh token secrets have 256-bit entropy so bcrypt key-stretching is unnecessary.
func computeTokenMAC(secret []byte) string {
	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write(secret)
	return hex.EncodeToString(mac.Sum(nil))
}

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

// InitJWTSecret initializes the JWT secret.
// If a specific secret is provided, it is used.
// Otherwise, a random 32-byte secret is generated on each start.
func InitJWTSecret(secret string) {
	if secret != "" {
		jwtSecret = []byte(secret)
		slog.Info("JWT secret initialized from configuration")
		return
	}

	jwtSecret = make([]byte, 32)
	if _, err := rand.Read(jwtSecret); err != nil {
		slog.Error("Failed to generate random JWT secret", "error", err)
		panic(fmt.Sprintf("CRITICAL: Failed to generate random JWT secret: %v", err))
	}
	slog.Info("JWT secret initialized (randomly generated)")
}

// HashPassword hashes a plaintext password using bcrypt.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword compares a plaintext password with a bcrypt hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
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
	token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{}, func(token *jwt.Token) (interface{}, error) {
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

// SetAuthCookies sets the access and refresh token cookies on the response.
func SetAuthCookies(w http.ResponseWriter, accessToken, refreshToken string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieAccessToken,
		Value:    accessToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookie, //NOSONAR
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(accessTokenDuration.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     cookieRefreshToken,
		Value:    refreshToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookie, //NOSONAR
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(refreshTokenDuration.Seconds()),
	})
}

// ClearAuthCookies removes the auth cookies from the response.
func ClearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieAccessToken,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookie, //NOSONAR
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     cookieRefreshToken,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookie, //NOSONAR
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
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
func EnsureInitialAdmin(initialAdminPassword string) error {
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

	if err := ValidatePassword(initialAdminPassword, "admin@local"); err != nil {
		return fmt.Errorf("initial admin password does not meet policy requirements: %w", err)
	}

	hash, err := HashPassword(initialAdminPassword)
	if err != nil {
		return err
	}

	admin := &User{
		Email:        "admin@local",
		FirstName:    "Admin",
		LastName:     "User",
		PasswordHash: hash,
		Role:         RoleAdmin,
		Active:       true,
	}

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
		slog.Warn("Static refresh failed", "error", err)
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
		DeleteSession(session.ID) // Cleanup
		return nil, "", "", fmt.Errorf("failed to generate refresh token: %w", err)
	}

	// 4. Update session with the real hash
	session.TokenHash = tokenHash
	if err := UpdateSession(session); err != nil {
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
		return nil, "", "", fmt.Errorf("session lookup failed: %w", err)
	}
	if session == nil {
		return nil, "", "", fmt.Errorf("session not found")
	}

	// 3. Check Expiry
	if time.Now().After(session.ExpiresAt) {
		DeleteSession(sessionID)
		return nil, "", "", fmt.Errorf("session expired")
	}

	// 4. Verify Hash (Reuse Detection)
	expected := computeTokenMAC([]byte(secret))
	if !hmac.Equal([]byte(expected), []byte(session.TokenHash)) {
		slog.Warn("Reuse detection triggered: revoking all sessions for user", "user_id", session.UserID, "session_id", sessionID)
		RevokeUserSessions(session.UserID) // Revoke ALL sessions for this user (Family Revocation)
		return nil, "", "", fmt.Errorf("token reuse detected")
	}

	// 5. Fetch User
	user, err := GetUserByID(session.UserID)
	if err != nil {
		return nil, "", "", fmt.Errorf("user lookup failed: %w", err)
	}
	if user == nil || !user.Active {
		DeleteSession(sessionID)
		return nil, "", "", fmt.Errorf("user inactive or not found")
	}

	// 6. Generate New Access Token
	newAccessToken, err := GenerateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate access token: %w", err)
	}

	// 7. Rotate Refresh Token
	newRefreshToken, newTokenHash, err := GenerateRefreshToken(sessionID)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to rotate refresh token: %w", err)
	}

	// 8. Update Session
	session.TokenHash = newTokenHash
	session.ExpiresAt = time.Now().UTC().Add(refreshTokenDuration)
	if err := UpdateSession(session); err != nil {
		return nil, "", "", fmt.Errorf("failed to update session: %w", err)
	}

	return user, newAccessToken, newRefreshToken, nil
}
