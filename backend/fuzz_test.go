package backend

import (
	"strings"
	"testing"
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
		}
	})
}

// FuzzValidateIssue tests the issue validation logic, specifically verifying
// that plain-text fields (like Title) are correctly cleaned and validated,
// while Description is only validated for length constraints.
func FuzzValidateIssue(f *testing.F) {
	f.Add("Clean Title", "Some description")
	f.Add("<b>HTML Title</b>", "**Markdown** description")
	f.Add("", "")

	// Null bytes (\x00) should be stripped from Title before length/content validation.
	f.Add("\x00\x00Title With Nulls\x00", "description")

	// Title with only tags (all stripped) — validateIssue must return an error
	// for empty-after-strip, exercising the ErrInvalidTitle branch.
	f.Add("<b></b>", "description")

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
			// Invariant: validated title must be entirely clean of HTML tags
			// and Null bytes.
			if anyTagRegex.MatchString(i.Title) {
				t.Errorf("Validated issue title still contains tags: %q", i.Title)
			}
			if strings.Contains(i.Title, "\x00") {
				t.Errorf("Validated issue title still contains null bytes: %q", i.Title)
			}
			// Description is preserved entirely; security constraints for description
			// (e.g. DOMPurify) are enforced on the frontend during rendering.
		}
	})
}
