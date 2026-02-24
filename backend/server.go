package backend

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

var logLevel string
var secureCookieStr string
var secureCookie bool

func init() {
	flag.StringVar(&logLevel, "log-level", "", "Log level (debug, info, warn, error)")
	flag.StringVar(&secureCookieStr, "secure-cookie", "", "Set Secure flag on auth cookies (true/false, default: true)")
}

// StartServer initializes the database, serves static files, and starts the HTTP server.
func StartServer(version string, port string, dbPath string, initialAdminPassword string, secretKey string, embeddedFiles embed.FS) {
	if !flag.Parsed() {
		flag.Parse()
	}

	// Priority: Flag > Env > Default (info)
	if logLevel == "" {
		logLevel = os.Getenv("WF_LOG_LEVEL")
	}
	if logLevel == "" {
		logLevel = "info"
	}

	// Priority: Flag > Env > Default (true)
	if secureCookieStr == "" {
		secureCookieStr = os.Getenv("WF_SECURE_COOKIE")
	}
	secureCookie = secureCookieStr != "false"

	level, err := parseLogLevel(logLevel)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	fmt.Printf("Starting wuFlow version: %s at %s\n", version, time.Now().Format("2006-01-02 15:04:05"))
	fmt.Printf("Using database: %s\n", dbPath)
	fmt.Printf("Log level: %s\n", logLevel)
	fmt.Printf("Secure cookies: %v\n", secureCookie)
	if err := InitDB(dbPath); err != nil {
		slog.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}

	// Clean up expired sessions on startup
	deletedSessions, err := DeleteExpiredSessions()
	if err != nil {
		slog.Warn("Failed to cleanup expired sessions", "error", err)
	} else {
		slog.Info("Cleaned up expired sessions", "count", deletedSessions)
	}

	// Initialize secret key
	InitSecretKey(secretKey)

	// Create initial admin user if no users exist
	if err := EnsureInitialAdmin(initialAdminPassword); err != nil {
		slog.Error("Failed to ensure initial admin user", "error", err)
		os.Exit(1)
	}

	// Serve static files from embedded filesystem
	fmt.Printf("Serving static files from: embedded in binary\n")
	staticFS, err := fs.Sub(embeddedFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(staticFS))

	// Login page — served without auth
	http.Handle(loginPath, WithLogging(SecurityHeadersMiddleware(HandleLoginHTML(fileServer))))

	// Middleware stacks
	// 1. commonAPI: Applied to ALL API routes (public & private)
	//    Order: Logging -> CSP -> ValidatePath -> LimitBody -> RequireJSON -> Handler
	commonAPI := func(h http.Handler) http.Handler {
		return WithLogging(SecurityHeadersMiddleware(ValidatePathMiddleware(LimitBodyMiddleware(RequireJSONMiddleware(h)))))
	}

	// 2. authAPI: Applied to PROTECTED API routes
	//    Order: Logging -> CSP -> ValidatePath -> LimitBody -> RequireJSON -> Auth -> Handler
	authAPI := func(h http.Handler) http.Handler {
		return WithLogging(SecurityHeadersMiddleware(ValidatePathMiddleware(LimitBodyMiddleware(RequireJSONMiddleware(AuthMiddleware(h))))))
	}

	// Public auth endpoints
	http.Handle("/api/auth/login", commonAPI(http.HandlerFunc(HandleLogin)))
	http.Handle("/api/auth/logout", commonAPI(http.HandlerFunc(HandleLogout)))
	http.Handle("/api/auth/refresh", commonAPI(http.HandlerFunc(HandleRefresh)))

	// Protected auth endpoint
	http.Handle("/api/auth/me", authAPI(http.HandlerFunc(HandleCurrentUser)))

	// Authenticated API endpoints
	http.Handle("/api/issues", authAPI(http.HandlerFunc(HandleCreateIssue)))
	http.Handle("/api/issues/active", authAPI(http.HandlerFunc(HandleActiveIssues)))
	http.Handle("/api/issues/archived", authAPI(http.HandlerFunc(HandleArchivedIssues)))
	http.Handle("/api/issues/", authAPI(http.HandlerFunc(HandleIssue)))
	http.Handle("/api/tasks", authAPI(http.HandlerFunc(HandleCreateTask)))
	http.Handle("/api/tasks/", authAPI(http.HandlerFunc(HandleTask)))
	http.Handle("/api/labels", authAPI(http.HandlerFunc(HandleLabels)))
	http.Handle("/api/labels/", authAPI(http.HandlerFunc(HandleLabel)))
	http.Handle("/api/users", authAPI(http.HandlerFunc(HandleUsers)))
	http.Handle("/api/users/", authAPI(http.HandlerFunc(HandleUser)))
	http.Handle("/api/version", authAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(headerContentType, contentTypeJSON)
		json.NewEncoder(w).Encode(map[string]string{"version": version})
	})))

	// Static files — require auth, redirect to login if not authenticated
	// ValidatePathMiddleware is not applied for static files, we only want to protect the API
	http.Handle("/", WithLogging(SecurityHeadersMiddleware(HandleStaticFiles(fileServer))))

	fmt.Printf("Server starting on port %s\n", port)
	slog.Info("Server starting", "port", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

// HandleLoginHTML serves the login page.
func HandleLoginHTML(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/login.html"
		next.ServeHTTP(w, r)
	}
}

// HandleStaticFiles checks auth for HTML pages and serves static assets directly.
func HandleStaticFiles(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Check public assets first — no need to process cookies/auth for these
		if isPublicAsset(path) {
			next.ServeHTTP(w, r)
			return
		}

		// Check auth for HTML pages — redirect to login if not authenticated
		accessTokenCookie, err := r.Cookie(cookieAccessToken)
		authenticated := false
		if err == nil && accessTokenCookie.Value != "" {
			if _, err := ValidateToken(accessTokenCookie.Value); err == nil {
				authenticated = true
			}
		}

		// Access token missing or expired — try refresh token
		if !authenticated && tryRefreshSession(w, r) {
			authenticated = true
		}

		if authenticated {
			next.ServeHTTP(w, r)
			return
		}

		// If we get here, no valid session exists and it's not a public asset
		http.Redirect(w, r, loginPath, http.StatusFound)
	}
}

// isPublicAsset returns true if the path is explicitly allowed without authentication.
func isPublicAsset(path string) bool {
	publicAssets := map[string]bool{
		"/logo.png":                       true,
		"/js/login.js":                    true,
		"/styles/abstracts/variables.css": true,
		"/styles/base/reset.css":          true,
		"/styles/pages/login.css":         true,
	}
	return publicAssets[path]
}

func parseLogLevel(levelStr string) (slog.Level, error) {
	switch strings.ToLower(levelStr) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("Invalid log level '%s'", levelStr)
	}
}

// LimitBodyMiddleware caps the request body size at 32 KB to prevent memory
// exhaustion from oversized payloads. The largest legitimate payload is a full
// issue with a max-length description (~11 KB); 32 KB gives a comfortable margin.
func LimitBodyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 32*1024) // 32 KB
		next.ServeHTTP(w, r)
	})
}

// RequireJSONMiddleware enforces that POST and PUT requests declare
// Content-Type: application/json. GET, DELETE, and other methods are unaffected.
func RequireJSONMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPut {
			ct := r.Header.Get("Content-Type")
			if !strings.HasPrefix(ct, "application/json") {
				http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ValidatePathMiddleware enforces strict rules on API requests.
// Currently, it rejects any request containing query parameters, as the API does not support them.
func ValidatePathMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strict Query Parameter Check:
		// We do not currently support ANY query parameters on API endpoints.
		// If RawQuery is present, it means the client sent something like ?foo=bar
		if r.URL.RawQuery != "" {
			slog.Warn("Strict validation failed: query parameters not allowed",
				"path", r.URL.Path,
				"query", r.URL.RawQuery,
				"ip", r.RemoteAddr,
			)
			http.Error(w, "Query parameters are not allowed on this endpoint", http.StatusBadRequest)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// SecurityHeadersMiddleware adds security-related HTTP headers to all responses.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
		w.Header().Set("X-XSS-Protection", "0")
		if secureCookie {
			// Only emit HSTS when TLS is enabled (secureCookie == true).
			// HTTP-only deployments (e.g. access via internal network) must not receive this header.
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// WithLogging wraps an http.Handler to log request details
func WithLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapper := &responseWriterWrapper{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapper, r)
		duration := time.Since(start)

		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}

		slog.Info("HTTP Request",
			"ip", ip,
			"method", r.Method,
			"path", r.URL.Path,
			"duration", duration,
			"status", wrapper.statusCode,
			"size", wrapper.written,
		)
	})
}

// responseWriterWrapper captures status code and size
type responseWriterWrapper struct {
	http.ResponseWriter
	statusCode int
	written    int64
}

func (rw *responseWriterWrapper) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriterWrapper) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.written += int64(n)
	return n, err
}
