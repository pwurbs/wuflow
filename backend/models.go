// Package backend provides the core logic and data structures for the wuTrak application.
package backend

import (
	"time"
)

// IssueStatus represents the status of an issue.
type IssueStatus string

const (
	// StatusOpen represents an issue that is open but not yet started.
	StatusOpen IssueStatus = "Open"
	// StatusTodo represents an issue that is in the Todo state.
	StatusTodo IssueStatus = "Todo"
	// StatusPending represents an issue that is pending.
	StatusPending IssueStatus = "Pending"
	// StatusWorking represents an issue that is currently being worked on.
	StatusWorking IssueStatus = "Working"
	// StatusDone represents an issue that is completed.
	StatusDone IssueStatus = "Done"
)

// Issue represents a task or bug to be tracked.
type Issue struct {
	ID          int         `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Status      IssueStatus `json:"status"`
	Position    int         `json:"position"` // For manual sorting within a column
	Deadline    *time.Time  `json:"deadline"`
	PlannedDate *time.Time  `json:"planned_date"`
	Tasks       []Task      `json:"tasks"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
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
