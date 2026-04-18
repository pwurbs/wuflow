package backend

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Length limits — kept in sync with the frontend character counters in
// modal.js / setup.js. All limits apply to plain-text codepoints.
const (
	MaxTitleLength        = 100
	MaxDescLength         = 5000
	MaxLabelNameLen       = 15
	MaxEmailLength        = 254
	MaxUserNameLength     = 50
	MaxPasswordLength     = 128
	MaxRefreshTokenLength = 512
	MaxAccessTokenLength  = 4096
	MaxProjectNameLen     = 15
	MaxProjectDescLen     = 100
	MaxStatusNameLen      = 15
)

// Validation errors
var (
	ErrInvalidTitle    = errors.New("title is required")
	ErrTitleTooLong    = errors.New("title must not exceed 100 characters")
	ErrDescTooLong     = errors.New("description must not exceed 5000 characters")
	ErrInvalidStatus   = errors.New("invalid status")
	ErrInvalidPriority = errors.New("invalid priority")

	ErrInvalidLabel     = errors.New("label name and color are required")
	ErrLabelNameTooLong = errors.New("label name must not exceed 15 characters")
	ErrColorInvalid     = errors.New("color must be a valid hex color (#RRGGBB)")

	ErrInvalidEmail    = errors.New("valid email is required")
	ErrEmailTooLong    = errors.New("email must not exceed 254 characters")
	ErrInvalidName     = errors.New("first name and last name are required")
	ErrUserNameTooLong = errors.New("first and last name must not exceed 50 characters")
	ErrInvalidRole     = errors.New("role must be 'admin', 'user', or 'sysadmin'")

	ErrPasswordTooShort  = errors.New("password must be at least 12 characters")
	ErrPasswordTooLong   = errors.New("password must not exceed 128 characters")
	ErrPasswordIsEmail   = errors.New("password must not be your email address")
	ErrPasswordBlacklist = errors.New("password is too common")

	ErrDateInvalid  = errors.New("date must be in YYYY-MM-DD format")
	ErrTooManyDates = errors.New("too many planned dates (maximum 100)")

	ErrInvalidProjectName = errors.New("project name is required")
	ErrProjectNameTooLong = errors.New("project name must not exceed 15 characters")
	ErrProjectDescTooLong = errors.New("project description must not exceed 100 characters")

	ErrStatusNameTooLong = errors.New("column name must not exceed 15 characters")
	ErrStatusNameInvalid = errors.New("column name must contain only letters and digits")
)

// Compiled regexes (package-level, compiled once).
var (
	// emailRegex is a basic check. Start/end anchors, one @, non-empty parts.
	// We allow minimal "user@domain" without enforcing a .TLD to support local/intranet use (e.g. admin@local).
	emailRegex      = regexp.MustCompile(`^[^\s@]+@[^\s@]+$`)
	colorRegex      = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	anyTagRegex     = regexp.MustCompile(`<[^>]+>`)
	statusNameRegex = regexp.MustCompile(`^[a-zA-Z0-9]*$`)
)

func isValidStatus(status IssueStatus) bool {
	switch status {
	case StatusOpen, StatusTodo, StatusStage1, StatusStage2, StatusStage3, StatusStage4, StatusDone, StatusArchive:
		return true
	}
	return false
}

func validateStatusConfig(cfg *StatusConfig) error {
	names := []*string{&cfg.Stage1Name, &cfg.Stage2Name, &cfg.Stage3Name, &cfg.Stage4Name}
	for _, name := range names {
		*name = strings.TrimSpace(*name)
		if *name == "" {
			continue // empty = column hidden, valid
		}
		if !statusNameRegex.MatchString(*name) {
			return ErrStatusNameInvalid
		}
		if utf8.RuneCountInString(*name) > MaxStatusNameLen {
			return ErrStatusNameTooLong
		}
	}
	return nil
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
	case RoleSysAdmin, RoleAdmin, RoleUser:
		return true
	}
	return false
}

func validateProject(p *Project) error {
	p.Name = strings.ReplaceAll(p.Name, "\x00", "")
	p.Name = strings.TrimSpace(p.Name)
	p.Name = anyTagRegex.ReplaceAllString(p.Name, "")
	p.Name = strings.ToLower(p.Name)
	if p.Name == "" {
		return ErrInvalidProjectName
	}
	if utf8.RuneCountInString(p.Name) > MaxProjectNameLen {
		return ErrProjectNameTooLong
	}
	p.Description = strings.ReplaceAll(p.Description, "\x00", "")
	p.Description = strings.TrimSpace(p.Description)
	p.Description = anyTagRegex.ReplaceAllString(p.Description, "")
	if utf8.RuneCountInString(p.Description) > MaxProjectDescLen {
		return ErrProjectDescTooLong
	}
	return nil
}

func validateIssue(i *Issue) error {
	i.Title = strings.ReplaceAll(i.Title, "\x00", "")
	i.Title = strings.TrimSpace(i.Title)
	i.Title = anyTagRegex.ReplaceAllString(i.Title, "")
	if i.Title == "" {
		return ErrInvalidTitle
	}
	if utf8.RuneCountInString(i.Title) > MaxTitleLength {
		return ErrTitleTooLong
	}
	// Description is plain Markdown text — count runes directly.
	// No HTML filtering: DOMPurify sanitises the rendered output on the frontend.
	i.Description = strings.ReplaceAll(i.Description, "\x00", "")
	i.Description = strings.TrimSpace(i.Description)
	if utf8.RuneCountInString(i.Description) > MaxDescLength {
		return ErrDescTooLong
	}

	if !isValidStatus(i.Status) {
		return ErrInvalidStatus
	}
	if i.Priority != "" && !isValidPriority(i.Priority) {
		return ErrInvalidPriority
	}
	if i.Position < 0 {
		return errors.New("position must be non-negative")
	}
	if i.Deadline != nil && (i.Deadline.Year() < 2000 || i.Deadline.Year() > 2100) {
		return errors.New("deadline year must be between 2000 and 2100")
	}
	// Validate planned dates format (each must be YYYY-MM-DD).
	if len(i.PlannedDates) > 100 {
		return ErrTooManyDates
	}
	for _, d := range i.PlannedDates {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return ErrDateInvalid
		}
	}
	return nil
}

func validateTask(t *Task) error {
	t.Title = strings.ReplaceAll(t.Title, "\x00", "")
	t.Title = strings.TrimSpace(t.Title)
	t.Title = anyTagRegex.ReplaceAllString(t.Title, "")
	if t.Title == "" {
		return ErrInvalidTitle
	}
	if utf8.RuneCountInString(t.Title) > MaxTitleLength {
		return ErrTitleTooLong
	}
	if t.Position < 0 {
		return errors.New("position must be non-negative")
	}
	if t.Deadline != nil && (t.Deadline.Year() < 2000 || t.Deadline.Year() > 2100) {
		return errors.New("deadline year must be between 2000 and 2100")
	}
	return nil
}

func validateLabel(l *Label) error {
	l.Name = strings.ReplaceAll(l.Name, "\x00", "")
	l.Name = strings.TrimSpace(l.Name)
	l.Name = anyTagRegex.ReplaceAllString(l.Name, "")
	l.Color = strings.TrimSpace(l.Color)
	if l.Name == "" || l.Color == "" {
		return ErrInvalidLabel
	}
	if utf8.RuneCountInString(l.Name) > MaxLabelNameLen {
		return ErrLabelNameTooLong
	}
	if !colorRegex.MatchString(l.Color) {
		return ErrColorInvalid
	}
	return nil
}

// validateUser validates user fields (not password).
func validateUser(u *User) error {
	u.Email = strings.TrimSpace(u.Email)
	u.FirstName = strings.ReplaceAll(u.FirstName, "\x00", "")
	u.FirstName = strings.TrimSpace(u.FirstName)
	u.FirstName = anyTagRegex.ReplaceAllString(u.FirstName, "")
	u.LastName = strings.ReplaceAll(u.LastName, "\x00", "")
	u.LastName = strings.TrimSpace(u.LastName)
	u.LastName = anyTagRegex.ReplaceAllString(u.LastName, "")

	if u.Email == "" || !emailRegex.MatchString(u.Email) {
		return ErrInvalidEmail
	}
	if len(u.Email) > MaxEmailLength {
		return ErrEmailTooLong
	}
	if u.FirstName == "" || u.LastName == "" {
		return ErrInvalidName
	}
	if utf8.RuneCountInString(u.FirstName) > MaxUserNameLength || utf8.RuneCountInString(u.LastName) > MaxUserNameLength {
		return ErrUserNameTooLong
	}
	if !isValidRole(u.Role) {
		return ErrInvalidRole
	}
	return nil
}

// ValidatePassword checks the password against the policy.
func ValidatePassword(password, email string) error {
	if utf8.RuneCountInString(password) < 12 {
		return ErrPasswordTooShort
	}
	if utf8.RuneCountInString(password) > MaxPasswordLength {
		return ErrPasswordTooLong
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
