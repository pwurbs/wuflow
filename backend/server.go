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

func init() {
	flag.StringVar(&logLevel, "log-level", "", "Log level (debug, info, warn, error)")
}

// StartServer initializes the database, serves static files, and starts the HTTP server.
func StartServer(version string, port string, dbPath string, initialAdminPassword string, jwtSecret string, embeddedFiles embed.FS) {
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

	// Initialize JWT secret
	InitJWTSecret(jwtSecret)

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
	http.Handle(loginPath, WithLogging(CSPMiddleware(HandleLoginHTML(fileServer))))

	// Public auth endpoints (no auth middleware)
	http.Handle("/api/auth/login", WithLogging(CSPMiddleware(http.HandlerFunc(HandleLogin))))
	http.Handle("/api/auth/logout", WithLogging(CSPMiddleware(http.HandlerFunc(HandleLogout))))
	http.Handle("/api/auth/refresh", WithLogging(CSPMiddleware(http.HandlerFunc(HandleRefresh))))

	// Protected auth endpoint — requires a valid session
	http.Handle("/api/auth/me", WithLogging(CSPMiddleware(AuthMiddleware(http.HandlerFunc(HandleCurrentUser)))))

	// Authenticated API endpoints.
	// AuthMiddleware handles authentication (JWT validation + context injection).
	// Authorization (Can checks) is enforced inside each handler via permissions.go.
	auth := func(h http.Handler) http.Handler { return AuthMiddleware(h) }

	http.Handle("/api/issues", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleCreateIssue)))))
	http.Handle("/api/issues/active", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleActiveIssues)))))
	http.Handle("/api/issues/archived", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleArchivedIssues)))))
	http.Handle("/api/issues/", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleIssue)))))
	http.Handle("/api/tasks", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleCreateTask)))))
	http.Handle("/api/tasks/", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleTask)))))
	http.Handle("/api/labels", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleLabels)))))
	http.Handle("/api/labels/", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleLabel)))))
	http.Handle("/api/users", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleUsers)))))
	http.Handle("/api/users/", WithLogging(CSPMiddleware(auth(http.HandlerFunc(HandleUser)))))
	http.Handle("/api/version", WithLogging(CSPMiddleware(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(headerContentType, contentTypeJSON)
		json.NewEncoder(w).Encode(map[string]string{"version": version})
	})))))

	// Static files — require auth, redirect to login if not authenticated
	http.Handle("/", WithLogging(CSPMiddleware(HandleStaticFiles(fileServer))))

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

// loggingMiddleware wraps an http.Handler to log request details
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
