package backend

import (
	"net/http/httptest"
	"testing"
)

const (
	utilTestIP1       = "1.2.3.4"         //NOSONAR
	utilTestLocalAddr = "127.0.0.1:12345" //NOSONAR
	headerForwardedBy = "X-Forwarded-For"
	headerRealIP      = "X-Real-IP"
)

func TestGetClientIP(t *testing.T) {
	origHeader := remoteIPHeader
	defer func() { remoteIPHeader = origHeader }()

	tests := []struct {
		name       string
		setup      func()
		remoteAddr string
		headers    map[string]string
		expected   string
	}{
		{
			name: "Default RemoteAddr (no port)",
			setup: func() {
				remoteIPHeader = ""
			},
			remoteAddr: utilTestIP1,
			expected:   utilTestIP1,
		},
		{
			name: "Default RemoteAddr (with port)",
			setup: func() {
				remoteIPHeader = ""
			},
			remoteAddr: utilTestIP1 + ":12345",
			expected:   utilTestIP1,
		},
		{
			name: "IPv6 RemoteAddr",
			setup: func() {
				remoteIPHeader = ""
			},
			remoteAddr: "[::1]:54321",
			expected:   "::1",
		},
		{
			name: "Custom Header - IPv4",
			setup: func() {
				remoteIPHeader = headerRealIP
			},
			remoteAddr: utilTestLocalAddr,
			headers: map[string]string{
				headerRealIP: "8.8.8.8",
			},
			expected: "8.8.8.8",
		},
		{
			name: "Custom Header - IPv6",
			setup: func() {
				remoteIPHeader = headerRealIP
			},
			remoteAddr: utilTestLocalAddr,
			headers: map[string]string{
				headerRealIP: "2001:db8::1",
			},
			expected: "2001:db8::1",
		},
		{
			name: "Custom Header - Malformed IP falls back to RemoteAddr",
			setup: func() {
				remoteIPHeader = headerForwardedBy
			},
			remoteAddr: "4.4.4.4:9999",
			headers: map[string]string{
				headerForwardedBy: "not-an-ip",
			},
			expected: "4.4.4.4",
		},
		{
			name: "Custom Header - Missing falls back to RemoteAddr",
			setup: func() {
				remoteIPHeader = headerForwardedBy
			},
			remoteAddr: "4.4.4.4:9999",
			expected:   "4.4.4.4",
		},
		{
			name: "Custom Header - Case insensitive lookup",
			setup: func() {
				remoteIPHeader = "X-CUSTOM-IP"
			},
			remoteAddr: utilTestLocalAddr,
			headers: map[string]string{
				"X-Custom-IP": "5.5.5.5", // http.Header.Get is case-insensitive
			},
			expected: "5.5.5.5",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setup()
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tt.remoteAddr
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}

			got := GetClientIP(req)
			if got != tt.expected {
				t.Errorf("GetClientIP() = %v, want %v", got, tt.expected)
			}
		})
	}
}
