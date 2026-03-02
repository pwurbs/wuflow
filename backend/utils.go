package backend

import (
	"log/slog"
	"net"
	"net/http"
)

// GetClientIP extracts the client's IP address from the request.
// If remoteIPHeader is set, it reads the IP directly from that header and
// validates it. If the header is missing or contains an invalid IP, it logs a
// warning and falls back to r.RemoteAddr.
// If remoteIPHeader is not configured, it always uses r.RemoteAddr.
func GetClientIP(r *http.Request) string {
	if remoteIPHeader != "" {
		if headerIP := r.Header.Get(remoteIPHeader); headerIP != "" {
			if net.ParseIP(headerIP) == nil {
				slog.Warn("GetClientIP: invalid IP in header, falling back to RemoteAddr",
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
