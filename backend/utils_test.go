package backend

import (
	"log/slog"
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

// GetAllActiveIssues is a test helper that fetches all non-archived issues
// across all projects. Production code uses GetActiveIssuesByProject instead.
func GetAllActiveIssues() ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       i.release_id,
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description,
		       r.id, r.name, r.status
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		LEFT JOIN releases r ON i.release_id = r.id
		WHERE i.status != ?
		ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetAllActiveIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
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

	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetAllActiveIssues GetAllTasks", "error", err)
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
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       i.release_id,
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description,
		       r.id, r.name, r.status
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		LEFT JOIN releases r ON i.release_id = r.id
		WHERE i.status = ?
		ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetAllArchivedIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
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

	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetAllArchivedIssues GetAllTasks", "error", err)
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}
