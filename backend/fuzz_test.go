package backend

import (
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"
)

var (
	// tagRegex extracts (tagName, attributeString) from any HTML-like tag in the result.
	tagRegex = regexp.MustCompile(`(?i)<(/?[a-z1-6]+)/?(\s+[^>]*)?>`)

	// eventHandlerRegex matches any HTML event handler attribute (on*=).
	// \b prevents false matches on substrings like "font=" or "icon=".
	// Catches all 70+ HTML event handlers without maintaining an explicit list.
	eventHandlerRegex = regexp.MustCompile(`(?i)\bon\w+=`)

	// anchorOpenTagRegex matches any opening <a ...> tag in the sanitized result.
	// Uses alternation to skip over quoted attribute values so that a literal >
	// inside e.g. href=">" does not prematurely terminate the match.
	anchorOpenTagRegex = regexp.MustCompile(`(?i)<a\s(?:[^>"']|"[^"]*"|'[^']*')*>`)

	// hrefValueRegex extracts the href value from a double-quoted href attribute.
	// Used to check the href value itself rather than the full attribute string,
	// which avoids false positives like href="0javascript:" being flagged as dangerous.
	hrefValueRegex = regexp.MustCompile(`(?i)href="([^"]*)"`)

	// dangerousSchemeRegex matches a URI that begins with a dangerous scheme
	// (after optional whitespace), mirroring the production unsafeHrefRegex logic.
	dangerousSchemeRegex = regexp.MustCompile(`(?i)^\s*(javascript|data|vbscript):`)

	allowedTags = make(map[string]bool)
)

// init populates allowedTags from AllowedHTMLTags (defined in validation.go).
// This ensures the fuzzer's validation logic stays in sync with the production
// code's source of truth.
func init() {
	for _, t := range AllowedHTMLTags {
		allowedTags[t] = true
		allowedTags["/"+t] = true
	}
}

// FuzzSanitizeHTML tests the HTML sanitizer for crashes and security invariants.
func FuzzSanitizeHTML(f *testing.F) {
	// Seed corpus with known safe and dangerous patterns.
	f.Add("<b>Hello</b>")
	f.Add("<script>alert(1)</script>")
	f.Add(`<a href="javascript:alert(1)">link</a>`)
	f.Add(`<img src=x onerror=alert(1)>`)
	f.Add("<div>Chrome style</div>")
	f.Add("Mixed text with <p>tags</p> and <b>formatting</b>")
	f.Add("\x00\uE000") // Potential sentinel collision

	// Single-quoted href: bypasses the double-quote anchorTagRegex rebuilder;
	// must be stripped by the fallback anyTagRegex in step 4 of sanitizeHTML.
	f.Add(`<a href='javascript:alert(1)'>link</a>`)

	// Uppercase tag name with a handler not in the old 3-item explicit list;
	// exercises the case-insensitive event handler regex path.
	f.Add(`<B ONMOUSEOVER="alert(1)">text</B>`)

	// Tab and newline before the protocol: unsafeHrefRegex uses ^\s* which must
	// match horizontal and vertical whitespace, not just spaces.
	f.Add("<a href=\"\t\njavascript:alert(1)\">x</a>")

	// Interleaved closing tags: exercises sentinel index ordering during the
	// restore phase when open/close pairs are not properly nested.
	f.Add("<b><i>text</b></i>")

	// SVG onload — a non-allowed tag with an unquoted event handler (no quotes
	// around the value, so eventHandlerRegex must still catch it if it survives).
	f.Add(`<svg onload=alert(1)>`)

	// Unquoted href — anchorTagRegex requires href="...", so this is not rebuilt
	// and must be stripped entirely by anyTagRegex in step 4.
	f.Add(`<a href=javascript:void(0)>click</a>`)

	// Allowed tag with an attribute — allowedAllTagRegex matches <b> only when
	// the tag has no attributes, so <b style=...> falls through to anyTagRegex.
	f.Add(`<b style="color:red">text</b>`)

	// HTML comment containing a script — exercises whether <!-- --> is stripped.
	f.Add(`<!--<script>alert(1)</script>-->`)

	// Nested tag confusion: valid tag embedded inside an invalid tag name,
	// a classic browser-parser divergence technique.
	f.Add(`<scr<b>ipt>alert(1)</scr</b>ipt>`)

	// Multiple anchors, one safe and one with javascript: href — exercises the
	// anchor-rebuild loop handling more than one anchor in the input.
	f.Add(`<a href="https://example.com">ok</a><a href="javascript:alert(1)">bad</a>`)

	// HTML entity encoding in href: &#106; decodes to 'j'. Tests whether the
	// sanitizer can be bypassed by entity-encoding the start of the scheme.
	f.Add(`<a href="&#106;avascript:alert(1)">link</a>`)

	// iframe with javascript: src — multi-letter disallowed tag, common XSS vector.
	f.Add(`<iframe src="javascript:alert(1)"></iframe>`)

	// CDATA section — XML injection that some HTML parsers handle specially.
	f.Add(`<![CDATA[<script>alert(1)</script>]]>`)

	// Allowed tag with event on opening tag — the tag name is safe but the whole
	// opening tag must be stripped because allowedAllTagRegex requires no attributes.
	f.Add(`<b onclick="alert(1)">bold</b>`)

	// Null byte inside a tag name: some parsers strip \x00 and then see <script>.
	// Also exercises the sentinel boundary: partialTagRegex stops at \x00, so if
	// anyTagRegex missed it, only "<scr" would be removed and "ipt>" would leak.
	f.Add("<scr\x00ipt>alert(1)</scr\x00ipt>")

	// Double-bracket confusion: anyTagRegex greedily matches "<<script>" (the
	// inner "<" is not ">"), leaving a bare ">" in the output.
	f.Add("<<script>>")

	// Hex HTML entity in href: &#x6A; decodes to 'j'. Complements the decimal
	// entity seed (&#106;) — the production unsafeHrefRegex checks raw bytes,
	// not decoded values, so both entity forms reach the anchor rebuilder.
	f.Add(`<a href="&#x6A;avascript:alert(1)">link</a>`)

	f.Fuzz(func(t *testing.T, raw string) {
		// Invariant 1: Must never panic.
		result := sanitizeHTML(raw)

		// Invariant 2: Result must be valid UTF-8 if input was valid UTF-8.
		if utf8.ValidString(raw) && !utf8.ValidString(result) {
			t.Errorf("sanitizeHTML produced invalid UTF-8 from valid input: %q", raw)
		}

		// Invariant 3: Any tags that remain must be in our allowed list and must
		// not contain event handlers or dangerous URI schemes.
		validateResultTags(t, raw, result)

		// Invariant 4: Any surviving <a> tag must carry the required security
		// attributes that prevent tabnapping.
		checkAnchorSecurity(t, raw, result)

		// Invariant 5: No internal sentinels should be leaked unless they were in the input.
		if strings.Contains(result, "\x00") && !strings.Contains(raw, "\x00") {
			t.Errorf("Internal sentinel leaked into result. Input: %q, Result: %q", raw, result)
		}
	})
}

func validateResultTags(t *testing.T, raw, result string) {
	matches := tagRegex.FindAllStringSubmatch(result, -1)
	for _, match := range matches {
		tagName := strings.ToLower(match[1])
		if !allowedTags[tagName] {
			t.Errorf("Result contains disallowed tag %q. Input: %q, Result: %q", tagName, raw, result)
		}

		// If it has attributes, check for event handlers or dangerous URI schemes.
		if len(match) > 2 && match[2] != "" {
			checkTagAttributes(t, tagName, match[2], raw, result)
		}
	}
}

func checkTagAttributes(t *testing.T, tagName, attrs, raw, result string) {
	// One regex call catches all on*= event handlers (onmouseover, onfocus,
	// onkeydown, etc.) — replaces the old pre-filter + 3-item explicit list
	// that silently missed most of the 70+ valid HTML event handler attributes.
	if eventHandlerRegex.MatchString(attrs) {
		t.Errorf("Result tag %q contains event handler attribute. Attrs: %q, Input: %q, Result: %q",
			tagName, attrs, raw, result)
	}

	// Check href values for dangerous URI schemes. We extract the href value and
	// test whether it STARTS with a dangerous scheme (mirroring unsafeHrefRegex),
	// rather than checking the full attribute string for a substring match.
	// The substring approach causes false positives: href="0javascript:" contains
	// "javascript:" but is a plain relative URL that no browser executes as JS.
	if m := hrefValueRegex.FindStringSubmatch(attrs); len(m) > 1 {
		if dangerousSchemeRegex.MatchString(m[1]) {
			t.Errorf("Result tag %q href starts with dangerous URI scheme. href=%q, Input: %q, Result: %q",
				tagName, m[1], raw, result)
		}
	}
}

// checkAnchorSecurity enforces the tabnapping-prevention invariant: every <a>
// tag produced by sanitizeHTML must carry target="_blank" and
// rel="noopener noreferrer". Their absence means an anchor slipped through
// without being rebuilt by the sanitizer's anchor-reconstruction step.
func checkAnchorSecurity(t *testing.T, raw, result string) {
	anchors := anchorOpenTagRegex.FindAllString(result, -1)
	for _, anchor := range anchors {
		lower := strings.ToLower(anchor)
		if !strings.Contains(lower, `target="_blank"`) {
			t.Errorf("Anchor tag missing target=\"_blank\". Tag: %q, Input: %q, Result: %q",
				anchor, raw, result)
		}
		if !strings.Contains(lower, `rel="noopener noreferrer"`) {
			t.Errorf("Anchor tag missing rel=\"noopener noreferrer\". Tag: %q, Input: %q, Result: %q",
				anchor, raw, result)
		}
	}
}

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

// FuzzValidateIssue tests the issue validation logic (specifically string cleaning).
func FuzzValidateIssue(f *testing.F) {
	f.Add("Clean Title", "Clean Description")
	f.Add("<b>Title</b>", "<script>alert(1)</script>")
	f.Add("", "")

	// Allowed tag with event in description — sanitizeHTML must strip the event
	// attribute (whole opening tag), leaving only the text and closing tag.
	f.Add("Title", `<b onclick="alert(1)">bold</b>`)

	// Multiple anchors in description, one safe and one dangerous.
	f.Add("Title", `<a href="https://safe.example">ok</a><a href="javascript:x">bad</a>`)

	// HTML entities in description: visible text is "<script>" but it is just
	// text, not a tag — must not be sanitized away or affect the tag invariant.
	f.Add("Title", "&lt;script&gt;alert(1)&lt;/script&gt;")

	// Deeply nested allowed tags: exercises sentinel slot allocation for many
	// safe tags in a single input.
	f.Add("Nested", `<ul><li><b><i>nested</i></b></li></ul>`)

	// Title with only tags (all stripped) — validateIssue must return an error
	// for empty-after-strip, exercising the ErrInvalidTitle branch.
	f.Add("<b></b>", "description")

	f.Fuzz(func(t *testing.T, title, desc string) {
		i := &Issue{
			Title:       title,
			Description: desc,
			Status:      StatusOpen,
		}

		// Should never panic.
		err := validateIssue(i)

		if err == nil {
			// Invariant: validated title must be clean of all HTML tags.
			if anyTagRegex.MatchString(i.Title) {
				t.Errorf("Validated issue title still contains tags: %q", i.Title)
			}

			// Invariant: validated description must pass the same tag-safety checks
			// as FuzzSanitizeHTML — validateIssue calls sanitizeHTML on the
			// description, so only allowed tags may remain and no dangerous
			// attributes or URI schemes may be present.
			validateResultTags(t, desc, i.Description)
			checkAnchorSecurity(t, desc, i.Description)
		}
	})
}
