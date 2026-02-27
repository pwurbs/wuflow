# Description Field Management

## Overview
The description field in wuFlow natively supports Markdown to allow rich-text formatting while mitigating XSS (Cross-Site Scripting) risks. This document summarizes the approach, the end-to-end data flow, supported mappings, and provides test cases for validating the implementation.

## End-to-End Flow (Input to Rendering)

1. **User Input (Client)**
   - The user inputs text, including Markdown formatting, into the description editor on the frontend.
   - The editor provides a preview mode by parsing the raw Markdown.
2. **Backend Storage**
   - The payload is sent to the backend API.
   - The backend treats the description strictly as plain Markdown text.
   - **No regex-based HTML filtering** (like `sanitizeHTML`) is applied. The backend evaluates constraints using simple character counts.
   - The raw Markdown text is stored in the database exactly as submitted.
3. **Retrieval and Client-Side Rendering**
   - Clients retrieve the raw Markdown string via the API.
   - **Parsing**: The `marked` library converts the Markdown string into raw HTML (GitHub Flavored Markdown is enabled).
   - **Sanitization**: The raw HTML is passed through `DOMPurify` (in `markdown.js`), which acts as an air-tight security boundary.
   - The safe, purified HTML is then injected into the DOM for viewing.

## Supported Markdown & HTML Mappings

Through our `PURIFY_CONFIG` via DOMPurify, only a strict subset of HTML elements produced by Markdown or embedded HTML is allowed. All other tags and potentially dangerous attributes (e.g., event handlers or `javascript:` / `data:` URIs) are completely stripped.

| Markdown Feature      | Resulting HTML Tag | Status in DOMPurify |
|-----------------------|--------------------|---------------------|
| Headings (`#`, `##`)  | `<h1>` to `<h6>`   | **Allowed**         |
| Bold (`**`)           | `<b>`, `<strong>`  | **Allowed**         |
| Italic (`*`)          | `<i>`, `<em>`      | **Allowed**         |
| Strikethrough (`~~`)  | `<s>`, `<del>`     | **Allowed**         |
| Lists (`-`, `1.`)     | `<ul>`, `<ol>`, `<li>` | **Allowed** |
| Paragraphs / Linebreaks | `<p>`, `<br>`     | **Allowed**         |
| Links (`[text](url)`) | `<a>`              | **Allowed** (Attributes: `href`, `title`, `target`, `rel`) |
| Code (`inline`, block)| `<code>`, `<pre>`  | **Allowed**         |

---

## Testing Scenarios

Copy and paste the sections below into an Issue/Task description field to visually verify that rendering and security policies are applied correctly.

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

\```javascript
// Block code
console.log("Hello World");
\```
```

### 🟡 2. Allowed Embedded HTML
Tests manual HTML tags that are explicitly permitted by our `PURIFY_CONFIG` (e.g., custom manual HTML in Markdown text). These should render seamlessly **without** triggering a security alert.

```markdown
Hello <b>Bold HTML</b> and <i>Italic HTML</i>.

Check out this <a href="https://example.com" target="_blank" rel="noopener">Allowed Link</a>.

<p>A standard paragraph tag.</p>

<ul>
  <li>HTML List Item</li>
</ul>
```

### 🔴 3. Disallowed HTML (Security Stripping Test)
Tests tags and attributes that must be stripped for security. This **should** trigger the "Unsupported HTML tags are not rendered for security" warning toast in the client.

**Disallowed Tags**:
```markdown
Warning: <script>alert('XSS!')</script> should be stripped.

Check this <iframe src="https://malicious.site"></iframe> out.

<style>body { background: red; }</style> Styling is blocked.
```

**Disallowed Attributes & Schemes**:
```markdown
Link with a bad attribute: <a href="https://example.com" onclick="alert(1)">Click Me</a>

Malicious Link: [Don't click](javascript:alert('XSS'))
```

### 🟠 4. Unclosed Tags
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
