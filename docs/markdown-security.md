# Markdown Security & Sanitization

## Overview
The issue description **and** issue comments in wuFlow natively support Markdown to allow rich-text formatting while mitigating XSS (Cross-Site Scripting) risks. Both fields share the exact same sanitization pipeline described below. (Tasks have no description field — only a plain-text `Title` — so this document doesn't apply to them.) This document summarizes the approach, the end-to-end data flow, supported mappings, and provides test cases for validating the implementation.

## End-to-End Flow (Input to Rendering)

1. **User Input (Client)**
   - The user inputs text, including Markdown formatting, into the description editor or the comment box on the frontend.
   - The description editor additionally provides a preview mode by parsing the raw Markdown.
2. **Backend Storage**
   - The payload is sent to the backend API.
   - The backend treats the description/comment strictly as plain Markdown text.
   - **No regex-based HTML filtering** (like `sanitizeHTML`) is applied. The backend evaluates constraints using simple character counts (`validateIssue` / `validateComment` in `backend/validation.go`).
   - The raw Markdown text is stored in the database exactly as submitted.
3. **Retrieval and Client-Side Rendering**
   - Clients retrieve the raw Markdown string via the API.
   - **Parsing**: The `marked` library converts the Markdown string into raw HTML (GitHub Flavored Markdown is enabled).
   - **Sanitization**: The raw HTML is passed through `DOMPurify` (in `markdown.js`), which acts as an air-tight security boundary. The issue description preview and the Activity area's comment bodies both call the same `renderMarkdown()` helper.
   - The safe, purified HTML is then injected into the DOM for viewing.

## API Consumers & Trust Boundary

The description and comment fields returned by the API are **untrusted raw Markdown source**. This is intentional and matches common industry practice (GitHub, GitLab, Jira, and Stack Overflow all store and serve the raw Markdown source unmodified): sanitization happens at *output time, for the specific output context* — never at input time.

- **Consumer responsibility**: Any consumer that renders the description or a comment as HTML **must sanitize it in its own context**, exactly as the bundled frontend does via `marked` + DOMPurify. A string inside a JSON response is inert data; it only becomes dangerous when a consumer injects it into an HTML page unescaped — and only the consumer knows its output context (HTML, email, PDF, terminal).
- **Server-side guarantees**: The server ensures its own responses can never be interpreted as an HTML context: API responses are served with `Content-Type: application/json`, and the server sets `X-Content-Type-Options: nosniff` and a Content-Security-Policy (see `backend/server.go`).
- **Why no input sanitization**: Write-time HTML filtering would corrupt legitimate content (e.g., `<script>` inside code fences — see the test cases below), cannot be fixed retroactively for already-stored data if the filter turns out to be flawed, and trains consumers into a false sense of security. Output-time sanitization via DOMPurify means a future DOMPurify security fix instantly protects all stored data.
- **Future renderers rule**: Any new feature that renders descriptions or comments (email notifications, PDF export, webhook receivers, mobile clients) constitutes its own security boundary and needs its own context-appropriate sanitization step.

## Supported Markdown & HTML Mappings

Through our `PURIFY_CONFIG` via DOMPurify, only a strict subset of HTML elements produced by Markdown or embedded HTML is allowed. All other tags and potentially dangerous attributes (e.g., event handlers or `javascript:` / `data:` URIs) are completely stripped.

| Markdown Feature      | Resulting HTML Tag | Status in DOMPurify |
|-----------------------|--------------------|---------------------|
| Headings (`#`, `##`)  | `<h1>` to `<h6>`   | **Allowed**         |
| Bold (`**`)           | `<b>`, `<strong>`  | **Allowed**         |
| Italic (`*`)          | `<i>`, `<em>`      | **Allowed**         |
| Strikethrough (`~~`)  | `<s>`, `<del>`     | **Allowed**         |
| Lists (`-`, `1.`)     | `<ul>`, `<ol>`, `<li>` | **Allowed** (Attribute on `<ol>`: `start`) |
| Paragraphs / Linebreaks | `<p>`, `<br>`     | **Allowed**         |
| Links (`[text](url)`) | `<a>`              | **Allowed** (Attributes: `href`, `title`, `target`, `rel`) |
| Code (`inline`, block)| `<code>`, `<pre>`  | **Allowed** (Attribute `class` allowed; marked always emits `class="language-…"` on code blocks) |
| GFM Tables (`\| … \|`) | `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` | **Allowed** (Attribute `align` allowed for column alignment; marked emits `align="left\|center\|right"`) |
| Horizontal Rule (`---`) | `<hr>`               | **Allowed**         |

---

## Render Cache

`renderMarkdown` in `markdown.js` caches its output in a module-level `Map` keyed by the raw Markdown string. On a cache hit the function returns the previously sanitized HTML directly, bypassing `marked` and DOMPurify entirely.

**Why this is safe**: DOMPurify is deterministic — the same input with the same `PURIFY_CONFIG` always produces the same sanitized output. Serving a cached result is therefore equivalent to re-running sanitization. The cache is purely in-memory and resets on every page load; it is never persisted to `localStorage`, cookies, or any other storage.

**Cache invalidation**: The cache key is the raw Markdown string itself. When a description is edited and saved, the next modal open fetches fresh data from the server. If the text changed, the new string is a new cache key and DOMPurify runs fresh. If the text is identical to a previous value, the cached (already-sanitized) HTML is returned — which is correct, as the output would be unchanged.

**Performance rationale**: The first call to `DOMPurify.sanitize` in a browser session incurs a cold-start cost from the JavaScript engine's JIT compiler and the browser's `DOMParser`. Caching eliminates this cost on every subsequent open of an issue whose description has already been rendered.

---

## Testing Scenarios

Copy and paste the sections below (snippets within markdown code blocks) into an Issue description field or a comment box to visually verify that rendering and security policies are applied correctly. Both fields render through the same `renderMarkdown()` + DOMPurify pipeline, so a scenario that passes for one passes for the other — note the comment box has a much shorter length limit (500 characters, see [Input Validation](input-validation.md)), so a couple of the larger snippets below may need trimming to fit.

### 🟢 1. Standard Markdown
Tests basic formatting, headers, lists, code blocks, and links.

```markdown
# Heading 1
## Heading 2

This is **bold**, *italic*, and ~~strikethrough~~.

- Bullet point 1
- Bullet point 2

1. Numbered list
2. Another item

[Example Link](https://google.com)

`inline code`

```
// Block code
console.log("Hello World");
```

Text above horizontal rule

---

Text below horizontal rule
```markdown

### 🟢 2. GFM Tables
Tests GFM table rendering including optional column alignment. Should render a bordered table **without** triggering a security alert.

```markdown
| Left | Center | Right |
| :--- | :----: | ----: |
| A    | B      | C     |
| 1    | 2      | 3     |
```

### 🟡 3. Allowed Embedded HTML
Tests manual HTML tags that are explicitly permitted by our `PURIFY_CONFIG` (e.g., custom manual HTML in Markdown text). These should render seamlessly **without** triggering a security alert.

```markdown
Hello <b>Bold HTML</b> and <i>Italic HTML</i>.

Check out this <a href="https://example.com" target="_blank" rel="noopener">Allowed Link</a>.

<p>A standard paragraph tag.</p>

<ul>
  <li>HTML List Item</li>
</ul>
```

### 🔴 4. Disallowed HTML (Security Stripping Test)
Tests tags and attributes that must be stripped for security. This **should** trigger the "Unsupported HTML tags are not rendered for security" warning toast in the client.

**Disallowed Tags**:
```markdown
Warning: <script>alert('XSS!')</script> should be stripped.

Check this <iframe src="https://malicious.site"></iframe> out.

<style>body { background: red; }</style> The <style> tag is blocked (only the style attribute on allowed elements is permitted).
```

**Disallowed Attributes & Schemes**:
```markdown
Link with a bad attribute: <a href="https://example.com" onclick="alert(1)">Click Me</a>

Malicious Link: [Don't click](javascript:alert('XSS'))
```

### 🟠 5. Unclosed Tags
Validates how DOMPurify strictly bounds unclosed HTML tags to prevent bleeding across the page layout.

**Unclosed Safe Tag**  
Should simply auto-close at the end of its block context.
```markdown
Hello <a href="https://example.com"> Unclosed link starts here.
Everything after is safely confined.
```

**Unclosed Dangerous Tag**  
Warning: Often hides/swallows text immediately following the tag because the browser initially parses the rest of the node as part of the disallowed tag, which DOMPurify subsequently deletes entirely.
```markdown
Hello <script> alert("I truncated this text");
Everything after this point might vanish in Preview mode because there is no closing script tag!
```
