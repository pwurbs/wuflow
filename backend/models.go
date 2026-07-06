// Package backend provides the core logic and data structures for the wuFlow application.
package backend

import (
	"time"
)

// IssueStatus represents the status of an issue.
type IssueStatus string

const (
	// StatusOpen represents an issue that is open but not yet started.
	StatusOpen IssueStatus = "Open"
	// StatusTodo represents an issue that is in the "To Do" state.
	StatusTodo IssueStatus = "Todo"
	// StatusStage1 through StatusStage4 represent configurable intermediate stages.
	StatusStage1 IssueStatus = "Stage1"
	StatusStage2 IssueStatus = "Stage2"
	StatusStage3 IssueStatus = "Stage3"
	StatusStage4 IssueStatus = "Stage4"
	// StatusDone represents an issue that is completed.
	StatusDone IssueStatus = "Done"
	// StatusArchive represents an issue that is archived.
	StatusArchive IssueStatus = "Archive"
)

// IssuePriority represents the priority of an issue.
type IssuePriority string

const (
	// PriorityNormal represents a normal priority issue.
	PriorityNormal IssuePriority = "Normal"
	// PriorityHigh represents a high priority issue.
	PriorityHigh IssuePriority = "High"
)

// Issue represents a task or bug to be tracked.
type Issue struct {
	ID           int           `json:"id"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	Status       IssueStatus   `json:"status"`
	Position     int           `json:"position"` // For manual sorting within a column
	Deadline     *time.Time    `json:"deadline"`
	PlannedDates []string      `json:"planned_dates"` // Stored as JSON array in DB
	Priority     IssuePriority `json:"priority"`
	CreatorID    int           `json:"creator_id"`
	AssigneeID   *int          `json:"assignee_id"`        // Pointer to allow null (unassigned)
	UpdaterID    *int          `json:"updated_by"`         // Pointer to allow null (if user deleted)
	ProjectID    int           `json:"project_id"`         // Every issue belongs to a project
	ReleaseID    *int          `json:"release_id"`         // Pointer to allow null (no release)
	Assignee     *User         `json:"assignee,omitempty"` // Populated for API responses to avoid N+1 queries
	Label        *Label        `json:"label"`              // Pointer to manage nil label
	Release      *Release      `json:"release"`            // Pointer to manage nil release
	Project      *Project      `json:"project,omitempty"`  // Populated for API responses
	Tasks        []Task        `json:"tasks"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`
}

// Task represents a sub-task associated with an issue.
type Task struct {
	ID        int        `json:"id"`
	IssueID   int        `json:"issue_id"`
	Title     string     `json:"title"`
	Done      bool       `json:"done"`
	Position  int        `json:"position"` // For manual sorting
	Deadline  *time.Time `json:"deadline"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// History event kinds recorded in the issue_history table.
const (
	// EventCreated is recorded when an issue is created.
	EventCreated = "created"
	// EventUpdated is recorded once per changed field when an issue is edited.
	EventUpdated = "updated"
	// EventArchived is recorded when an issue is archived.
	EventArchived = "archived"
	// EventUnarchived is recorded when an issue is unarchived.
	EventUnarchived = "unarchived"
	// EventMoved is recorded when an issue is moved to another project.
	EventMoved = "moved"
	// EventTask is recorded for task add/complete/rename/delete changes.
	EventTask = "task"
)

// ChangeData is the event-specific JSON payload stored in issue_history.data.
// Fields use omitempty so each event carries only what it needs. from/to values
// are human-readable and captured at write time so history stays stable even if
// the referenced entity is later renamed or deleted.
type ChangeData struct {
	Field  string `json:"field,omitempty"`
	From   string `json:"from,omitempty"`
	To     string `json:"to,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// HistoryEntry is one immutable, system-generated audit-trail record for an issue.
type HistoryEntry struct {
	ID        int        `json:"id"`
	IssueID   int        `json:"issue_id"`
	UserID    *int       `json:"user_id"`        // actor; nil if the user was deleted
	User      *User      `json:"user,omitempty"` // hydrated for API responses
	Event     string     `json:"event"`          // see Event* constants
	Data      ChangeData `json:"data"`           // event-specific payload
	CreatedAt time.Time  `json:"created_at"`
}

// Comment is a user-authored markdown note on an issue.
type Comment struct {
	ID        int       `json:"id"`
	IssueID   int       `json:"issue_id"`
	UserID    *int      `json:"user_id"`        // author; nil if the user was deleted
	User      *User     `json:"user,omitempty"` // hydrated for API responses
	Body      string    `json:"body"`           // raw markdown
	Edited    bool      `json:"edited"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Label represents a tag that can be assigned to an issue.
type Label struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	ProjectID int    `json:"project_id"`
}

// Project represents a grouping for issues.
type Project struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ReleaseStatus represents the status of a release.
type ReleaseStatus string

const (
	// ReleaseStatusOpen represents a release that is not yet closed.
	ReleaseStatusOpen ReleaseStatus = "open"
	// ReleaseStatusClosed represents a closed release.
	ReleaseStatusClosed ReleaseStatus = "closed"
)

// Release represents a versioned milestone grouping issues.
type Release struct {
	ID          int           `json:"id"`
	ProjectID   int           `json:"project_id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	StartDate   *time.Time    `json:"start_date"`
	ReleaseDate *time.Time    `json:"release_date"`
	ClosedAt    *time.Time    `json:"closed_at"`
	Status      ReleaseStatus `json:"status"`
	OwnerID     *int          `json:"owner_id"`
	Owner       *User         `json:"owner,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// StatusConfig holds the per-project display names for the four configurable board stage columns.
// An empty name means that stage column is hidden on the board.
type StatusConfig struct {
	ProjectID  int    `json:"project_id"`
	Stage1Name string `json:"stage1_name"` // default "Pending"
	Stage2Name string `json:"stage2_name"` // default "Working"
	Stage3Name string `json:"stage3_name"` // default "" (hidden)
	Stage4Name string `json:"stage4_name"` // default "" (hidden)
}

// UserRole represents a user's role in the system.
type UserRole string

const (
	// RoleSysAdmin grants full system administration access: user, project, and label management,
	// plus all permissions held by RoleAdmin and RoleUser.
	RoleSysAdmin UserRole = "sysadmin"
	// RoleAdmin grants elevated access including issue delete, archive, and unarchive.
	RoleAdmin UserRole = "admin"
	// RoleUser grants standard access to the application.
	RoleUser UserRole = "user"
)

// roleRank returns a numeric rank for a role so promotions can be detected by comparing ranks.
func roleRank(r UserRole) int {
	switch r {
	case RoleUser:
		return 0
	case RoleAdmin:
		return 1
	case RoleSysAdmin:
		return 2
	default:
		return -1
	}
}

// User represents an authenticated user of the application.
type User struct {
	ID           int        `json:"id"`
	Email        string     `json:"email"`
	FirstName    string     `json:"first_name"`
	LastName     string     `json:"last_name"`
	PasswordHash string     `json:"-"` // never exposed via API
	Role         UserRole   `json:"role"`
	Active       bool       `json:"active"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	LastLogin    *time.Time `json:"last_login"`
}

// Session represents an active user session (refresh token).
type Session struct {
	ID           int       `json:"id"`
	UserID       int       `json:"user_id"`
	SessionToken string    `json:"-"` // Unguessable random lookup key embedded in the client token
	TokenHash    string    `json:"-"` // HMAC-SHA256 digest of the refresh token secret
	ExpiresAt    time.Time `json:"expires_at"`
	CreatedAt    time.Time `json:"created_at"`
}
