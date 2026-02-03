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
	flag.StringVar(&logLevel, "log_level", "", "Log level (debug, info, warn, error)")
}

// StartServer initializes the database, serves static files, and starts the HTTP server.
func StartServer(version string, port string, dbPath string, embeddedFiles embed.FS) {
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

	fmt.Printf("Starting wuFlow version: %s\n", version)
	fmt.Printf("Using database: %s\n", dbPath)
	fmt.Printf("Log level: %s\n", logLevel)
	InitDB(dbPath)

	// Serve static files from embedded filesystem
	fmt.Printf("Serving static files from: embedded in binary\n")
	staticFS, err := fs.Sub(embeddedFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("/", WithLogging(http.FileServer(http.FS(staticFS))))

	// API endpoints
	http.Handle("/api/issues", WithLogging(http.HandlerFunc(HandleIssues)))
	http.Handle("/api/issues/", WithLogging(http.HandlerFunc(HandleIssuesRoute)))
	http.Handle("/api/tasks/", WithLogging(http.HandlerFunc(HandleTask)))
	http.Handle("/api/labels", WithLogging(http.HandlerFunc(HandleLabels)))
	http.Handle("/api/labels/", WithLogging(http.HandlerFunc(HandleLabel)))
	http.Handle("/api/version", WithLogging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"version": version})
	})))

	fmt.Printf("Server starting on port %s\n", port)
	slog.Info("Server starting", "port", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
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

// HandleIssuesRoute dispatches requests to HandleTasks or HandleIssue based on the URL path.
func HandleIssuesRoute(w http.ResponseWriter, r *http.Request) {
	// Differentiate between /api/issues/{id} and /api/issues/{id}/tasks
	if strings := r.URL.Path; len(strings) > 12 && strings[len(strings)-6:] == "/tasks" {
		HandleTasks(w, r)
	} else {
		HandleIssue(w, r)
	}
}
