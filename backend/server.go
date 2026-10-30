package backend

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

var logLevel string
var secureCookieStr string
var secureCookie bool
var apiRateLimitStr string
var apiRateLimitEnabled bool
var remoteIPHeader string
var trustedProxiesStr string

// defaultTrustedProxies covers loopback and the private ranges, where reverse
// proxies, Docker networks and Kubernetes pod networks usually live.
var defaultTrustedProxies = []netip.Prefix{
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),     //NOSONAR - private range, not a host address
	netip.MustParsePrefix("172.16.0.0/12"),  //NOSONAR - private range, not a host address
	netip.MustParsePrefix("192.168.0.0/16"), //NOSONAR - private range, not a host address
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"),
}

// trustedProxies are the peers whose remoteIPHeader is used (see GetClientIP).
var trustedProxies = defaultTrustedProxies

func init() {
	flag.StringVar(&logLevel, "log-level", "", "Log level (debug, info, warn, error)")
	flag.StringVar(&secureCookieStr, "secure-cookie", "", "Set Secure flag on auth cookies (true/false, default: true)")
	flag.StringVar(&apiRateLimitStr, "api-rate-limit", "", "Enable per-user API rate limiting (true/false, default: true)")
	flag.StringVar(&remoteIPHeader, "remote-ip-header", "", "HTTP header with the client IP, used only from trusted proxies (e.g. X-Forwarded-For)")
	flag.StringVar(&trustedProxiesStr, "trusted-proxies", "", "Comma-separated CIDRs or IPs of trusted reverse proxies (default: loopback and private ranges)")
}

// StartServer initializes the database, serves static files, and starts the HTTP server.
func StartServer(version string, port string, dbPath string, initialAdminEmail string, initialAdminPassword string, secretKey string, embeddedFiles embed.FS) {
	if err := resolveServerConfig(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	fmt.Printf("Starting wuFlow version: %s at %s\n", version, time.Now().Format("2006-01-02 15:04:05"))
	fmt.Printf("Using database: %s\n", dbPath)
	fmt.Printf("Log level: %s\n", logLevel)
	fmt.Printf("Secure cookies: %v\n", secureCookie)
	fmt.Printf("API rate limiting: %v\n", apiRateLimitEnabled)
	if remoteIPHeader != "" {
		fmt.Printf("Remote IP header: %s\n", remoteIPHeader)
		fmt.Printf("Trusted proxies: %v\n", trustedProxies)
	}

	bootstrapDatabase(dbPath, initialAdminEmail, initialAdminPassword, secretKey)

	// Serve the frontend build output from the embedded filesystem
	fmt.Printf("Serving static files from: embedded in binary\n")
	staticFS, err := fs.Sub(embeddedFiles, staticRoot)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := fs.Stat(staticFS, indexFile); err != nil {
		log.Fatalf("Frontend not built (%s/index.html missing): run 'npm ci && npm run build' in static/js, then start the server again", staticRoot)
	}

	mux := APIMux(version)
	if err := registerStaticRoutes(mux, staticFS); err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Server starting on port %s\n", port)
	LogInfo("Server starting", "port", port)
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	runWithGracefulShutdown(srv)
}

// resolveServerConfig applies the Flag > Env > Default priority to each
// configuration variable and initialises the package-wide log level.
// It returns an error for an invalid log level or trusted-proxy entry.
func resolveServerConfig() error {
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

	// Priority: Flag > Env > Default (true)
	if apiRateLimitStr == "" {
		apiRateLimitStr = os.Getenv("WF_API_RATE_LIMIT")
	}
	apiRateLimitEnabled = apiRateLimitStr != "false"

	// Priority: Flag > Env
	if remoteIPHeader == "" {
		remoteIPHeader = os.Getenv("WF_REMOTE_IP_HEADER")
	}

	// Priority: Flag > Env > Default (loopback and private ranges)
	if trustedProxiesStr == "" {
		trustedProxiesStr = os.Getenv("WF_TRUSTED_PROXIES")
	}
	proxies, err := parseTrustedProxies(trustedProxiesStr)
	if err != nil {
		return err
	}
	trustedProxies = proxies

	level, err := parseLogLevel(logLevel)
	if err != nil {
		return err
	}

	// Initialise the package-wide safeLogger (defined in utils.go) at the
	// resolved level. All log calls go through LogInfo/LogWarn/LogError/LogDebug
	// helpers — see utils.go for the gosec G706 rationale.
	SetLogLevel(level)
	return nil
}

// bootstrapDatabase opens the DB, cleans up expired sessions, derives the
// crypto keys, and ensures the initial admin user exists. Fatal on any DB-
// init or admin-bootstrap failure; non-fatal on expired-session cleanup.
func bootstrapDatabase(dbPath, initialAdminEmail, initialAdminPassword, secretKey string) {
	startupCtx := context.Background()
	if err := InitDB(startupCtx, dbPath); err != nil {
		LogError("Failed to initialize database", "error", err)
		os.Exit(1)
	}

	// Clean up expired sessions on startup
	deletedSessions, err := DeleteExpiredSessions(startupCtx)
	if err != nil {
		LogWarn("Failed to cleanup expired sessions", "error", err)
	} else {
		LogInfo("Cleaned up expired sessions", "count", deletedSessions)
	}

	InitSecretKey(secretKey)

	if _, err := dummyPasswordHash(); err != nil {
		LogError("Failed to create dummy password hash", "error", err)
		os.Exit(1)
	}

	if err := EnsureInitialAdmin(startupCtx, initialAdminEmail, initialAdminPassword); err != nil {
		LogError("Failed to ensure initial admin user", "error", err)
		os.Exit(1)
	}
}

// runWithGracefulShutdown starts srv in a goroutine, blocks on SIGINT/SIGTERM,
// then drains in-flight requests via srv.Shutdown with a bounded timeout.
// Cloud orchestrators (Kubernetes, Docker, etc.) rely on this signal to drain
// a container during a rolling deploy.
func runWithGracefulShutdown(srv *http.Server) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	sig := <-quit
	LogInfo("Shutdown signal received", "signal", sig.String())
	shutCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		LogError("Graceful shutdown failed", "error", err)
	} else {
		LogInfo("Server shut down cleanly")
	}
}

// apiRequestTimeout is the per-request application-level deadline propagated to
// every DB call via the request context. 5 s is far above any realistic SQLite
// query but short enough to protect against lock contention or a future remote
// database round-trip going wrong.
const apiRequestTimeout = 5 * time.Second

// APIMux returns an http.ServeMux with every API route registered using
// Go 1.22 method+path patterns and the full middleware chain (auth + rate
// limit + JSON / body / path validators).
func APIMux(version string) *http.ServeMux {
	timeout := TimeoutMiddleware(apiRequestTimeout)
	// commonAPI: applied to PUBLIC API routes (login, logout, refresh).
	//   Order: Logging → CSP → ValidatePath → LimitBody → RequireJSON → Timeout → Handler
	commonAPI := func(h http.Handler) http.Handler {
		return WithLogging(SecurityHeadersMiddleware(ValidatePathMiddleware(LimitBodyMiddleware(RequireJSONMiddleware(timeout(h))))))
	}
	// authAPI: applied to PROTECTED API routes. Same chain as commonAPI plus
	// Auth, UserRateLimit, and Timeout. Timeout is placed AFTER AuthMiddleware
	// so the deadline applies to handler+DB work, not to cookie parsing.
	//   Order: Logging → CSP → ValidatePath → LimitBody → RequireJSON → Auth → UserRateLimit → Timeout → Handler
	authAPI := func(h http.Handler) http.Handler {
		return WithLogging(SecurityHeadersMiddleware(ValidatePathMiddleware(LimitBodyMiddleware(RequireJSONMiddleware(AuthMiddleware(UserRateLimitMiddleware(timeout(h))))))))
	}
	return buildAPIMux(version, commonAPI, authAPI)
}

// TimeoutMiddleware cancels the request context if the handler exceeds timeout.
func TimeoutMiddleware(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				LogWarn("Request exceeded application timeout",
					"method", r.Method,
					"path", r.URL.Path,
					"timeout", timeout,
					"user_id", GetUserIDFromContext(ctx),
					"ip", GetClientIP(r),
				)
			}
		})
	}
}

// buildAPIMux is the canonical API table: every line below is method, path,
// factory-wrapped handler. Method dispatch (and 405 responses) is delegated to
// the mux. Literal segments like /issues/active take priority over /issues/{id}
// automatically (Go 1.22 mux behavior).
func buildAPIMux(version string, commonAPI, authAPI func(http.Handler) http.Handler) *http.ServeMux {
	mux := http.NewServeMux()

	hf := func(method, pattern string, h http.HandlerFunc, wrap func(http.Handler) http.Handler) {
		mux.Handle(method+" "+pattern, wrap(h))
	}

	// --- Public auth ----------------------------------------------------------
	hf("POST", "/api/auth/login", HandleLogin, commonAPI)
	hf("POST", "/api/auth/logout", HandleLogout, commonAPI)
	hf("POST", "/api/auth/refresh", HandleRefresh, commonAPI)
	hf("GET", "/api/health", HandleHealth, commonAPI)

	// =========================================================================
	// All routes below require authentication (wrapped with authAPI).
	// =========================================================================

	// --- Current user (self) --------------------------------------------------
	hf("GET", "/api/auth/me", HandleGetCurrentUser, authAPI)
	hf("PUT", "/api/auth/me", HandleUpdateSelf, authAPI)

	// --- Users ----------------------------------------------------------------
	hf("GET", "/api/users", withRole(ActionListUsers, handleListUsers), authAPI)
	hf("POST", "/api/users", withRole(ActionCreateUser, handleCreateUser), authAPI)
	hf("GET", "/api/users/{id}", withResource(ActionGetUser, handleGetUser), authAPI) //NOSONAR, ignore double string warning
	hf("PUT", "/api/users/{id}", withResource(ActionUpdateUser, handleUpdateUser), authAPI)
	hf("DELETE", "/api/users/{id}", withResource(ActionDeleteUser, handleDeleteUser), authAPI)

	// --- Projects -------------------------------------------------------------
	hf("GET", "/api/projects", withRole(ActionListProjects, handleListProjects), authAPI)
	hf("POST", "/api/projects", withRole(ActionCreateProject, handleCreateProject), authAPI)
	hf("PUT", "/api/projects/{pId}", withProject(ActionUpdateProject, handleUpdateProject), authAPI)
	hf("DELETE", "/api/projects/{pId}", withProject(ActionDeleteProject, handleDeleteProject), authAPI)

	// --- Project-scoped issues (literals before wildcards by Go 1.22 priority) -
	hf("GET", "/api/projects/{pId}/issues/active", withProject(ActionListIssues, handleProjectActiveIssues), authAPI)
	hf("GET", "/api/projects/{pId}/issues/archived", withProject(ActionListIssues, handleProjectArchivedIssues), authAPI)
	hf("GET", "/api/projects/{pId}/issues/open", withProject(ActionListIssues, handleProjectOpenIssues), authAPI)
	hf("POST", "/api/projects/{pId}/issues", withProject(ActionCreateIssue, handleCreateIssue), authAPI)
	hf("PUT", "/api/projects/{pId}/issues/positions", withProject(ActionUpdateIssue, handlePutIssuePositions), authAPI)
	hf("GET", "/api/projects/{pId}/issues/{id}", withProjectResource(ActionGetIssue, handleGetIssue), authAPI) //NOSONAR, ignore double string warning
	hf("PUT", "/api/projects/{pId}/issues/{id}", withProjectResource(ActionUpdateIssue, handlePutIssue), authAPI)
	hf("DELETE", "/api/projects/{pId}/issues/{id}", withProjectResource(ActionDeleteIssue, handleDeleteIssue), authAPI)
	hf("POST", "/api/projects/{pId}/issues/{id}/archive", withProjectResource(ActionArchiveIssue, handleArchiveIssue), authAPI)
	hf("POST", "/api/projects/{pId}/issues/{id}/unarchive", withProjectResource(ActionUnarchiveIssue, handleUnarchiveIssue), authAPI)
	hf("POST", "/api/projects/{pId}/issues/{id}/move", withProjectResource(ActionMoveIssue, handleMoveIssue), authAPI)

	// --- Project-scoped labels ------------------------------------------------
	hf("GET", "/api/projects/{pId}/labels", withProject(ActionListLabels, handleListLabels), authAPI)
	hf("POST", "/api/projects/{pId}/labels", withProject(ActionCreateLabel, handleCreateLabel), authAPI)
	hf("DELETE", "/api/projects/{pId}/labels/{id}", withProjectResource(ActionDeleteLabel, handleDeleteLabel), authAPI)

	// --- Project status config ------------------------------------------------
	hf("GET", "/api/projects/{pId}/statusconfig", withProject(ActionGetStatusConfig, handleGetStatusConfig), authAPI)
	hf("PUT", "/api/projects/{pId}/statusconfig", withProject(ActionUpdateStatusConfig, handleUpdateStatusConfig), authAPI)

	// --- Project-scoped releases ----------------------------------------------
	hf("GET", "/api/projects/{pId}/releases", withProject(ActionListReleases, handleListReleases), authAPI)
	hf("POST", "/api/projects/{pId}/releases", withProject(ActionCreateRelease, handleCreateRelease), authAPI)
	hf("GET", "/api/projects/{pId}/releases/{id}", withProjectResource(ActionGetRelease, handleGetRelease), authAPI) //NOSONAR, ignore double string warning
	hf("PUT", "/api/projects/{pId}/releases/{id}", withProjectResource(ActionUpdateRelease, handlePutRelease), authAPI)
	hf("DELETE", "/api/projects/{pId}/releases/{id}", withProjectResource(ActionDeleteRelease, handleDeleteRelease), authAPI)
	hf("POST", "/api/projects/{pId}/releases/{id}/release", withProjectResource(ActionTriggerRelease, handleTriggerRelease), authAPI)
	hf("POST", "/api/projects/{pId}/releases/{id}/reopen", withProjectResource(ActionTriggerRelease, handleReopenRelease), authAPI)

	// --- Project- and issue-scoped tasks --------------------------------------
	hf("POST", "/api/projects/{pId}/issues/{iId}/tasks", withIssue(ActionCreateTask, handleCreateTask), authAPI)
	hf("PUT", "/api/projects/{pId}/issues/{iId}/tasks/positions", withIssue(ActionUpdateTask, handlePutTaskPositions), authAPI)
	hf("PUT", "/api/projects/{pId}/issues/{iId}/tasks/{id}", withIssueResource(ActionUpdateTask, handlePutTask), authAPI)
	hf("DELETE", "/api/projects/{pId}/issues/{iId}/tasks/{id}", withIssueResource(ActionDeleteTask, handleDeleteTask), authAPI)

	// --- Project- and issue-scoped history + comments -------------------------
	hf("GET", "/api/projects/{pId}/issues/{iId}/history", withIssue(ActionListHistory, handleListHistory), authAPI)
	hf("GET", "/api/projects/{pId}/issues/{iId}/comments", withIssue(ActionListComments, handleListComments), authAPI)
	hf("POST", "/api/projects/{pId}/issues/{iId}/comments", withIssue(ActionCreateComment, handleCreateComment), authAPI)
	hf("PUT", "/api/projects/{pId}/issues/{iId}/comments/{id}", withIssueResource(ActionUpdateComment, handlePutComment), authAPI)
	hf("DELETE", "/api/projects/{pId}/issues/{iId}/comments/{id}", withIssueResource(ActionDeleteComment, handleDeleteComment), authAPI)

	// --- Misc -----------------------------------------------------------------
	hf("GET", "/api/version", HandleGetVersion(version), authAPI)

	return mux
}

// HandleLoginHTML serves the login page.
func HandleLoginHTML(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/login.html"
		next.ServeHTTP(w, r)
	}
}

// HandleStaticFiles serves the app (index.html) to authenticated users and
// redirects everyone else to the login page.
func HandleStaticFiles(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Check auth — redirect to login if not authenticated
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

		// If we get here, no valid session exists
		LogInfo("Unauthenticated access, redirecting to login", "path", path, "ip", GetClientIP(r))
		w.Header().Set("Location", loginPath)
		w.WriteHeader(http.StatusFound)
	}
}

// staticRoot is the directory of the embedded filesystem that holds the Vite
// build output (static/js/vite.config.js).
const staticRoot = "static/dist/app"

// indexFile is the page http.FileServer serves for a directory path such as "/".
const indexFile = "index.html"

// assetsDir is the directory of the content-hashed files of the Vite build
// (scripts, styles, images, favicons), served under /assets/.
const assetsDir = "assets"

// immutableCacheControl lets browsers and CDNs keep the content-hashed assets
// for a year without revalidation: a changed file gets a new name in the next
// build, and the HTML referencing it is revalidated on every load.
const immutableCacheControl = "public, max-age=31536000, immutable"

// revalidateCacheControl makes browsers revalidate the HTML pages on every load,
// so that an upgrade is picked up at once.
const revalidateCacheControl = "no-cache"

// registerStaticRoutes serves the frontend build output in staticFS:
//   - /assets/: the build assets, public, because the login page needs them
//     before a session exists (the frontend code is open source anyway). The
//     route has its own file server rooted at assets/, so no request path,
//     however encoded, can reach a file outside it, e.g. the app's index.html.
//   - /login: the login page, public.
//   - everything else: the app, behind the login.
//
// ValidatePathMiddleware is intentionally NOT applied; we only protect the API.
// GET only; the mux returns 405 for any other method.
//
// The tests run on a mux built by this function, so their bypass checks cover
// the production wiring: register every static route here, never in StartServer.
func registerStaticRoutes(mux *http.ServeMux, staticFS fs.FS) error {
	etags, err := computeETags(staticFS)
	if err != nil {
		return err
	}
	assetsFS, err := fs.Sub(staticFS, assetsDir)
	if err != nil {
		return err
	}
	assets := withCacheHeaders(http.StripPrefix("/"+assetsDir, http.FileServer(neuteredFileSystem{http.FS(assetsFS)})), immutableCacheControl, etags)
	pages := withCacheHeaders(http.FileServer(neuteredFileSystem{http.FS(staticFS)}), revalidateCacheControl, etags)

	mux.Handle("GET /"+assetsDir+"/", WithLogging(SecurityHeadersMiddleware(assets)))
	mux.Handle("GET "+loginPath, WithLogging(SecurityHeadersMiddleware(HandleLoginHTML(pages))))
	mux.Handle("GET /", WithLogging(SecurityHeadersMiddleware(HandleStaticFiles(pages))))
	return nil
}

// withCacheHeaders sets Cache-Control and, if known for the URL path, the ETag.
// http.FileServer answers a matching If-None-Match with 304, and it removes
// both headers again when it serves an error (e.g. 404), so a missing file is
// never cached.
func withCacheHeaders(next http.Handler, cacheControl string, etags map[string]string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if etag, ok := etags[r.URL.Path]; ok {
			w.Header().Set("ETag", etag)
		}
		w.Header().Set("Cache-Control", cacheControl)
		next.ServeHTTP(w, r)
	})
}

// computeETags returns a strong ETag (truncated SHA-256 of the content) for
// every file in fsys, keyed by URL path; an index.html is also keyed by its
// directory path, under which http.FileServer serves it. embed.FS has no
// modification times, so http.FileServer sends no Last-Modified and the ETag is
// the only validator. The files cannot change at runtime, so hashing once at
// startup is enough, and content hashes are equal across replicas.
func computeETags(fsys fs.FS) (map[string]string, error) {
	etags := map[string]string{}
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		etag := `"` + hex.EncodeToString(sum[:16]) + `"`
		etags["/"+name] = etag
		if name == indexFile || strings.HasSuffix(name, "/"+indexFile) {
			etags["/"+strings.TrimSuffix(name, indexFile)] = etag
		}
		return nil
	})
	return etags, err
}

type neuteredFileSystem struct {
	fs http.FileSystem
}

func (nfs neuteredFileSystem) Open(path string) (http.File, error) {
	f, err := nfs.fs.Open(path)
	if err != nil {
		return nil, err
	}

	s, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if s.IsDir() {
		index := strings.TrimSuffix(path, "/") + "/" + indexFile
		if _, err := nfs.fs.Open(index); err != nil {
			return nil, err // Returning error here prevents folder listing
		}
	}

	return f, nil
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
		return slog.LevelInfo, fmt.Errorf("invalid log level '%s'", levelStr)
	}
}

// parseTrustedProxies parses a comma-separated list of CIDRs or bare IPs (a
// bare IP becomes a /32 or /128). Empty elements are skipped; an invalid entry
// is an error. A list with only empty elements yields the default.
func parseTrustedProxies(s string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for entry := range strings.SplitSeq(s, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		prefix, err := parseTrustedProxy(entry)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy '%s': must be an IP or CIDR without zone", entry)
		}
		prefixes = append(prefixes, prefix)
	}
	if len(prefixes) == 0 {
		return defaultTrustedProxies, nil
	}
	return prefixes, nil
}

func parseTrustedProxy(entry string) (netip.Prefix, error) {
	if strings.Contains(entry, "/") {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			return netip.Prefix{}, err
		}
		// Client addresses are unmapped (parseIP), so a mapped range would never match.
		if prefix.Addr().Is4In6() {
			return netip.Prefix{}, errors.New("IPv4-mapped range: write it in IPv4 notation")
		}
		return prefix.Masked(), nil
	}
	addr, err := netip.ParseAddr(entry)
	if err != nil || addr.Zone() != "" {
		return netip.Prefix{}, errors.New("invalid IP")
	}
	addr = addr.Unmap()
	return netip.PrefixFrom(addr, addr.BitLen()), nil
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
				LogWarn("RequireJSONMiddleware: rejected request", "method", r.Method, "path", r.URL.Path, "content_type", ct)
				http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// UserRateLimitMiddleware throttles write requests (POST, PUT, DELETE) from
// authenticated users to apiMaxRequests per apiRateWindow. Read-only methods
// (GET, HEAD, OPTIONS) pass through unconditionally. Requests without a user ID
// in context (unauthenticated) also pass through — AuthMiddleware handles those.
// It must be placed after AuthMiddleware in the chain so the user ID is in context.
// Rate limiting can be disabled with --api-rate-limit=false (or WF_API_RATE_LIMIT=false).
func UserRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !apiRateLimitEnabled {
			next.ServeHTTP(w, r)
			return
		}

		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodDelete:
		default:
			next.ServeHTTP(w, r)
			return
		}

		userID := GetUserIDFromContext(r.Context())
		if userID == 0 {
			// AuthMiddleware did not set a user ID — let its own 401 handle this.
			next.ServeHTTP(w, r)
			return
		}

		if !apiLimiter.allow(userID) {
			LogWarn("API rate limit exceeded", "user_id", userID,
				"method", r.Method, "path", r.URL.Path)
			http.Error(w, errMsgTooManyRequests, http.StatusTooManyRequests)
			return
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
			LogWarn("Strict validation failed: query parameters not allowed",
				"path", r.URL.Path,
				"query", r.URL.RawQuery,
				"ip", GetClientIP(r),
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
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
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

		LogInfo("HTTP Request",
			"ip", GetClientIP(r),
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
