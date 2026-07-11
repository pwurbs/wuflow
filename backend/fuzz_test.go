package backend

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// FuzzValidateLabel tests the label validation logic for crashes and name sanitization.
func FuzzValidateLabel(f *testing.F) {
	const validColor = "#ff0000"

	f.Add("Bug", validColor)
	f.Add("<script>xss</script>", "#abc")
	f.Add("", "#123456")
	f.Add("Valid Label", "notacolor")
	f.Add(strings.Repeat("x", MaxLabelNameLen+1), "#ffffff")

	// HTML comment — exercises whether <!-- --> counts as a tag and gets stripped.
	f.Add("<!--comment-->", validColor)

	// Allowed tag with attribute — allowedAllTagRegex only matches bare <b>, so
	// <b class="x"> must be stripped by anyTagRegex, leaving "label".
	f.Add(`<b class="x">label</b>`, validColor)

	// Partial-tag / sentinel-steal pattern similar to the <1 <B> bug: an unknown
	// tag fragment followed immediately by an allowed tag with no space between them.
	f.Add("<x<b>label</b>", validColor)

	f.Fuzz(func(t *testing.T, name, color string) {
		l := &Label{Name: name, Color: color}

		// Should never panic.
		err := validateLabel(l)

		// If validation passed, the name must be clean of all HTML tags.
		if err == nil {
			if anyTagRegex.MatchString(l.Name) {
				t.Errorf("Validated label name still contains tags: %q", l.Name)
			}
			if utf8.RuneCountInString(l.Name) > MaxLabelNameLen {
				t.Errorf("Validated label name exceeds max length: %q", l.Name)
			}
		}
	})
}

// FuzzValidateUser tests the user validation logic for crashes and name sanitization.
func FuzzValidateUser(f *testing.F) {
	f.Add("user@example.com", "Alice", "Smith", string(RoleUser))
	f.Add("admin@example.com", "Bob", "Jones", string(RoleAdmin))
	f.Add("<b>xss</b>@example.com", "<script>x</script>", "<i>y</i>", string(RoleUser))
	f.Add("", "", "", "")
	f.Add("notanemail", "A", "B", string(RoleUser))
	f.Add("user@example.com", strings.Repeat("A", MaxUserNameLength+1), "B", string(RoleUser))

	f.Fuzz(func(t *testing.T, email, firstName, lastName, role string) {
		u := &User{
			Email:     email,
			FirstName: firstName,
			LastName:  lastName,
			Role:      UserRole(role),
		}

		// Should never panic.
		err := validateUser(u)

		// If validation passed, first and last name must be clean of all HTML tags.
		if err == nil {
			if anyTagRegex.MatchString(u.FirstName) {
				t.Errorf("Validated user FirstName still contains tags: %q", u.FirstName)
			}
			if anyTagRegex.MatchString(u.LastName) {
				t.Errorf("Validated user LastName still contains tags: %q", u.LastName)
			}
			if utf8.RuneCountInString(u.FirstName) > MaxUserNameLength {
				t.Errorf("Validated user FirstName exceeds max length: %q", u.FirstName)
			}
			if utf8.RuneCountInString(u.LastName) > MaxUserNameLength {
				t.Errorf("Validated user LastName exceeds max length: %q", u.LastName)
			}
		}
	})
}

// FuzzIsBlacklistedPassword ensures the password checker doesn't crash on any input.
func FuzzIsBlacklistedPassword(f *testing.F) {
	f.Add("password")
	f.Add("p4ssw0rd")
	f.Add("!@#$%^&*()")
	f.Add("Schatz123")
	f.Add(" muito-longo-com-acentos-é-á-õ ")

	// Multiple simultaneous leet substitutions composing to a blacklisted word:
	// @→a, $→s (twice), 0→o all fire in a single NewReplacer scan.
	f.Add("p@$$w0rd")

	// 3-char prefix of a blacklist word: verifies that substring containment
	// only fires for blocked words with len >= 4, not for inputs shorter than
	// the blocked word itself.
	f.Add("pas")

	// Leet-encoded German blacklist entry: 5→s, @→a produce "schatz".
	f.Add("5ch@tz")

	// @→a, 1→i produce "admin" after normalization.
	f.Add("@dm1n")

	// qwertz (German keyboard layout) with leet: 3→e produces "qwertz".
	f.Add("qw3rtz")

	// Uppercase input: ToLower must fire before leet substitution for this to
	// normalize correctly and match "password".
	f.Add("PASSW0RD")

	// Leading/trailing whitespace: not trimmed by isBlacklistedPassword,
	// so " password " should NOT match (the padding prevents substring hit).
	f.Add(" password ")

	f.Fuzz(func(t *testing.T, pw string) {
		// Mostly checking for panics in leetspeak replacement and normalization.
		_ = isBlacklistedPassword(pw)
	})
}

// FuzzValidateProject tests the project validation logic for crashes and field sanitization.
func FuzzValidateProject(f *testing.F) {
	f.Add("Backend", "All backend-related issues")
	f.Add("<script>xss</script>", "")
	f.Add("", "Some description")
	f.Add(strings.Repeat("x", MaxProjectNameLen+1), "desc")
	f.Add("Valid", strings.Repeat("d", MaxProjectDescLen+1))

	// Null bytes in name and description
	f.Add("\x00\x00ProjectName\x00", "desc\x00with\x00nulls")

	// HTML in description — must be stripped
	f.Add("Project", "<b>bold</b> description")

	// Partial-tag pattern in name
	f.Add("<x<b>name</b>", "description")

	f.Fuzz(func(t *testing.T, name, desc string) {
		p := &Project{Name: name, Description: desc}

		// Should never panic.
		err := validateProject(p)

		if err == nil {
			// Invariant: validated name must be clean of all HTML tags.
			if anyTagRegex.MatchString(p.Name) {
				t.Errorf("Validated project name still contains tags: %q", p.Name)
			}
			// Invariant: validated description must be clean of all HTML tags.
			if anyTagRegex.MatchString(p.Description) {
				t.Errorf("Validated project description still contains tags: %q", p.Description)
			}
			if utf8.RuneCountInString(p.Name) > MaxProjectNameLen {
				t.Errorf("Validated project name exceeds max length: %q", p.Name)
			}
			if utf8.RuneCountInString(p.Description) > MaxProjectDescLen {
				t.Errorf("Validated project description exceeds max length: %q", p.Description)
			}
		}
	})
}

// FuzzValidateStatusConfig tests the board column name validation for crashes and
// correct rejection of names that contain disallowed characters or exceed length limits.
func FuzzValidateStatusConfig(f *testing.F) {
	f.Add("Pending", "Working", "", "")
	f.Add("", "", "", "")
	f.Add("<script>xss</script>", "Working", "", "")
	f.Add("Done", "In Progress", "Review", "QA")
	f.Add(strings.Repeat("A", MaxStatusNameLen+1), "Working", "", "")
	f.Add("  Pending  ", "Working", "", "")

	// Null bytes — should fail the alphanumeric regex.
	f.Add("\x00Name", "Working", "", "")

	// Unicode letters — must fail the ASCII-only regex.
	f.Add("Révision", "Working", "", "")

	// Partial-tag pattern: should fail the alphanumeric regex.
	f.Add("<x<b>col</b>", "Working", "", "")

	f.Fuzz(func(t *testing.T, s1, s2, s3, s4 string) {
		cfg := &StatusConfig{
			Stage1Name: s1,
			Stage2Name: s2,
			Stage3Name: s3,
			Stage4Name: s4,
		}

		// Should never panic.
		if err := validateStatusConfig(cfg); err != nil {
			return
		}

		// Invariant: every non-empty name must consist solely of alphanumeric characters.
		for _, name := range []string{cfg.Stage1Name, cfg.Stage2Name, cfg.Stage3Name, cfg.Stage4Name} {
			if name == "" {
				continue
			}
			if !statusNameRegex.MatchString(name) {
				t.Errorf("Validated stage name contains disallowed characters: %q", name)
			}
			if utf8.RuneCountInString(name) > MaxStatusNameLen {
				t.Errorf("Validated stage name exceeds max length: %q", name)
			}
		}
	})
}

// FuzzValidateIssue tests the issue validation logic, verifying that Title is
// cleaned of HTML and null bytes, and that Description is cleaned of null
// bytes and trimmed.
func FuzzValidateIssue(f *testing.F) {
	f.Add("Clean Title", "Some description")
	f.Add("<b>HTML Title</b>", "**Markdown** description")
	f.Add("", "")

	// Null bytes (\x00) should be stripped from Title and Description before validation.
	f.Add("\x00\x00Title With Nulls\x00", "description\x00with\x00nulls")

	// Title with only tags (all stripped) — validateIssue must return an error
	// for empty-after-strip, exercising the ErrInvalidTitle branch.
	f.Add("<b></b>", "description")

	// Whitespace trimming
	f.Add("  Title  ", "  Trimmed Description  ")

	// Title length bounds testing (MaxTitleLength = 100)
	f.Add(strings.Repeat("A", MaxTitleLength+1), "description")

	// Description length bounds testing (MaxDescLength = 5000)
	f.Add("Title", strings.Repeat("x", MaxDescLength+1))

	f.Fuzz(func(t *testing.T, title, desc string) {
		i := &Issue{
			Title:       title,
			Description: desc,
			Status:      StatusOpen,
		}

		// Validation should never panic on any input
		err := validateIssue(i)

		if err == nil {
			checkValidatedIssueInvariants(t, i)
		}
	})
}

// FuzzValidateComment tests the comment validation logic, verifying that Body is
// cleaned of null bytes and trimmed. Like Issue.Description, Body is intentionally
// NOT stripped of HTML tags — it is plain Markdown, sanitized at render time via
// DOMPurify on the frontend (see markdown-security.md).
func FuzzValidateComment(f *testing.F) {
	f.Add("Some **markdown** comment")
	f.Add("<b>HTML in comment</b>")
	f.Add("")
	f.Add("   ")

	// Null bytes (\x00) should be stripped from Body before validation.
	f.Add("comment\x00with\x00nulls")

	// Whitespace trimming
	f.Add("  Trimmed comment  ")

	// Length bounds testing (MaxCommentLength = 1000)
	f.Add(strings.Repeat("x", MaxCommentLength+1))

	f.Fuzz(func(t *testing.T, body string) {
		c := &Comment{Body: body}

		// Validation should never panic on any input.
		err := validateComment(c)

		if err == nil {
			checkValidatedCommentInvariants(t, c)
		}
	})
}

// FuzzValidateRelease tests the release validation logic for crashes and field sanitization.
// Dates are passed as Unix timestamps (int64) paired with booleans that control whether
// each date pointer is nil, because the Go fuzz engine only supports primitive types.
func FuzzValidateRelease(f *testing.F) {
	// valid release: both dates present and in order
	f.Add("v1.0", "First stable release", true, int64(1735689600), true, int64(1767225600))
	// only name, no dates
	f.Add("Sprint-1", "", false, int64(0), false, int64(0))
	// HTML injection in name and description
	f.Add("<script>xss</script>", "<b>bold</b>", false, int64(0), false, int64(0))
	// name too long
	f.Add(strings.Repeat("x", MaxReleaseNameLen+1), "desc", false, int64(0), false, int64(0))
	// description too long
	f.Add("v2.0", strings.Repeat("d", MaxReleaseDescLen+1), false, int64(0), false, int64(0))
	// empty name (must fail)
	f.Add("", "some desc", false, int64(0), false, int64(0))
	// null bytes in name and description
	f.Add("\x00release\x00", "desc\x00with\x00nulls", false, int64(0), false, int64(0))
	// release date before start date (must fail)
	f.Add("v3.0", "", true, int64(1767225600), true, int64(1735689600))
	// start date year before 2000 (must fail)
	f.Add("v4.0", "", true, int64(-315619200), false, int64(0))
	// release date year after 2100 (must fail)
	f.Add("v5.0", "", false, int64(0), true, int64(4133980800))
	// both dates on the same day (boundary: release == start is allowed)
	f.Add("v6.0", "", true, int64(1735689600), true, int64(1735689600))
	// partial-tag pattern in name
	f.Add("<x<b>rel</b>", "description", false, int64(0), false, int64(0))

	f.Fuzz(func(t *testing.T, name, desc string, hasStart bool, startUnix int64, hasRelease bool, releaseUnix int64) {
		r := &Release{Name: name, Description: desc}
		if hasStart {
			ts := time.Unix(startUnix, 0).UTC()
			r.StartDate = &ts
		}
		if hasRelease {
			ts := time.Unix(releaseUnix, 0).UTC()
			r.ReleaseDate = &ts
		}

		// Should never panic.
		if err := validateRelease(r); err == nil {
			checkValidatedReleaseInvariants(t, r)
		}
	})
}

func checkValidatedReleaseInvariants(t *testing.T, r *Release) {
	t.Helper()

	if anyTagRegex.MatchString(r.Name) {
		t.Errorf("Validated release name still contains tags: %q", r.Name)
	}
	if anyTagRegex.MatchString(r.Description) {
		t.Errorf("Validated release description still contains tags: %q", r.Description)
	}
	if utf8.RuneCountInString(r.Name) > MaxReleaseNameLen {
		t.Errorf("Validated release name exceeds max length: %q", r.Name)
	}
	if utf8.RuneCountInString(r.Description) > MaxReleaseDescLen {
		t.Errorf("Validated release description exceeds max length: %q", r.Description)
	}
	if r.StartDate != nil {
		if y := r.StartDate.Year(); y < 2000 || y > 2100 {
			t.Errorf("Validated release has start date with out-of-range year: %d", y)
		}
	}
	if r.ReleaseDate != nil {
		if y := r.ReleaseDate.Year(); y < 2000 || y > 2100 {
			t.Errorf("Validated release has release date with out-of-range year: %d", y)
		}
	}
	if r.StartDate != nil && r.ReleaseDate != nil && r.ReleaseDate.Before(*r.StartDate) {
		t.Errorf("Validated release has release date before start date: start=%v release=%v", r.StartDate, r.ReleaseDate)
	}
}

// checkValidatedIssueInvariants asserts post-validation invariants on a successfully validated issue.
// Description is intentionally NOT checked for HTML tags; that sanitization is handled by
// DOMPurify on the frontend to support Markdown rendering.
func checkValidatedIssueInvariants(t *testing.T, i *Issue) {
	t.Helper()

	if anyTagRegex.MatchString(i.Title) {
		t.Errorf("Validated issue title still contains tags: %q", i.Title)
	}
	if strings.Contains(i.Title, "\x00") {
		t.Errorf("Validated issue title still contains null bytes: %q", i.Title)
	}
	if strings.Contains(i.Description, "\x00") {
		t.Errorf("Validated issue description still contains null bytes: %q", i.Description)
	}
	if len(i.Description) > 0 && strings.TrimSpace(i.Description) != i.Description {
		t.Errorf("Validated issue description is not trimmed: %q", i.Description)
	}
	if utf8.RuneCountInString(i.Title) > MaxTitleLength {
		t.Errorf("Validated issue title exceeds max length: %q", i.Title)
	}
	if utf8.RuneCountInString(i.Description) > MaxDescLength {
		t.Errorf("Validated issue description exceeds max length: %q", i.Description)
	}
}

// checkValidatedCommentInvariants asserts post-validation invariants on a successfully
// validated comment. Body is intentionally NOT checked for HTML tags; that sanitization
// is handled by DOMPurify on the frontend to support Markdown rendering.
func checkValidatedCommentInvariants(t *testing.T, c *Comment) {
	t.Helper()

	if c.Body == "" {
		t.Errorf("Validated comment has empty body (should have failed with ErrInvalidComment)")
	}
	if strings.Contains(c.Body, "\x00") {
		t.Errorf("Validated comment body still contains null bytes: %q", c.Body)
	}
	if strings.TrimSpace(c.Body) != c.Body {
		t.Errorf("Validated comment body is not trimmed: %q", c.Body)
	}
	if utf8.RuneCountInString(c.Body) > MaxCommentLength {
		t.Errorf("Validated comment body exceeds max length: %q", c.Body)
	}
}
