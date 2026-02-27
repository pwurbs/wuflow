# Input Validation

## Overview
Input validation in wuFlow ensures data integrity and security by enforcing constraints on user inputs at both the client-side (UX) and server-side (Security) layers.

## Validation Strategy
1.  **Client-Side (Frontend)**:
    - Provides immediate feedback to users.
    - Uses HTML5 attributes (`maxlength`, `required`, `type="email"`) for basic constraints.
    - JavaScript logic handles complex rules (e.g., password strength) and displays error toasts.
    - Prevents invalid requests from being sent to the server.

2.  **Server-Side (Backend)**:
    - The source of truth for data integrity.
    - Validates all incoming data before processing.
    - Uses `utf8.RuneCountInString` to correctly handle multi-byte characters (emojis, international text).
    - Returns descriptive HTTP 400 Bad Request errors if validation fails.

## Key Limits
| Field | Limit | Reasoning |
|---|---|---|
| **Issue/Task Title** | 100 chars | Encourages concise summaries. |
| **Description** | 5,000 chars | Allows detailed content while preventing excessive payload sizes. |
| **Label Name** | 15 chars | UI space constraints (chips/tags). |
| **User Name** | 50 chars | Accommodates most names without layout breakage. |
| **Search Filter** | 50 chars | Prevents performance issues and UX breakdown during string matching. |
| **Email** | 254 bytes | RFC 5321 standard limit. |
| **Planned Dates** | 100 entries | Prevents unbounded array iteration; each entry must be a valid `YYYY-MM-DD` date. |

## Description Sanitization
To prevent XSS while allowing rich text editing, the description field now uses Markdown natively instead of HTML.

### Backend Validation Layer
The backend treats description content as plain Markdown text. It evaluates length constraints directly based on character (rune) counts. Unlike other plain-text fields, **no regex-based HTML filtering (`sanitizeHTML`) is applied** to the description on the backend. The raw Markdown (including any embedded HTML supplied by the user) is saved directly to the database.

### Frontend Sanitization Layer
The frontend acts as the single security boundary for rendering descriptions. When retrieving an issue or task:
1.  **Markdown Parsing**: The `marked` library converts the raw Markdown string into HTML.
2.  **DOMPurify Sandbox**: The output is strictly sanitized by DOMPurify before being inserted into the DOM.
    - **Allowed**: Basic formatting (`h1`-`h6`, `b`, `strong`, `i`, `em`, `s`, `del`, `p`, `br`), lists (`ul`, `ol`, `li`), links (`a`), and code blocks (`code`, `pre`).
    - **Stripped**: Dangerous tags (e.g., `<script>`, `<iframe>`, `<img>`), unapproved attributes, and links using `javascript:` or `data:` URIs.

This ensures that even if malicious or unsanitized content is stored in the database, it cannot cause XSS when evaluated in the browser.

## Plain-Text Sanitization
As a defense-in-depth measure, the backend automatically strips ALL HTML tags and NUL bytes (`\x00`) from fields intended to be plain-text:
- **Issue/Task**: Title
- **Label**: Name
- **User**: First Name, Last Name

NUL bytes are stripped first (before tag removal) because they are used internally as sentinel delimiters inside `sanitizeHTML`; allowing them through would corrupt the description sanitization pipeline.

This prevents malicious markup from being stored or accidentally rendered in these fields.

### Frontend Defense-in-Depth
Even with backend stripping, the frontend applies additional layers of protection:
1.  **Escaping**: Fields like titles and names are rendered using `textContent` or `escapeHtml()` to ensure residual characters (like `<` or `>` missed by the backend's `anyTagRegex`) are treated as literals.
2.  **Plain-Text Previews**: When generating plain-text previews of rich descriptions (e.g., in the Backlog), the frontend uses `stripMarkdown()`. This function relies on `renderMarkdown(md)` to create fully sanitized HTML via DOMPurify, and then extracts raw text using an inert `div` element via `textContent`. This guarantees unclosed embedded tags cannot break the outer page structure while safely converting the Markdown snippet for display.


## Link Validation
When creating links via the editor toolbar or during sanitization:
- **Restricted Schemes**: `javascript:`, `data:`, and `vbscript:` URIs are explicitly rejected.
- **Protocol Enforcement**: Links without a protocol are automatically prefixed with `https://`.
- **Target Safety**: Links are rendered with `target="_blank" rel="noopener noreferrer"` to open in a new tab and prevent reverse tabnapping attacks.

## Error Handling
- Frontend catches API errors and displays them in structured toast notifications.
- Setup view errors use the main application toast.
- Modal errors use a dedicated toast within the modal context (except for Setup/Label/User management which uses main toast).
