package backend

import (
	"errors"
	"strings"
)

// Validation errors
var (
	ErrInvalidTitle      = errors.New("title is required")
	ErrInvalidStatus     = errors.New("invalid status")
	ErrInvalidPriority   = errors.New("invalid priority")
	ErrInvalidLabel      = errors.New("label name and color are required")
	ErrInvalidEmail      = errors.New("valid email is required")
	ErrInvalidName       = errors.New("first name and last name are required")
	ErrInvalidRole       = errors.New("role must be 'admin' or 'user'")
	ErrPasswordTooShort  = errors.New("password must be at least 12 characters")
	ErrPasswordIsEmail   = errors.New("password must not be your email address")
	ErrPasswordBlacklist = errors.New("password is too common")
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

func isValidRole(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleUser:
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

// validateUser validates user fields (not password).
func validateUser(u *User) error {
	email := strings.TrimSpace(u.Email)
	if email == "" || !strings.Contains(email, "@") {
		return ErrInvalidEmail
	}
	if strings.TrimSpace(u.FirstName) == "" || strings.TrimSpace(u.LastName) == "" {
		return ErrInvalidName
	}
	if !isValidRole(u.Role) {
		return ErrInvalidRole
	}
	return nil
}

// ValidatePassword checks the password against the policy.
func ValidatePassword(password, email string) error {
	if len(password) < 12 {
		return ErrPasswordTooShort
	}
	if strings.EqualFold(password, email) {
		return ErrPasswordIsEmail
	}
	if isBlacklistedPassword(password) {
		return ErrPasswordBlacklist
	}
	return nil
}

func isBlacklistedPassword(pw string) bool {
	// 1. Normalize: lowercase
	normalized := strings.ToLower(pw)

	// 2. Normalize: common leetspeak substitutions
	replacer := strings.NewReplacer(
		"0", "o",
		"1", "i",
		"3", "e",
		"4", "a",
		"5", "s",
		"@", "a",
		"$", "s",
		"!", "i",
	)
	normalized = replacer.Replace(normalized)

	for _, blocked := range passwordBlacklist {
		// Only check containment if the blocked word is significant (>= 4 chars)
		// Or exact match for short ones (though our list has mostly longer ones)
		if len(blocked) >= 4 {
			if strings.Contains(normalized, blocked) {
				return true
			}
		} else {
			if normalized == blocked {
				return true
			}
		}
	}
	return false
}

// passwordBlacklist contains common passwords that are not allowed.
// We use base words here, the check handles containment and leetspeak.
var passwordBlacklist = []string{
	"password", "qwerty", "admin", "welcome", "login",
	"manager", "master", "dragon", "baseball", "football",
	"shadow", "sunshine", "freedom", "charlie", "iloveyou",
	"princess", "monkey", "donald", "michael",
	"123456", "111111", "000000", "abcdef",
	// German specific
	"passwort", "geheim", "hallo", "willkommen",
	"sommer", "winter", "herbst", "fruehling",
	"schatz", "liebe", "sonne", "mond", "sterne",
	"qwertz", "asdfgh", "yxcvbn", // DE layout patterns
	"fussball", "musik", "schule", "arbeit",
}
