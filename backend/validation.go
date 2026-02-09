package backend

import (
	"errors"
	"strings"
)

// Validation errors
var (
	ErrInvalidTitle    = errors.New("title is required")
	ErrInvalidStatus   = errors.New("invalid status")
	ErrInvalidPriority = errors.New("invalid priority")
	ErrInvalidLabel    = errors.New("label name and color are required")
)

func isValidStatus(status IssueStatus) bool {
	switch status {
	case StatusOpen, StatusTodo, StatusPending, StatusWorking, StatusDone, StatusArchive:
		return true
	}
	return false
}

func isValidPriority(priority IssuePriority) bool {
	switch priority {
	case PriorityNormal, PriorityHigh:
		return true
	}
	return false
}

func validateIssue(i *Issue) error {
	if strings.TrimSpace(i.Title) == "" {
		return ErrInvalidTitle
	}
	if !isValidStatus(i.Status) {
		return ErrInvalidStatus
	}
	if i.Priority != "" && !isValidPriority(i.Priority) {
		return ErrInvalidPriority
	}
	return nil
}

func validateTask(t *Task) error {
	if strings.TrimSpace(t.Title) == "" {
		return ErrInvalidTitle
	}
	return nil
}

func validateLabel(l *Label) error {
	if strings.TrimSpace(l.Name) == "" || strings.TrimSpace(l.Color) == "" {
		return ErrInvalidLabel
	}
	return nil
}
