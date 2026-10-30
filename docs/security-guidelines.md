# Security Guidelines

The security rules wuFlow's code follows and the risks the project has deliberately accepted.

## General Rules

### Authorization and validation

- The backend enforces authorization, validation and ownership; frontend checks are UX only.
  Role-restricted routes run through a factory whose role check comes first (only
  `/api/auth/me` and `/api/version` are open to every logged-in user), and project-scoped
  queries filter by both `id` and `project_id` (wrong project → `404`).
  → [Backend Architecture](backend-architecture.md), [User Management](user-management.md)
- Validation limits are defined in `backend/validation.go` and mirrored in
  `static/js/validation-config.js`. → [Input Validation](input-validation.md)
- All SQL lives in `backend/db.go` and takes values only as `?` parameters; queries are never
  assembled from input.

### Rendering untrusted content

- Markdown (descriptions, comments) is stored raw and sanitized at render time in the frontend
  (`renderMarkdown`: marked + DOMPurify). Every new renderer of these fields needs its own
  sanitization. → [Markdown Security](markdown-security.md)
- Plain text is rendered with `textContent` or `escapeHtml`; the backend additionally strips HTML
  tags from plain-text fields. User data goes into `innerHTML` unescaped only when the backend
  restricts it to a safe pattern (today only column names). → [Input Validation](input-validation.md)
- Every response carries the security headers (`nosniff`, `X-Frame-Options: DENY`, HSTS when
  `Secure` is on) and a strict CSP: no `'unsafe-inline'`/`'unsafe-eval'` in `script-src`, no
  external origins. → [Client Security](client-security.md)

### Cookies and CSRF

- Auth tokens live only in `HttpOnly`, `SameSite=Strict` cookies (`Secure` by default), never in
  JavaScript-readable storage or response bodies. → [Client Security](client-security.md)
- CSRF protection is `SameSite=Strict` plus the JSON content-type requirement for POST/PUT plus
  no CORS headers — no CSRF tokens (see [I2](#i2--no-csrf-token-protection-relies-on-browser-rules)).

### Secrets

- Secrets (passwords, password hashes, session/JWT tokens, the secret key) never appear in API
  responses, logs or error messages. Model fields holding them carry `json:"-"`. Identifiers may
  be logged (e.g. a short prefix of the session lookup key), the secret part of a token never.
- The app stores only derived values: bcrypt hashes for passwords, HMAC digests for refresh-token
  secrets. The secret key is only used to derive keys and is never written anywhere by the app.
  → [User Management](user-management.md)
- Shipped deployments pass secrets as environment variables (Docker, Helm `secretKeyRef`), not as
  CLI flags (see [I5](#i5--secrets-accepted-via-cli-flags)).

### Errors and logging

- The client gets only fixed messages: validation errors, `errMsg…` constants or literal texts.
  The text of an internal error goes only to the log; the client gets `errMsgInternalServerError`.
- Logging goes through `LogDebug`/`LogInfo`/`LogWarn`/`LogError` (JSON, which neutralizes injected
  newlines); `fmt`/`log` only for startup output.
- Log lines may carry user email, user ID, client IP and resource IDs/names (audit trail, see
  [I7](#i7--personal-data-in-logs)); never issue content (titles, descriptions, comments) or credentials.

### Authentication and abuse protection

- No default credentials: the first start requires an initial admin password. Passwords have at
  least 12 characters and at most 72 bytes (bcrypt's input limit), must not be the email and must
  not contain a blocklisted word.
  → [User Management](user-management.md)
- Every API request is limited: 32 KB body, no query parameters, 5 s timeout; the server closes
  connections after 15 s read/write time.
- `POST /api/auth/login` is rate-limited per IP and per IP+email, `POST /api/auth/refresh` per IP,
  write requests per user; the per-IP limits count an IPv6 client per /64. Login returns one
  generic error and equal timing for wrong password, unknown and inactive users. → [User Management](user-management.md)
- Code gets the client IP (rate limits, logs) only via `GetClientIP`, which trusts the
  client-IP header only from trusted proxies (see [I1](#i1--private-networks-are-trusted-proxies-by-default)).
- Password, role and email changes, deactivation and deletion revoke the user's sessions; sensitive admin
  actions require the admin's own password. → [User Management](user-management.md)

### Dependencies and deployment

- No outgoing connections and no telemetry; frontend libraries are bundled at build time, never
  loaded from a CDN (`connect-src 'self'` as backstop).
- Few dependencies; no new runtime dependency without the maintainer's approval. `gosec` and
  `govulncheck` run in `scripts/go_checks.sh`. → [scripts/README](../scripts/README.md)
- TLS, HTTP/2 and compression belong in the reverse proxy. → [Deployment "Reverse proxy"](deployment.md#reverse-proxy)
- The container runs as the non-root user `appuser`.

## Accepted Issues

### I1 — Private networks are trusted proxies by default

- **Risk**: With `WF_REMOTE_IP_HEADER` set, every host in a private range (`10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`, loopback) counts as a trusted proxy. Such a host —
  any pod in the cluster, or a LAN client, directly or through a proxy that appends to the header —
  can set its own client IP. That bypasses the IP-based login and refresh limits and falsifies request logs.
  Clients outside the private ranges can't do this: their header is ignored, and entries they add
  in front of a proxy's entry are skipped.
- **Why accepted**: The default works without configuration for a proxy on the same host, in a
  Docker network or in a Kubernetes cluster; an attacker needs a foothold in the private network.
- **Mitigation**: Narrowing `WF_TRUSTED_PROXIES` (e.g. to the ingress pod CIDR or the proxy's address)
  closes both paths. Exposing wuFlow's port only to the proxy ([Deployment "Client IP"](deployment.md#client-ip)) closes only the
  direct one.
- **Revisit if**: IP-based limits gain more weight (e.g. account lockout).

### I2 — No CSRF token; protection relies on browser rules

- **Risk**: None known — this is a conscious decision. Reviewers and scanners often flag a missing
  CSRF token; wuFlow relies on three overlapping browser rules instead.
- **Why decided**: The three rules under *Mitigation* already block every way a foreign web page
  can send a request with the user's cookies. A token would block the same requests again, at the
  cost of extra code and server-side state.
- **Mitigation**: `SameSite=Strict` cookies; `Content-Type: application/json` for POST/PUT (HTML
  forms can't send it); no CORS headers (script requests from other sites are blocked).
- **Revisit if**: CORS headers are added, `SameSite` is relaxed, or a non-JSON write endpoint is
  introduced (e.g. file upload for attachments).

### I3 — `Secure` cookie flag can be disabled

- **Risk**: With `WF_SECURE_COOKIE=false`, auth cookies travel over plain HTTP. The Home Assistant
  add-on ships with this setting (local network access on port 5555).
- **Why accepted**: HTTP-only intranet deployments are a supported use case.
- **Mitigation**: `Secure` is on by default; README and [Client Security](client-security.md)
  limit `false` to trusted internal networks.
- **Revisit if**: HTTP-only deployments are no longer supported, or the add-on gets HTTPS.

### I4 — Sliding session expiry without an absolute lifetime cap

- **Risk**: Every refresh resets the session expiry, so a session used at least once per 24 h
  never expires.
- **Why accepted**: Users stay logged in while active; idle sessions still end after 24 h.
- **Mitigation**: Refresh-token rotation with reuse detection revokes all of the user's sessions on
  mismatch.
- **Revisit if**: a maximum session lifetime is required, or the refresh-token lifetime is raised.

### I5 — Secrets accepted via CLI flags

- **Risk**: `--secret-key` and `--initial-admin-password` are visible in process listings on shared
  hosts.
- **Why accepted**: Flags are convenient for local runs; every setting is also available as an
  environment variable.
- **Mitigation**: Docker image, Helm chart and Home Assistant add-on use environment variables.
- **Revisit if**: a shipped deployment starts passing secrets as flags.

### I6 — Access tokens stay valid up to 15 minutes after revocation

- **Risk**: The JWT is checked without a database lookup. After logout or a change that revokes
  sessions (deactivation, deletion, role, password or email change), an already-issued access token keeps
  working — with its old role — until it expires. For a deleted user, writes fail during that time
  (the user no longer exists for the foreign keys), reads still work.
- **Why accepted**: Inherent trade-off of stateless JWTs; the window is bounded by the 15-minute TTL.
- **Mitigation**: Short TTL; the next refresh fails because the sessions are revoked.
- **Revisit if**: the access-token TTL is raised, or a change must take effect immediately (e.g.
  per-project membership).

### I7 — Personal data in logs

- **Risk**: Logs contain personal data: the acting user's email on most actions, the client IP of
  every request, and the submitted email on failed logins — for unknown users exactly as typed,
  which may be a typo or a password entered in the wrong field.
- **Why accepted**: The log is the audit trail of who did what; wuFlow is self-hosted, so logs stay
  on the operator's infrastructure.
- **Mitigation**: No issue content in logs, and no credentials apart from the mistyped case above;
  log retention and access are the operator's responsibility.
- **Revisit if**: wuFlow is offered as a hosted or multi-tenant service, or logs are shipped to
  third parties by the app.

### I8 — `'unsafe-inline'` in the CSP for styles

- **Risk**: None known — a conscious decision that scanners flag. Scripts are not affected, and
  user Markdown can't carry a `style` attribute (DOMPurify strips it).
- **Why decided**: Label colors are user-defined and set as inline styles; removing
  `'unsafe-inline'` would need a nonce per response.
- **Mitigation**: `script-src` stays without `'unsafe-inline'`.
- **Revisit if**: inline styles can be replaced by CSS classes or custom properties.

### I9 — Session refresh on page loads is not rate-limited

- **Risk**: A page load without a valid access token refreshes the session from the refresh-token
  cookie without the per-IP limit of `POST /api/auth/refresh`. Anyone can send unlimited requests
  that each cause one database lookup by session token (malformed cookies fail before the lookup).
- **Why accepted**: No brute-force risk: the session token is random (`rand.Text()`, at least
  128 bit) and the secret is checked by HMAC. The lookup is an indexed read, about as cheap as
  serving the login page, which is not limited either. A limit here would send legitimate users to
  the login page when their IP shares the budget with others (NAT, API refreshes).
- **Mitigation**: Protection against request floods is a job for the reverse proxy.
- **Revisit if**: the refresh on page loads gets more expensive (more queries, hashing), or the
  session token gets shorter or guessable.
