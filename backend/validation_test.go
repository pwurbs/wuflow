package backend

import (
	"strings"
	"testing"
	"time"
)

const (
	testValidColor  = "#FF0000"
	testValidEmail  = "user@example.com"
	testSimpleEmail = "a@b.com"
	errUnexpected   = "unexpected error: %v"
)

// ---------------------------------------------------------------------------
// validateIssue
// ---------------------------------------------------------------------------

func TestValidateIssueEmptyTitle(t *testing.T) {
	i := &Issue{Title: "", Status: StatusOpen}
	if err := validateIssue(i); err != ErrInvalidTitle {
		t.Errorf("expected ErrInvalidTitle, got %v", err)
	}
}

func TestValidateIssueTitleExactlyMax(t *testing.T) {
	i := &Issue{Title: strings.Repeat("A", MaxTitleLength), Status: StatusOpen}
	if err := validateIssue(i); err != nil {
		t.Errorf("expected no error for title at max length, got %v", err)
	}
}

func TestValidateIssueTitleTooLong(t *testing.T) {
	i := &Issue{Title: strings.Repeat("A", MaxTitleLength+1), Status: StatusOpen}
	if err := validateIssue(i); err != ErrTitleTooLong {
		t.Errorf("expected ErrTitleTooLong, got %v", err)
	}
}

func TestValidateIssueDescriptionExactlyMax(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, Description: strings.Repeat("x", MaxDescLength)}
	if err := validateIssue(i); err != nil {
		t.Errorf("expected no error for description at max length, got %v", err)
	}
}

func TestValidateIssueDescriptionTooLong(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, Description: strings.Repeat("x", MaxDescLength+1)}
	if err := validateIssue(i); err != ErrDescTooLong {
		t.Errorf("expected ErrDescTooLong, got %v", err)
	}
}

func TestValidateIssueDescriptionHTMLAccepted(t *testing.T) {
	// HTML in descriptions is allowed — DOMPurify sanitises rendered output on the frontend.
	cases := []string{
		"<b>bold</b>",
		"<script>alert(1)</script>",
		"Price < 100 & tax > 0",
		"Use <br> for line breaks",
	}
	for _, desc := range cases {
		i := &Issue{Title: "T", Status: StatusOpen, Description: desc}
		if err := validateIssue(i); err != nil {
			t.Errorf("description %q should be accepted, got: %v", desc, err)
		}
	}
}

func TestValidateIssueDescriptionMarkdownAccepted(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, Description: "**bold** and *italic*\n\n- item"}
	if err := validateIssue(i); err != nil {
		t.Errorf("expected no error for valid Markdown description, got %v", err)
	}
}

func TestValidateIssueDescriptionTrimmed(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, Description: "  hello  "}
	if err := validateIssue(i); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if i.Description != "hello" {
		t.Errorf("expected trimmed description 'hello', got '%s'", i.Description)
	}
}

func TestValidateIssueInvalidStatus(t *testing.T) {
	i := &Issue{Title: "T", Status: "Unknown"}
	if err := validateIssue(i); err != ErrInvalidStatus {
		t.Errorf("expected ErrInvalidStatus, got %v", err)
	}
}

func TestValidateIssueInvalidPriority(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, Priority: "Critical"}
	if err := validateIssue(i); err != ErrInvalidPriority {
		t.Errorf("expected ErrInvalidPriority, got %v", err)
	}
}

func TestValidateIssueValidPlannedDates(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, PlannedDates: []string{"2026-01-15", "2026-02-28"}}
	if err := validateIssue(i); err != nil {
		t.Errorf("expected no error for valid dates, got %v", err)
	}
}

func TestValidateIssueInvalidPlannedDate(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, PlannedDates: []string{"2026-13-01"}}
	if err := validateIssue(i); err != ErrDateInvalid {
		t.Errorf("expected ErrDateInvalid, got %v", err)
	}
}

func TestValidateIssuePlannedDateWrongFormat(t *testing.T) {
	i := &Issue{Title: "T", Status: StatusOpen, PlannedDates: []string{"01/15/2026"}}
	if err := validateIssue(i); err != ErrDateInvalid {
		t.Errorf("expected ErrDateInvalid, got %v", err)
	}
}

func TestValidateIssueTitleTrimmed(t *testing.T) {
	i := &Issue{Title: "  hello  ", Status: StatusOpen}
	if err := validateIssue(i); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if i.Title != "hello" {
		t.Errorf("expected trimmed title 'hello', got '%s'", i.Title)
	}
}

func TestValidateIssueAllValidStatuses(t *testing.T) {
	for _, s := range []IssueStatus{StatusOpen, StatusTodo, StatusStage1, StatusStage2, StatusStage3, StatusStage4, StatusDone, StatusArchive} {
		i := &Issue{Title: "T", Status: s}
		if err := validateIssue(i); err != nil {
			t.Errorf("expected no error for status %q, got %v", s, err)
		}
	}
}

func TestValidateIssueTitleStripsHTML(t *testing.T) {
	i := &Issue{Title: "<b>Title</b> with <script>tags</script>", Status: StatusOpen}
	if err := validateIssue(i); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if i.Title != "Title with tags" {
		t.Errorf("expected HTML stripped title 'Title with tags', got '%s'", i.Title)
	}
}

// ---------------------------------------------------------------------------
// validateTask
// ---------------------------------------------------------------------------

func TestValidateTaskEmptyTitle(t *testing.T) {
	task := &Task{IssueID: 1, Title: ""}
	if err := validateTask(task); err != ErrInvalidTitle {
		t.Errorf("expected ErrInvalidTitle, got %v", err)
	}
}

func TestValidateTaskTitleExactlyMax(t *testing.T) {
	task := &Task{IssueID: 1, Title: strings.Repeat("B", MaxTitleLength)}
	if err := validateTask(task); err != nil {
		t.Errorf("expected no error for task title at max length, got %v", err)
	}
}

func TestValidateTaskTitleTooLong(t *testing.T) {
	task := &Task{IssueID: 1, Title: strings.Repeat("B", MaxTitleLength+1)}
	if err := validateTask(task); err != ErrTitleTooLong {
		t.Errorf("expected ErrTitleTooLong, got %v", err)
	}
}

func TestValidateTaskTitleStripsHTML(t *testing.T) {
	task := &Task{IssueID: 1, Title: "<i>Task</i> <br>Title"}
	if err := validateTask(task); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if task.Title != "Task Title" {
		t.Errorf("expected HTML stripped title 'Task Title', got '%s'", task.Title)
	}
}

// ---------------------------------------------------------------------------
// validateLabel
// ---------------------------------------------------------------------------

func TestValidateLabelEmptyName(t *testing.T) {
	l := &Label{Name: "", Color: testValidColor}
	if err := validateLabel(l); err != ErrInvalidLabel {
		t.Errorf("expected ErrInvalidLabel, got %v", err)
	}
}

func TestValidateLabelEmptyColor(t *testing.T) {
	l := &Label{Name: "Bug", Color: ""}
	if err := validateLabel(l); err != ErrInvalidLabel {
		t.Errorf("expected ErrInvalidLabel, got %v", err)
	}
}

func TestValidateLabelNameTooLong(t *testing.T) {
	l := &Label{Name: strings.Repeat("X", MaxLabelNameLen+1), Color: testValidColor}
	if err := validateLabel(l); err != ErrLabelNameTooLong {
		t.Errorf("expected ErrLabelNameTooLong, got %v", err)
	}
}

func TestValidateLabelNameExactlyMax(t *testing.T) {
	l := &Label{Name: strings.Repeat("X", MaxLabelNameLen), Color: testValidColor}
	if err := validateLabel(l); err != nil {
		t.Errorf("expected no error for label name at max length, got %v", err)
	}
}

func TestValidateLabelValidHexColor(t *testing.T) {
	cases := []string{testValidColor, "#00ff00", "#0a1B2c", "#000000", "#FFFFFF"}
	for _, c := range cases {
		l := &Label{Name: "X", Color: c}
		if err := validateLabel(l); err != nil {
			t.Errorf("expected valid color %q, got %v", c, err)
		}
	}
}

func TestValidateLabelInvalidHexColor(t *testing.T) {
	cases := []string{"red", "#ZZZ", "#FF00", "FF0000", "#FF00000", "#GG0000"}
	for _, c := range cases {
		l := &Label{Name: "X", Color: c}
		if err := validateLabel(l); err != ErrColorInvalid {
			t.Errorf("expected ErrColorInvalid for %q, got %v", c, err)
		}
	}
}

func TestValidateLabelNameStripsHTML(t *testing.T) {
	l := &Label{Name: "<b>Label</b>", Color: testValidColor}
	if err := validateLabel(l); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if l.Name != "Label" {
		t.Errorf("expected HTML stripped name 'Label', got '%s'", l.Name)
	}
}

// ---------------------------------------------------------------------------
// validateUser
// ---------------------------------------------------------------------------

func TestValidateUserValidEmail(t *testing.T) {
	u := &User{Email: testValidEmail, FirstName: "A", LastName: "B", Role: RoleUser}
	if err := validateUser(u); err != nil {
		t.Errorf("expected no error, got %v", err)
	}
}

func TestValidateUserEmailNoAt(t *testing.T) {
	u := &User{Email: "notanemail", FirstName: "A", LastName: "B", Role: RoleUser}
	if err := validateUser(u); err != ErrInvalidEmail {
		t.Errorf("expected ErrInvalidEmail, got %v", err)
	}
}

func TestValidateUserEmailNoDomain(t *testing.T) {
	u := &User{Email: "user@", FirstName: "A", LastName: "B", Role: RoleUser}
	if err := validateUser(u); err != ErrInvalidEmail {
		t.Errorf("expected ErrInvalidEmail, got %v", err)
	}
}

func TestValidateUserEmailTooLong(t *testing.T) {
	u := &User{
		Email:     strings.Repeat("a", 244) + "@example.com", // 256 chars total
		FirstName: "A", LastName: "B", Role: RoleUser,
	}
	if err := validateUser(u); err != ErrEmailTooLong {
		t.Errorf("expected ErrEmailTooLong, got %v", err)
	}
}

func TestValidateUserEmptyFirstName(t *testing.T) {
	u := &User{Email: testSimpleEmail, FirstName: "", LastName: "B", Role: RoleUser}
	if err := validateUser(u); err != ErrInvalidName {
		t.Errorf("expected ErrInvalidName, got %v", err)
	}
}

func TestValidateUserNameTooLong(t *testing.T) {
	u := &User{Email: testSimpleEmail, FirstName: strings.Repeat("A", MaxUserNameLength+1), LastName: "B", Role: RoleUser}
	if err := validateUser(u); err != ErrUserNameTooLong {
		t.Errorf("expected ErrUserNameTooLong, got %v", err)
	}
}

func TestValidateUserInvalidRole(t *testing.T) {
	u := &User{Email: testSimpleEmail, FirstName: "A", LastName: "B", Role: "superuser"}
	if err := validateUser(u); err != ErrInvalidRole {
		t.Errorf("expected ErrInvalidRole, got %v", err)
	}
}

func TestValidateUserSysAdminRole(t *testing.T) {
	u := &User{Email: testSimpleEmail, FirstName: "A", LastName: "B", Role: RoleSysAdmin}
	if err := validateUser(u); err != nil {
		t.Errorf("expected no error for sysadmin role, got %v", err)
	}
}

func TestValidateUserNamesStripHTML(t *testing.T) {
	u := &User{
		Email:     testSimpleEmail,
		FirstName: "<b>First</b>",
		LastName:  "<i>Last</i>",
		Role:      RoleUser,
	}
	if err := validateUser(u); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if u.FirstName != "First" {
		t.Errorf("expected HTML stripped FirstName 'First', got '%s'", u.FirstName)
	}
	if u.LastName != "Last" {
		t.Errorf("expected HTML stripped LastName 'Last', got '%s'", u.LastName)
	}
}

// ---------------------------------------------------------------------------
// validateRelease
// ---------------------------------------------------------------------------

func TestValidateReleaseValid(t *testing.T) {
	r := &Release{Name: "v1.0"}
	if err := validateRelease(r); err != nil {
		t.Errorf("expected no error for valid release, got %v", err)
	}
}

func TestValidateReleaseEmptyName(t *testing.T) {
	r := &Release{Name: ""}
	if err := validateRelease(r); err != ErrInvalidReleaseName {
		t.Errorf("expected ErrInvalidReleaseName, got %v", err)
	}
}

func TestValidateReleaseNameTooLong(t *testing.T) {
	r := &Release{Name: strings.Repeat("x", MaxReleaseNameLen+1)}
	if err := validateRelease(r); err != ErrReleaseNameTooLong {
		t.Errorf("expected ErrReleaseNameTooLong, got %v", err)
	}
}

func TestValidateReleaseNameExactlyMax(t *testing.T) {
	r := &Release{Name: strings.Repeat("x", MaxReleaseNameLen)}
	if err := validateRelease(r); err != nil {
		t.Errorf("expected no error at max length, got %v", err)
	}
}

func TestValidateReleaseDescTooLong(t *testing.T) {
	r := &Release{Name: "v1.0", Description: strings.Repeat("x", MaxReleaseDescLen+1)}
	if err := validateRelease(r); err != ErrReleaseDescTooLong {
		t.Errorf("expected ErrReleaseDescTooLong, got %v", err)
	}
}

func TestValidateReleaseInvalidStartDate(t *testing.T) {
	d := time.Date(1999, 1, 1, 0, 0, 0, 0, time.UTC)
	r := &Release{Name: "v1.0", StartDate: &d}
	if err := validateRelease(r); err == nil {
		t.Error("expected error for start date year < 2000, got nil")
	}
}

func TestValidateReleaseInvalidReleaseDate(t *testing.T) {
	d := time.Date(2101, 1, 1, 0, 0, 0, 0, time.UTC)
	r := &Release{Name: "v1.0", ReleaseDate: &d}
	if err := validateRelease(r); err == nil {
		t.Error("expected error for release date year > 2100, got nil")
	}
}

func TestValidateReleaseDateOrderInvalid(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	rel := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	r := &Release{Name: "v1.0", StartDate: &start, ReleaseDate: &rel}
	if err := validateRelease(r); err == nil {
		t.Error("expected error for release date before start date, got nil")
	}
}

func TestValidateReleaseDateOrderValid(t *testing.T) {
	start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	rel := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	r := &Release{Name: "v1.0", StartDate: &start, ReleaseDate: &rel}
	if err := validateRelease(r); err != nil {
		t.Errorf("expected no error for valid date order, got %v", err)
	}
}

func TestValidateReleaseNameStripsHTML(t *testing.T) {
	r := &Release{Name: "<b>v1.0</b>"}
	if err := validateRelease(r); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if r.Name != "v1.0" {
		t.Errorf("expected HTML stripped name 'v1.0', got '%s'", r.Name)
	}
}

// ---------------------------------------------------------------------------
// validateIssue — ErrTooManyDates
// ---------------------------------------------------------------------------

func TestValidateIssueTooManyPlannedDates(t *testing.T) {
	dates := make([]string, MaxPlannedDates+1)
	for i := range dates {
		dates[i] = "2026-01-15"
	}
	i := &Issue{Title: "T", Status: StatusOpen, PlannedDates: dates}
	if err := validateIssue(i); err != ErrTooManyDates {
		t.Errorf("expected ErrTooManyDates, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// ValidatePassword
// ---------------------------------------------------------------------------

func TestValidatePasswordTooShort(t *testing.T) {
	if err := ValidatePassword("short1!", testSimpleEmail); err != ErrPasswordTooShort {
		t.Errorf("expected ErrPasswordTooShort, got %v", err)
	}
}

func TestValidatePasswordTooLong(t *testing.T) {
	pw := strings.Repeat("A", MaxPasswordLength+1)
	if err := ValidatePassword(pw, testSimpleEmail); err != ErrPasswordTooLong {
		t.Errorf("expected ErrPasswordTooLong, got %v", err)
	}
}

func TestValidatePasswordExactlyMaxLength(t *testing.T) {
	pw := strings.Repeat("A", MaxPasswordLength)
	err := ValidatePassword(pw, testSimpleEmail)
	if err != nil && err != ErrPasswordBlacklist {
		t.Errorf("expected nil or ErrPasswordBlacklist at exact max length, got %v", err)
	}
}

func TestValidatePasswordEqualsEmail(t *testing.T) {
	if err := ValidatePassword(testValidEmail, testValidEmail); err != ErrPasswordIsEmail {
		t.Errorf("expected ErrPasswordIsEmail, got %v", err)
	}
}

func TestValidatePasswordBlacklisted(t *testing.T) {
	if err := ValidatePassword("password1234", testSimpleEmail); err != ErrPasswordBlacklist {
		t.Errorf("expected ErrPasswordBlacklist, got %v", err)
	}
}

func TestValidatePasswordValid(t *testing.T) {
	if err := ValidatePassword("V3ryStr0ng!Pass", testSimpleEmail); err != nil {
		t.Errorf("expected no error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// validateStatusConfig
// ---------------------------------------------------------------------------

func TestValidateStatusConfigAllEmpty(t *testing.T) {
	cfg := &StatusConfig{}
	if err := validateStatusConfig(cfg); err != nil {
		t.Errorf("expected no error for all-empty names, got %v", err)
	}
}

func TestValidateStatusConfigValidNames(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "Pending", Stage2Name: "Working", Stage3Name: "Review", Stage4Name: "QA"}
	if err := validateStatusConfig(cfg); err != nil {
		t.Errorf("expected no error for valid names, got %v", err)
	}
}

func TestValidateStatusConfigNamesWithSpaces(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "In Progress", Stage2Name: "Code Review"}
	if err := validateStatusConfig(cfg); err != ErrStatusNameInvalid {
		t.Errorf("expected ErrStatusNameInvalid for names with spaces, got %v", err)
	}
}

func TestValidateStatusConfigNameExactlyMaxLength(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: strings.Repeat("A", MaxStatusNameLen)}
	if err := validateStatusConfig(cfg); err != nil {
		t.Errorf("expected no error at max length, got %v", err)
	}
}

func TestValidateStatusConfigNameTooLong(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: strings.Repeat("A", MaxStatusNameLen+1)}
	if err := validateStatusConfig(cfg); err != ErrStatusNameTooLong {
		t.Errorf("expected ErrStatusNameTooLong, got %v", err)
	}
}

func TestValidateStatusConfigNameInvalidChars(t *testing.T) {
	cases := []string{"Bad!Name", "No#Hash", "dash-not-ok", "dot.not.ok", "slash/bad"}
	for _, name := range cases {
		cfg := &StatusConfig{Stage1Name: name}
		if err := validateStatusConfig(cfg); err != ErrStatusNameInvalid {
			t.Errorf("expected ErrStatusNameInvalid for %q, got %v", name, err)
		}
	}
}

func TestValidateStatusConfigNonASCIIInvalid(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "Überprüfung"}
	if err := validateStatusConfig(cfg); err != ErrStatusNameInvalid {
		t.Errorf("expected ErrStatusNameInvalid for non-ASCII name, got %v", err)
	}
}

func TestValidateStatusConfigTrimmedBeforeValidation(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "  Review  "}
	if err := validateStatusConfig(cfg); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if cfg.Stage1Name != "Review" {
		t.Errorf("expected trimmed 'Review', got '%s'", cfg.Stage1Name)
	}
}

func TestValidateStatusConfigWhitespaceOnlyBecomesEmpty(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "   "}
	if err := validateStatusConfig(cfg); err != nil {
		t.Errorf("expected no error for whitespace-only name (treated as empty), got %v", err)
	}
	if cfg.Stage1Name != "" {
		t.Errorf("expected trimmed empty string, got '%s'", cfg.Stage1Name)
	}
}

func TestValidateStatusConfigStage3InvalidOthersValid(t *testing.T) {
	cfg := &StatusConfig{Stage1Name: "Pending", Stage2Name: "Working", Stage3Name: "Bad!", Stage4Name: ""}
	if err := validateStatusConfig(cfg); err != ErrStatusNameInvalid {
		t.Errorf("expected ErrStatusNameInvalid for Stage3, got %v", err)
	}
}
