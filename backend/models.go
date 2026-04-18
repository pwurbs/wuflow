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
	Creator      *User         `json:"creator,omitempty"`  // Populated for API responses to avoid N+1 queries
	Assignee     *User         `json:"assignee,omitempty"` // Populated for API responses to avoid N+1 queries
	Updater      *User         `json:"updater,omitempty"`  // Populated for API responses to avoid N+1 queries
	Label        *Label        `json:"label"`              // Pointer to manage nil label
	Project      *Project      `json:"project,omitempty"` // Populated for API responses
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

// User represents an authenticated user of the application.
type User struct {
	ID           int       `json:"id"`
	Email        string    `json:"email"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	PasswordHash string    `json:"-"` // never exposed via API
	Role         UserRole  `json:"role"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Session represents an active user session (refresh token).
type Session struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	TokenHash string    `json:"-"` // Hash of the refresh token secret
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}
