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
	// StatusPending represents an issue that is pending.
	StatusPending IssueStatus = "Pending"
	// StatusWorking represents an issue that is currently being worked on.
	StatusWorking IssueStatus = "Working"
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
	Label        *Label        `json:"label"` // Pointer to manage nil label
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
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// UserRole represents a user's role in the system.
type UserRole string

const (
	// RoleAdmin grants full access including user management.
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
