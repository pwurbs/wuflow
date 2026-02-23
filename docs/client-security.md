# Security

## Authentication Cookies

Both auth cookies (`wf_access_token`, `wf_refresh_token`) are set with hardened flags:

| Flag | Value | Effect |
|------|-------|--------|
| `HttpOnly` | `true` | Cookie inaccessible to JavaScript — prevents token theft via XSS |
| `Secure` | configurable (default `true`) | Transmitted over HTTPS only — see [Secure Cookie option](#secure-cookie-option) |
| `SameSite` | `Strict` | Cookie never sent in cross-site requests — prevents CSRF |
| `MaxAge` | 900 s / 86400 s | Access token expires after 15 min, refresh token after 24 h |

### Secure Cookie Option

For internal networks without a reverse proxy (plain HTTP), the `Secure` flag can be disabled:

```sh
# Command-line flag
./wuflow --secure-cookie=false

# Environment variable
WF_SECURE_COOKIE=false ./wuflow
```

Default is `true`. The active value is printed at startup: `Secure cookies: true/false`.

---

## HTTP Security Headers

All responses include the following headers, set in `SecurityHeadersMiddleware` (`backend/server.go`):

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | see below | Restricts resource origins, prevents XSS and clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing attacks |
| `X-Frame-Options` | `DENY` | Blocks framing in older browsers (belt-and-suspenders with CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer header leakage |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` | Disables unused browser features |
| `X-XSS-Protection` | `0` | Disables the legacy XSS filter (per OWASP; CSP handles XSS) |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS for one year — emitted only when `WF_SECURE_COOKIE=true` (the default) |

### Content Security Policy

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

Notable points:
- `'unsafe-inline'` is present in `style-src` — required because JavaScript sets dynamic inline styles for user-defined label colors (`element.style.backgroundColor/color/border`). These hex values come from the database and cannot be expressed as predefined CSS classes. Eliminating `'unsafe-inline'` entirely would require server-side nonce injection, which is out of scope.
- No `'unsafe-inline'` or `'unsafe-eval'` in `script-src` — the strict limit that actually matters for XSS
- `frame-ancestors 'none'` prevents clickjacking (equivalent to `X-Frame-Options: DENY`)
- HSTS (`Strict-Transport-Security`) is emitted by the application when `WF_SECURE_COOKIE=true` (the default). HTTP-only deployments (e.g. access via internal networks only, which sets `WF_SECURE_COOKIE=false`) should not receive this header due to lack of TLS

---

## Request Middleware

| Middleware | Protection |
|------------|------------|
| `LimitBodyMiddleware` | Caps request body at 32 KB — prevents memory exhaustion |
| `RequireJSONMiddleware` | Enforces `Content-Type: application/json` on POST/PUT |
| `ValidatePathMiddleware` | Rejects API requests with query parameters |
| `AuthMiddleware` | Validates JWT from cookie; returns 401 if missing or invalid |
