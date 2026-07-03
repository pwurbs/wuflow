# Security Audit Report by Fable

| | |
|---|---|
| **Date** | 2026-07-03 |
| **Scope** | CSRF protection, authentication & session handling, cookie flags, telemetry, dependencies with known CVEs |
| **Baseline** | branch `feature/1.3.2`, commit `1299256` |
| **Method** | Manual code review, `govulncheck ./...`, `npm audit` (static/js), git history inspection |
| **Model** | Fable |

**Result: strong security posture.** No high-severity issues. One deployment-dependent
risk is accepted and mitigated by documentation; five low-severity observations are
recorded as known and accepted. This report serves as a baseline for future audits.

---

## Accepted risk

### A1 — Client IP from proxy header trusts the leftmost `X-Forwarded-For` entry

`GetClientIP` (`backend/utils.go:48`) takes the **leftmost** entry of the header
configured via `WF_REMOTE_IP_HEADER`:

```go
firstIP := strings.TrimSpace(strings.SplitN(headerIP, ",", 2)[0])
```

The leftmost `X-Forwarded-For` entry is client-supplied and therefore forgeable unless
the outermost proxy sets the header authoritatively. If a deployer configures
`WF_REMOTE_IP_HEADER` behind a proxy that *appends* to (rather than overwrites) a
client-supplied header, an attacker could rotate fake IPs to bypass the per-IP login
brute-force limiter (`backend/ratelimit.go:9`), the per-IP+email limiter
(`backend/ratelimit.go:10`), and the refresh limiter (`backend/handlers.go:1043`), and
could poison the request logs. The default configuration (header unset, IP taken from
`r.RemoteAddr`) is not affected.

**Decision: accepted, mitigated by deployment documentation.** README ("Reverse Proxy"
section) and the wiki Deployment page explicitly require blocking direct access to
wuFlow's port and configuring the outermost proxy to set the header authoritatively,
with per-proxy instructions (Nginx `$remote_addr`, Traefik `trustedIPs`, Cloudflare).
Multi-entry header chains are intentionally supported for the CDN scenario, so rejecting
multi-IP values in code would break documented deployments. Alternatives considered and
declined: a `WF_TRUSTED_PROXIES` CIDR list with right-to-left parsing (Express/Rails
style) — adds configuration surface without benefit for the documented topologies.

Residual note:
- A violated proxy contract fails silently; no runtime detection of such a
  misconfiguration is possible, because a forged header entry is indistinguishable
  from a legitimate multi-entry CDN chain from inside the app.

---

## Low-severity observations (known, accepted)

### L1 — No CSRF-token middleware; protection relies on SameSite + content-type gate

No token/synchronizer CSRF middleware exists (verified: no CSRF reference anywhere in
backend or frontend). The actual, layered defenses:

- `SameSite=Strict` on both auth cookies (`backend/auth.go:223`) — browsers never send
  the cookies on cross-site requests.
- JSON content-type required for POST/PUT (`backend/server.go:407-412`) — HTML forms
  cannot send `application/json`, which also blocks login CSRF.
- No CORS headers are set anywhere, so cross-origin `fetch` with credentials fails the
  preflight/response check; DELETE (not covered by the JSON gate) is preflight-gated.

Acceptable by modern standards; noted because the protection relies entirely on browser
enforcement rather than an app-level token.

### L2 — `Secure` cookie flag is runtime-disableable; no `__Host-` prefix

`backend/auth.go:226-228` allows `Secure` to be disabled via `WF_SECURE_COOKIE=false`
(default `true`; intended for HTTP-only intranet deployments — HSTS is correctly
suppressed in the same mode, `backend/server.go:487-491`). Cookie names
(`wf_access_token`, `wf_refresh_token`, `backend/auth.go:33-34`) carry no `__Host-`
prefix. See `docs/client-security.md` for the deployment guidance covering this.

### L3 — Sliding session expiry without an absolute lifetime cap

`backend/auth.go:462` resets `ExpiresAt` on every refresh, so a session used at least
once per 24 h never expires. Mitigated by refresh-token rotation with reuse detection
that revokes all of a user's sessions on mismatch (`backend/auth.go:426-435`).

### L4 — Secrets accepted via CLI flags

`--secret-key` and `--initial-admin-password` (`main.go:55-56`) are visible in process
listings on shared hosts. Environment-variable alternatives exist and are what the
Docker image and Helm chart use (`chart/templates/deployment.yaml:44-51` uses
`secretKeyRef`).

### L5 — Access tokens outlive logout/deactivation by up to 15 minutes

Logout revokes the session and clears cookies (`backend/handlers.go:989-994`), but
already-issued JWTs remain valid until their 15-minute TTL expires
(`backend/auth.go:30`). Inherent stateless-JWT tradeoff, bounded by the short TTL.

---

## Clean areas (checked, no findings)

### Telemetry — none

"Telemetry" here means any code that sends data to a third-party server: usage
analytics, crash reporting, phone-home version checks. wuFlow contacts nothing but
itself:

- The Go backend contains no outbound HTTP client calls at all (no `http.Get`,
  `http.Post`, or `http.NewRequest` outside test files) — the server only *answers*
  requests, it never initiates connections to other servers.
- Every `fetch()` in the frontend targets the app's own API via relative paths like
  `/api/auth/login` (`static/js/api.js`, `static/js/login.js`) — never an external URL.
- No analytics SDKs (Google Analytics, Sentry, PostHog, …) and no external URLs in
  `index.html` / `login.html`.
- DOMPurify and marked are shipped inside the repo (`static/js/vendor/`) instead of
  being loaded from a CDN, so even loading the page contacts no third party.
- Backstop: the Content-Security-Policy sets `connect-src 'self'`
  (`backend/server.go:480-481`), so the browser would refuse to send data to any
  foreign host even if a script tried.

### Dependencies — no known CVEs

- `govulncheck ./...` → "No vulnerabilities found." Versions at audit time: Go 1.25.11,
  `golang-jwt/jwt` v5.3.1, `mattn/go-sqlite3` v1.14.47 (bundling SQLite 3.53.2),
  `golang.org/x/crypto` v0.53.0 — all current.
- `npm audit` in `static/js` → "found 0 vulnerabilities" (prod and dev). Vendored
  DOMPurify 3.4.11 and marked 18.0.5 are current.

### Authentication & session design

bcrypt cost 12 (`backend/auth.go:86`); timing-equalized login including dummy hashing
for unknown/inactive users (`backend/handlers.go:938-953`); JWT algorithm pinned to
HMAC preventing alg-confusion (`backend/auth.go:197`); domain-separated key derivation
so the master key never signs directly (`backend/auth.go:75-81`); refresh-token rotation
with reuse detection and all-session revocation (`backend/auth.go:426-435`);
HMAC-hashed refresh secrets in the database; token length caps; admin-password re-auth
for destructive operations (`backend/handlers.go:56-65`); `PasswordHash json:"-"` never
serialized (`backend/models.go:159`).

### Cookie flags

`HttpOnly: true`, `Path: "/"`, `SameSite=Strict`, `Secure` default-on
(`backend/auth.go:216-230`). See L2 for the configurable `Secure` flag and
`docs/client-security.md` for the full flag table.

### XSS

Markdown is rendered through a DOMPurify allowlist (`static/js/markdown.js:68`). The one
unescaped template interpolation (`static/js/components/board.js:37`, column
`displayName`) is constrained server-side to `^[a-zA-Z0-9]+( [a-zA-Z0-9]+)*$`
(`backend/validation.go:77`) and is not exploitable.

### Repository hygiene

`deploy/secrets.dev.yaml` (plaintext dev secrets) and local `*.db` files exist on
developer machines but are gitignored (`.gitignore`) and were never committed
(`git log --all -- 'deploy/secrets.*'` is empty). The Docker image runs as the non-root
`appuser` (`Dockerfile:63`).
