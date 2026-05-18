package backend

import (
	"log/slog"
	"net"
	"net/http"
	"os"
)

// safeLogger uses an explicitly-instantiated slog.JSONHandler so gosec G706
// can see (statically, at the helper's call site) that attribute values are
// JSON-escaped — neutralising any embedded newlines in tainted input.
// Reuse via LogInfo / LogWarn / LogError / LogDebug; production code should
// never call slog.X directly, which would re-introduce the G706 finding.
var safeLogger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

// SetLogLevel rebuilds safeLogger at the given level. Called once at startup
// from StartServer after the log level is resolved from flag/env.
func SetLogLevel(level slog.Level) {
	safeLogger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

// LogInfo logs at INFO via safeLogger.
func LogInfo(msg string, args ...any) { safeLogger.Info(msg, args...) }

// LogWarn logs at WARN via safeLogger.
func LogWarn(msg string, args ...any) { safeLogger.Warn(msg, args...) }

// LogError logs at ERROR via safeLogger.
func LogError(msg string, args ...any) { safeLogger.Error(msg, args...) }

// LogDebug logs at DEBUG via safeLogger.
func LogDebug(msg string, args ...any) { safeLogger.Debug(msg, args...) }

// GetClientIP extracts the client's IP address from the request.
// If remoteIPHeader is set, it reads the IP directly from that header and
// validates it. If the header is missing or contains an invalid IP, it logs a
// warning and falls back to r.RemoteAddr.
// If remoteIPHeader is not configured, it always uses r.RemoteAddr.
func GetClientIP(r *http.Request) string {
	if remoteIPHeader != "" {
		if headerIP := r.Header.Get(remoteIPHeader); headerIP != "" {
			if net.ParseIP(headerIP) == nil {
				LogWarn("GetClientIP: invalid IP in header, falling back to RemoteAddr",
					"header", remoteIPHeader, "value", headerIP)
			} else {
				return headerIP
			}
		}
	}

	// Default fallback: split host:port from RemoteAddr
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
