package backend

import (
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"slices"
	"strings"
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
// It uses remoteIPHeader only if that is configured and the direct peer
// (r.RemoteAddr) is a trusted proxy; otherwise it returns the peer's IP.
func GetClientIP(r *http.Request) string {
	peer := remoteAddrIP(r)
	if remoteIPHeader == "" || !isTrustedProxy(peer) {
		return peer
	}
	if ip, ok := clientIPFromHeader(r); ok {
		return ip
	}
	return peer
}

// remoteAddrIP returns the host part of r.RemoteAddr, or r.RemoteAddr as is if
// it has no port.
func remoteAddrIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

// clientIPFromHeader selects the client IP from remoteIPHeader as described on
// MDN (X-Forwarded-For, "Trusted proxy list"): all header lines form one list,
// which is read from the right, skipping trusted proxies. The first untrusted
// entry is the client; entries left of it may be forged by the client. If every
// entry is trusted, the leftmost one is the client (as in Gin and Rails).
// An invalid entry ends the search: ok is false and a warning is logged.
func clientIPFromHeader(r *http.Request) (ip string, ok bool) {
	value := strings.Join(r.Header.Values(remoteIPHeader), ",")
	if value == "" {
		return "", false
	}
	var addr netip.Addr
	for _, entry := range slices.Backward(strings.Split(value, ",")) {
		parsed, err := netip.ParseAddr(strings.TrimSpace(entry))
		if err != nil {
			LogWarn("GetClientIP: invalid IP in header, falling back to RemoteAddr",
				"header", remoteIPHeader, "value", value)
			return "", false
		}
		addr = parsed.WithZone("").Unmap()
		if !trustedProxyContains(addr) {
			return addr.String(), true
		}
	}
	// Every entry is a trusted proxy: addr is the leftmost one.
	return addr.String(), true
}

// isTrustedProxy reports whether ip (a textual IP address) is in trustedProxies.
func isTrustedProxy(ip string) bool {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	return trustedProxyContains(addr.WithZone("").Unmap())
}

func trustedProxyContains(addr netip.Addr) bool {
	for _, prefix := range trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
