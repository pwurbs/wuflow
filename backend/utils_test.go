package backend

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

const (
	utilTestIP1       = "1.2.3.4"         //NOSONAR
	utilTestLocalAddr = "127.0.0.1:12345" //NOSONAR
	headerForwardedBy = "X-Forwarded-For"
	headerRealIP      = "X-Real-IP"
)

const (
	utilTestClient    = "198.51.100.10" //NOSONAR - documentation range (RFC 5737)
	utilTestForged    = "203.0.113.77"  //NOSONAR - documentation range (RFC 5737)
	utilTestPodIP     = "10.42.0.9"     //NOSONAR - private range
	utilTestPodAddr   = "10.42.0.5:443" //NOSONAR - private range
	utilTestUntrusted = "198.51.100.20" //NOSONAR - documentation range (RFC 5737)
)

func TestGetClientIP(t *testing.T) {
	origHeader, origProxies := remoteIPHeader, trustedProxies
	defer func() { remoteIPHeader, trustedProxies = origHeader, origProxies }()

	tests := []struct {
		name       string
		header     string // remoteIPHeader setting
		proxies    string // trusted proxies setting; empty = default
		remoteAddr string
		headers    map[string][]string // one slice element per header line
		expected   string
	}{
		{
			name:       "Default RemoteAddr (no port)",
			remoteAddr: utilTestIP1,
			expected:   utilTestIP1,
		},
		{
			name:       "Default RemoteAddr (with port)",
			remoteAddr: utilTestIP1 + ":12345",
			expected:   utilTestIP1,
		},
		{
			name:       "IPv6 RemoteAddr",
			remoteAddr: "[::1]:54321",
			expected:   "::1",
		},
		{
			name:       "Unparsable RemoteAddr is not a trusted proxy",
			header:     headerForwardedBy,
			remoteAddr: "@",
			headers:    map[string][]string{headerForwardedBy: {utilTestClient}},
			expected:   "@",
		},
		{
			name:       "No header configured ignores the header",
			remoteAddr: utilTestLocalAddr,
			headers:    map[string][]string{headerForwardedBy: {utilTestClient}},
			expected:   "127.0.0.1",
		},
		{
			name:       "Custom Header - IPv4",
			header:     headerRealIP,
			remoteAddr: utilTestLocalAddr,
			headers:    map[string][]string{headerRealIP: {"8.8.8.8"}},
			expected:   "8.8.8.8",
		},
		{
			name:       "Custom Header - IPv6",
			header:     headerRealIP,
			remoteAddr: utilTestLocalAddr,
			headers:    map[string][]string{headerRealIP: {"2001:db8::1"}},
			expected:   "2001:db8::1",
		},
		{
			name:       "Custom Header - Malformed IP falls back to RemoteAddr",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {"not-an-ip"}},
			expected:   "10.42.0.5",
		},
		{
			name:       "Custom Header - Missing falls back to RemoteAddr",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			expected:   "10.42.0.5",
		},
		{
			name:       "Custom Header - Case insensitive lookup",
			header:     "X-CUSTOM-IP",
			remoteAddr: utilTestLocalAddr,
			headers:    map[string][]string{"X-Custom-IP": {"5.5.5.5"}}, // http.Header lookup is case-insensitive
			expected:   "5.5.5.5",
		},
		{
			name:       "Forged first entry is ignored",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {utilTestForged + ", " + utilTestClient + ", " + utilTestPodIP}},
			expected:   utilTestClient,
		},
		{
			name:       "Direct untrusted peer cannot set the header",
			header:     headerForwardedBy,
			remoteAddr: utilTestUntrusted + ":5555",
			headers:    map[string][]string{headerForwardedBy: {utilTestForged}},
			expected:   utilTestUntrusted,
		},
		{
			name:       "Multiple header lines form one list",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {utilTestForged, utilTestClient + ", " + utilTestPodIP}},
			expected:   utilTestClient,
		},
		{
			name:       "All entries trusted returns the leftmost",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {"192.168.1.50, " + utilTestPodIP}},
			expected:   "192.168.1.50",
		},
		{
			name:       "Invalid entry right of the client falls back to RemoteAddr",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {utilTestClient + ", garbage"}},
			expected:   "10.42.0.5",
		},
		{
			name:       "Invalid entry left of the client is ignored",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {"garbage, " + utilTestClient}},
			expected:   utilTestClient,
		},
		{
			name:       "Trailing comma falls back to RemoteAddr",
			header:     headerForwardedBy,
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{headerForwardedBy: {utilTestClient + ","}},
			expected:   "10.42.0.5",
		},
		{
			name:       "IPv6 peer and client",
			header:     headerForwardedBy,
			remoteAddr: "[::1]:54321",
			headers:    map[string][]string{headerForwardedBy: {"2001:db8::7, fd00::1"}},
			expected:   "2001:db8::7",
		},
		{
			name:       "IPv4-mapped IPv6 peer is trusted",
			header:     headerForwardedBy,
			remoteAddr: "[::ffff:10.0.0.1]:443",
			headers:    map[string][]string{headerForwardedBy: {utilTestClient}},
			expected:   utilTestClient,
		},
		{
			name:       "Client IP is normalized",
			header:     headerForwardedBy,
			remoteAddr: utilTestLocalAddr,
			headers:    map[string][]string{headerForwardedBy: {"2001:DB8::0:1"}},
			expected:   "2001:db8::1",
		},
		{
			name:       "CF-Connecting-IP single value",
			header:     "CF-Connecting-IP",
			remoteAddr: utilTestPodAddr,
			headers:    map[string][]string{"CF-Connecting-IP": {utilTestClient}, headerForwardedBy: {utilTestForged}},
			expected:   utilTestClient,
		},
		{
			name:       "Custom trusted list excludes other private peers",
			header:     headerForwardedBy,
			proxies:    "10.0.0.1",
			remoteAddr: "192.168.1.1:443",
			headers:    map[string][]string{headerForwardedBy: {utilTestClient}},
			expected:   "192.168.1.1",
		},
		{
			name:       "Custom trusted list includes its proxy",
			header:     headerForwardedBy,
			proxies:    "10.0.0.1",
			remoteAddr: "10.0.0.1:443",
			headers:    map[string][]string{headerForwardedBy: {utilTestClient}},
			expected:   utilTestClient,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			remoteIPHeader = tt.header
			trustedProxies = testTrustedProxies(t, tt.proxies)
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tt.remoteAddr
			addHeaderLines(req.Header, tt.headers)

			got := GetClientIP(req)
			if got != tt.expected {
				t.Errorf("GetClientIP() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// The warning for an invalid header entry logs only that entry, shortened,
// not the whole client-controlled header.
func TestGetClientIPLogsShortenedInvalidEntry(t *testing.T) {
	origHeader, origProxies := remoteIPHeader, trustedProxies
	defer func() { remoteIPHeader, trustedProxies = origHeader, origProxies }()
	remoteIPHeader, trustedProxies = headerForwardedBy, defaultTrustedProxies
	buf, restore := captureLogs(t)
	defer restore()

	invalid := strings.Repeat("x", 1000)
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = utilTestPodAddr
	req.Header.Set(headerForwardedBy, utilTestForged+", "+invalid+", "+utilTestPodIP)

	if got := GetClientIP(req); got != "10.42.0.5" {
		t.Errorf("GetClientIP() = %v, want the peer 10.42.0.5", got)
	}
	logged := buf.String()
	want := `"entry":"` + invalid[:maxLoggedHeaderEntry] + `…"`
	if !strings.Contains(logged, want) || strings.Contains(logged, invalid[:maxLoggedHeaderEntry+1]) ||
		strings.Contains(logged, utilTestForged) {
		t.Errorf("expected only the shortened invalid entry in the log, got %q", logged)
	}
}

// testTrustedProxies parses s; an empty s yields the default list.
func testTrustedProxies(t *testing.T, s string) []netip.Prefix {
	t.Helper()
	proxies, err := parseTrustedProxies(s)
	if err != nil {
		t.Fatalf("parseTrustedProxies(%q): %v", s, err)
	}
	return proxies
}

// addHeaderLines adds each value as a separate header line.
func addHeaderLines(h http.Header, headers map[string][]string) {
	for k, lines := range headers {
		for _, v := range lines {
			h.Add(k, v)
		}
	}
}

func TestParseTrustedProxies(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string // fmt of the parsed prefixes
		wantErr bool
	}{
		{"Default list", "127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7",
			"[127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 ::1/128 fc00::/7]", false},
		{"Bare IPv4 and IPv6", "10.0.0.1,2001:db8::1", "[10.0.0.1/32 2001:db8::1/128]", false},
		{"IPv4-mapped IPv6 is unmapped", "::ffff:10.0.0.1", "[10.0.0.1/32]", false},
		{"Spaces and trailing comma", "  10.42.0.0/16 , ", "[10.42.0.0/16]", false},
		{"Host bits are masked", "10.1.2.3/8", "[10.0.0.0/8]", false},
		{"Only empty elements yield the default", " , ", fmt.Sprint(defaultTrustedProxies), false},
		{"Invalid entry", "10.0.0.0/8, proxy.local", "", true},
		{"Invalid prefix length", "10.0.0.0/33", "", true},
		{"Zoned IPv6", "fe80::1%eth0", "", true},
		{"IPv4-mapped CIDR is rejected", "::ffff:10.0.0.0/104", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseTrustedProxies(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseTrustedProxies(%q) = %v, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseTrustedProxies(%q): %v", tt.input, err)
			}
			if fmt.Sprint(got) != tt.want {
				t.Errorf("parseTrustedProxies(%q) = %v, want %s", tt.input, got, tt.want)
			}
		})
	}
}

// TestSetLogLevelAndHelpers exercises SetLogLevel and the LogDebug helper,
// which are otherwise only hit by StartServer (and so go uncovered in tests).
func TestSetLogLevelAndHelpers(t *testing.T) {
	orig := safeLogger
	defer func() { safeLogger = orig }()

	SetLogLevel(slog.LevelDebug)
	if safeLogger == nil {
		t.Fatal("SetLogLevel left safeLogger nil")
	}
	// Must not panic.
	LogDebug("debug message", "k", "v")
}

// GetAllActiveIssues is a test helper that fetches all non-archived issues
// across all projects. Production code uses GetActiveIssuesByProject instead.
func GetAllActiveIssues() ([]Issue, error) {
	rows, err := DB.Query(issueSelectBase+` WHERE i.status != ? ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetAllActiveIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssueRow(rows)
		if err != nil {
			slog.Error("Database Error: GetAllActiveIssues Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllActiveIssues Rows", "error", err)
		return nil, err
	}

	tasksByIssue, err := getTasksForIssues(context.Background(), issues)
	if err != nil {
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}

// GetAllArchivedIssues is a test helper that fetches all archived issues
// across all projects. Production code uses GetArchivedIssuesByProject instead.
func GetAllArchivedIssues() ([]Issue, error) {
	rows, err := DB.Query(issueSelectBase+` WHERE i.status = ? ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetAllArchivedIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssueRow(rows)
		if err != nil {
			slog.Error("Database Error: GetAllArchivedIssues Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllArchivedIssues Rows", "error", err)
		return nil, err
	}

	tasksByIssue, err := getTasksForIssues(context.Background(), issues)
	if err != nil {
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}
