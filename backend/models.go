package backend

import (
	"time"
)

type IssueStatus string

const (
	StatusOpen    IssueStatus = "Open"
	StatusTodo    IssueStatus = "Todo"
	StatusPending IssueStatus = "Pending"
	StatusWorking IssueStatus = "Working"
	StatusDone    IssueStatus = "Done"
)

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
