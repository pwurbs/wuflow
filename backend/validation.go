package backend

import (
	"errors"
	"html"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Length limits — kept in sync with the frontend character counters in
// modal.js / setup.js. MaxDescLength counts visible text codepoints (HTML tags
// excluded); all other limits apply to plain-text codepoints.
const (
	MaxTitleLength    = 100
	MaxDescLength     = 5000
	MaxLabelNameLen   = 15
	MaxEmailLength    = 254
	MaxUserNameLength = 50
	MaxPasswordLength = 128
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
	ErrInvalidRole     = errors.New("role must be 'admin' or 'user'")

	ErrPasswordTooShort  = errors.New("password must be at least 12 characters")
	ErrPasswordTooLong   = errors.New("password must not exceed 128 characters")
	ErrPasswordIsEmail   = errors.New("password must not be your email address")
	ErrPasswordBlacklist = errors.New("password is too common")

	ErrDateInvalid    = errors.New("date must be in YYYY-MM-DD format")
	ErrTooManyDates   = errors.New("too many planned dates (maximum 100)")
)

// AllowedHTMLTags is the source of truth for safe HTML tags in descriptions.
// Reverting these to lower-case as sanitizeHTML and the fuzzer handle case.
var AllowedHTMLTags = []string{"b", "i", "u", "ul", "ol", "li", "p", "br", "a"}

// Compiled regexes (package-level, compiled once).
var (
	// emailRegex is a basic check. Start/end anchors, one @, non-empty parts.
	// We allow minimal "user@domain" without enforcing a .TLD to support local/intranet use (e.g. admin@local).
	emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+$`)
	colorRegex = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

	// allowedAllTagRegex matches safe formatting tags AND safe anchors (rebuilt by sanitizeHTML).
	// It is used to sentinel-replace safe tags before stripping unknown ones.
	// We build this dynamically from AllowedHTMLTags (excluding 'a' which has special regex).
	allowedAllTagRegex = buildAllowedTagRegex()
	anchorTagRegex     = regexp.MustCompile(`(?i)<a\s[^>]*href="([^"]*)"[^>]*>`)
	closeAnchorRegex   = regexp.MustCompile(`(?i)</a\s*>`)
	anyTagRegex        = regexp.MustCompile(`<[^>]+>`)
	// partialTagRegex strips incomplete tag fragments left after sentineling, e.g.
	// "<1 " in "<1 <B>" once <B> is sentineled and its ">" is no longer available
	// to close the preceding fragment. Stops at \x00 (sentinel start) and > so it
	// never consumes sentineled safe-tag placeholders.
	partialTagRegex = regexp.MustCompile(`<[^ \t\n\r\f\x00>][^\x00>]*`)
	// openDivRegex / closeDivRegex normalise Chrome's contenteditable <div>
	// paragraph separators to <p> so line breaks survive sanitisation.
	openDivRegex    = regexp.MustCompile(`(?i)<div[^>]*>`)
	closeDivRegex   = regexp.MustCompile(`(?i)</div\s*>`)
	unsafeHrefRegex = regexp.MustCompile(`(?i)^\s*(javascript|data):`)
	// sentinelRegex matches the two-rune sentinel sequences emitted by sanitizeHTML:
	// NUL byte followed by a Unicode private-use codepoint (U+E000–U+F8FF).
	sentinelRegex = regexp.MustCompile("\x00[\uE000-\uF8FF]")
)

// buildAllowedTagRegex constructs the regex for identifying safe tags from AllowedHTMLTags.
func buildAllowedTagRegex() *regexp.Regexp {
	// formatting tags: (b|i|u|ul|ol|li|p|br)
	var formatting []string
	for _, t := range AllowedHTMLTags {
		if t != "a" {
			formatting = append(formatting, t)
		}
	}
	f := strings.Join(formatting, "|")
	// Matches: <tag>, <tag/>, </tag>, or the rebuilt <a> tag.
	pattern := `(?i)<(` + f + `)\s*/?>|</?(` + f + `)\s*>|<a href="[^"]*" target="_blank" rel="noopener noreferrer">|</a>`
	return regexp.MustCompile(pattern)
}

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

// sanitizeHTML strips disallowed or dangerous HTML from description content.
// It preserves safe formatting tags (b, i, u, ul, ol, li, p, br) and safe
// anchor tags (href only, no javascript: URIs). All other tags and event
// attributes are removed.
//
// Algorithm:
//  1. Rebuild any <a href="..."> tags sanitised (remove event attrs, drop javascript: hrefs).
//  2. Normalise </a> closing tags.
//  3. Sentinel-replace ALL safe tags (including the freshly rebuilt anchors).
//  4. Strip every remaining <...> sequence (these are dangerous/unknown tags).
//  5. Restore sentinels to original safe tag text.
func sanitizeHTML(raw string) string {
	// Strip NUL bytes before any other processing. The sentinel mechanism uses
	// \x00 as the first byte of a two-rune sentinel pair; user-supplied \x00
	// followed by a Unicode private-use codepoint could otherwise be
	// misinterpreted during restoration (step 5), causing data corruption.
	raw = strings.ReplaceAll(raw, "\x00", "")

	// Step 0 — normalise <div> → <p>: Chrome's contenteditable uses <div> for
	// Enter by default; converting them preserves paragraph breaks after save.
	raw = openDivRegex.ReplaceAllString(raw, "<p>")
	raw = closeDivRegex.ReplaceAllString(raw, "</p>")

	// Step 1 — rebuild <a href="..."> stripping all attributes except href.
	result := anchorTagRegex.ReplaceAllStringFunc(raw, func(match string) string {
		sub := anchorTagRegex.FindStringSubmatch(match)
		if len(sub) < 2 {
			return ""
		}
		href := sub[1]
		if unsafeHrefRegex.MatchString(href) {
			return "" // drop unsafe links entirely
		}
		return `<a href="` + html.EscapeString(href) + `" target="_blank" rel="noopener noreferrer">`
	})

	// Step 2 — normalise </a>.
	result = closeAnchorRegex.ReplaceAllString(result, "</a>")

	// Step 3 — sentinel-replace ALL safe tags (formatting + rebuilt anchors).
	// allowedAllTagRegex also matches <a href="..."> and </a> produced above.
	var safeMatches []string
	result = allowedAllTagRegex.ReplaceAllStringFunc(result, func(m string) string {
		idx := len(safeMatches)
		safeMatches = append(safeMatches, m)
		return "\x00" + string(rune(idx+0xE000))
	})

	// Step 4 — strip any remaining complete HTML tags (dangerous ones).
	result = anyTagRegex.ReplaceAllString(result, "")

	// Step 4b — strip incomplete tag fragments that have no closing ">".
	// These arise when a safe tag's ">" was the only ">" closing a preceding
	// unknown tag, e.g. "<1 <B>" → after sentineling → "<1 \x00…" with no ">"
	// left for anyTagRegex to match. partialTagRegex stops at \x00 so it never
	// reaches into sentinel placeholders.
	result = partialTagRegex.ReplaceAllString(result, "")

	// Step 5 — restore sentinels.
	result = sentinelRegex.ReplaceAllStringFunc(result, func(m string) string {
		runes := []rune(m)
		idx := int(runes[1]) - 0xE000
		if idx >= 0 && idx < len(safeMatches) {
			return safeMatches[idx]
		}
		return ""
	})

	return result
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
	// Count visible text codepoints: strip HTML tags, then decode entities
	// (e.g. &lt; → <) to match what the browser's textContent counter shows.
	descText := html.UnescapeString(anyTagRegex.ReplaceAllString(i.Description, ""))
	if utf8.RuneCountInString(descText) > MaxDescLength {
		return ErrDescTooLong
	}
	i.Description = sanitizeHTML(i.Description)

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
