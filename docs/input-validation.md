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

## Description Sanitization
To prevent XSS while allowing rich text:
- The backend sanitizes all issue descriptions using a custom regex-based sanitizer (`sanitizeHTML`).
- **Allowed**: Basic formatting (`<b>`, `<i>`, `<u>`, `<p>`, `<br>`), lists (`<ul>`, `<ol>`, `<li>`), and safe links (`<a>` with `href` attribute only).
- **Stripped**: All other tags (e.g., `<script>`, `<iframe>`, `<img>`, headers), event handlers, and links using `javascript:` or `data:` URIs.
- **Malformed HTML**: Unmatched or unwhitelisted tags are stripped without structural correction.

### Frontend Sanitization Layer
As a second layer of defense, the frontend applies `sanitizeDescription()` (using `DOMParser`) when rendering description content in the editor. This ensures that even if unsanitized content reached the database, it is cleaned before being rendered in a dangerous context.

## Plain-Text Sanitization
As a defense-in-depth measure, the backend automatically strips ALL HTML tags from fields intended to be plain-text:
- **Issue/Task**: Title
- **Label**: Name
- **User**: First Name, Last Name

This prevents malicious markup from being stored or accidentally rendered in these fields.

### Frontend Defense-in-Depth
Even with backend stripping, the frontend applies additional layers of protection:
1.  **Escaping**: Fields like titles and names are rendered using `textContent` or `escapeHtml()` to ensure residual characters (like `<` or `>` missed by the backend's `anyTagRegex`) are treated as literals.
2.  **Plain-Text Previews**: When generating plain-text previews of rich descriptions (e.g., in the Backlog), the frontend uses `stripHtml()`. This function utilizes `DOMParser` in an inert context to safely extract text content, which protects against unclosed tags that might bypass the backend's regex-based sanitization.


## Link Validation
When creating links via the editor toolbar or during sanitization:
- **Restricted Schemes**: `javascript:`, `data:`, and `vbscript:` URIs are explicitly rejected.
- **Protocol Enforcement**: Links without a protocol are automatically prefixed with `https://`.
- **Target Safety**: Links are rendered with `target="_blank" rel="noopener noreferrer"` to open in a new tab and prevent reverse tabnapping attacks.

## Error Handling
- Frontend catches API errors and displays them in structured toast notifications.
- Setup view errors use the main application toast.
- Modal errors use a dedicated toast within the modal context (except for Setup/Label/User management which uses main toast).
