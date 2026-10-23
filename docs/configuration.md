# Configuration
Each option can be set as a command-line flag or an environment variable. Flags win over environment variables, which win over the defaults.

| Option | Environment variable | Flag | Default | Description |
|---|---|---|---|---|
| HTTP Port | `WF_PORT` | `-port` | `8080` | Port of the web server. |
| Database Path | `WF_DBPATH` | `-dbpath` | `wuflow.db` | Path and name of the SQLite file. |
| Secret Key | `WF_SECRET_KEY` | `-secret-key` | *random* | Signs the JWTs and hashes the session tokens, see [Secret key](#secret-key). |
| Admin Email | `WF_INITIAL_ADMIN_EMAIL` | `-initial-admin-email` | `admin@local` | Email of the first sysadmin, see [Initial admin](#initial-admin). |
| Admin Password | `WF_INITIAL_ADMIN_PASSWORD` | `-initial-admin-password` | *none* | Password of the first sysadmin. **Required on the first start**, see [Initial admin](#initial-admin). |
| Log Level | `WF_LOG_LEVEL` | `-log-level` | `info` | `debug`, `info`, `warn` or `error`. |
| Secure Cookie | `WF_SECURE_COOKIE` | `-secure-cookie` | `true` | Sends the auth cookies over HTTPS only, see [Secure cookie](#secure-cookie). |
| API Rate Limit | `WF_API_RATE_LIMIT` | `-api-rate-limit` | `true` | Per-user API rate limiting to prevent abuse. |
| Remote IP Header | `WF_REMOTE_IP_HEADER` | `-remote-ip-header` | *none* | Header with the client IP behind a reverse proxy, e.g. `X-Forwarded-For` or `CF-Connecting-IP`, see [Client IP](deployment.md#client-ip). |
| Trusted Proxies | `WF_TRUSTED_PROXIES` | `-trusted-proxies` | loopback and private ranges | Comma-separated CIDRs or IPs of the proxies whose Remote IP Header is used. Only takes effect if Remote IP Header is set. A set value replaces the default list, see [Client IP](deployment.md#client-ip). |

## Initial admin
Initial admin email and password are **only** used on the first start, to create the first sysadmin user in the database. The email can stay at its default, but the password **must** be set and comply with the password policy (at least 12 characters, at most 72 bytes, no common passwords). Otherwise the app doesn't start. Email and password can be changed later in the user settings.

## Secret key
If the secret key isn't set, a random key is generated on every start, which ends all sessions and forces users to log in again. For sessions that survive restarts, set a stable key: at least 32 characters, a high-entropy random string, stored securely. **A revealed or compromised key compromises the security** of the entire application.

## Secure cookie
Keep Secure Cookie **enabled** in production. Otherwise the security-relevant cookies may be sent over unencrypted connections. The Secure flag requires TLS, so wuFlow has to run behind a TLS-terminating [reverse proxy](deployment.md#reverse-proxy). Disable it only for local tests or internal, trustworthy HTTP networks.

## Timing parameters
These are fixed at defaults that need no tuning for typical deployments.

- *Server (transport layer):*
  - `ReadTimeout` — **15 s**: maximum time to read the full HTTP request (headers + body).
  - `WriteTimeout` — **15 s**: maximum time to write the full HTTP response.
  - `IdleTimeout` — **60 s**: closes keep-alive connections that have been idle.
- *Server (application layer):*
  - Request timeout — **5 s**: per-request deadline propagated through all database calls. A slow or blocked query is cancelled rather than held open indefinitely.
  - Graceful shutdown drain — **15 s**: maximum time the server waits for in-flight requests to finish after receiving `SIGTERM`.
- *Session / authentication:*
  - JWT access token — **15 min**: short-lived token embedded in the auth cookie.
  - Refresh token — **24 h**: backs the persistent session and is renewed automatically on each access-token refresh.
