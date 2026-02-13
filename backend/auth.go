package backend

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
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
		// Fallback to a timestamp-based secret if crypto/rand fails (extremely unlikely)
		slog.Error("Failed to generate random JWT secret, using fallback", "error", err)
		jwtSecret = []byte(base64.StdEncoding.EncodeToString([]byte(time.Now().String())))
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
	claims := CustomClaims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(accessTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   user.Email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// GenerateRefreshToken creates a long-lived JWT refresh token for the given user.
func GenerateRefreshToken(user *User) (string, error) {
	claims := CustomClaims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(refreshTokenDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   user.Email,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
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
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(accessTokenDuration.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     cookieRefreshToken,
		Value:    refreshToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
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
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     cookieRefreshToken,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
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

// AdminMiddleware checks that the authenticated user has the admin role.
// Must be used after AuthMiddleware. Returns 403 Forbidden for non-admin users.
func AdminMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role, ok := r.Context().Value(contextKeyRole).(UserRole)
		if !ok || role != RoleAdmin {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// CSPMiddleware adds a Content-Security-Policy header to all responses.
func CSPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		next.ServeHTTP(w, r)
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
