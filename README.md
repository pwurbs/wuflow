# wuFlow

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) 
[![GitHub Release](https://img.shields.io/github/v/release/pwurbs/wuflow)](https://github.com/pwurbs/wuflow/releases) 
[![GitHub issues](https://img.shields.io/github/issues/pwurbs/wuflow)](https://github.com/pwurbs/wuflow/issues)  <br>
[![Codeberg](https://img.shields.io/badge/codeberg-pwurbs%2Fwuflow-blue)](https://codeberg.org/pwurbs/wuflow)
[![Go Version](https://img.shields.io/github/go-mod/go-version/pwurbs/wuflow)](https://github.com/pwurbs/wuflow) 
[![Container Image](https://img.shields.io/badge/ghcr.io-image-blue?logo=docker)](https://github.com/pwurbs/wuflow/pkgs/container/wuflow)
[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/wuflow)](https://artifacthub.io/packages/search?repo=wuflow) <br>
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=alert_status)](https://sonarcloud.io/dashboard?id=wuflow-oss) 
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=coverage)](https://sonarcloud.io/dashboard?id=wuflow-oss) 
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=wuflow-oss) 
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=bugs)](https://sonarcloud.io/dashboard?id=wuflow-oss)

<img src="static/logo.png" alt="wuFlow Logo" width="100">

## Why another Agile board?
For me, Jira was the gateway to Agile methodology. I rely on Kanban everywhere—from professional DevOps teams to organizing my family life. But when Atlassian discontinued server licenses and forced a move to the cloud, I had to find an alternative. Jira had already become too expensive and morphed into a bloated "Moloch": complex to configure, burdened by long startup times, and plagued by frequent security updates for features we didn't even use.

I spent some time exhaustively testing self-hosted alternatives, hoping to find a replacement. Find the full tool comparison results here: <br>
[Beyond Jira: Reclaiming Agile Sovereignty with Open Source](https://medium.com/@pwurbs/beyond-jira-reclaiming-agile-sovereignty-with-open-source-14556d709c65).

 **My conclusion? None of them fully met my criteria.** Even the most highly recommended open-source tools suffered from deal-breaking flaws:

- **Missing Agile Core:** Most tools position themselves as Trello substitutes, not Jira replacements. They entirely lack release management (versions/milestones), SCRUM support, and robust backlog management.
- **Security Blind Spots:** Rampant dependency bloat unnecessarily increases the supply chain attack surface. I consistently found missing HTTP security headers (XSS risks), weak token management, and unmaintained packages.
- **No Daily Planning:** No tool successfully combined a classic Kanban workflow with flexible, side-by-side daily time management.

**The Solution: Make it!**

I realized the perfect balance between the structural depth of Jira and the simplicity of a modern board didn't exist. That’s why I started **wuflow**.

wuflow is an attempt to marry a clean, modern UI with the strict requirements of a sovereign, self-hosted agile engine. It is currently in its early stages, built strictly around a security-first and lean philosophy. It isn't a "Jira-killer" for everyone, but it is a definitive step toward true IT sovereignty.

Building wuflow is also a personal experiment to see how far AI-assisted development can go when building a tool from scratch while intentionally keeping the supply chain attack surface as small as possible. Ultimately, I just love making good things that work. There is a deep satisfaction in having full control over the concepts, code, and prioritization to build something that provides genuine value.

## The Result
wuFlow is a modern and lightweight issue tracking and planning application. It is designed to combine the immediate visual overview of a classic Kanban board with structural planning capabilities to help you organize tasks effectively without unnecessary complexity.
This tool wants to help you to organize, balance and track the work in a team to achieve a better **flow** of work by a transparent visualization. This is one of the main intentions of a [Kanban board](https://en.wikipedia.org/wiki/Kanban_board).
The usage is not limited to software development teams, it can be used by any person, group or even families that wants to organize and track their work.

<img src="docs/screenshots/board.png" alt="wuFlow Board" >

We developed this tool having the following goals in mind:
- Create a **modern and lightweight** issue tracking solution focused on the mostly used core functions to ensure a good **flow** of work.
- Can be used **without expensive subscriptions** or being forced into the cloud.
- **Cover the core functions of legacy issue management tools** like Jira.
- **Avoid the complexity of existing solutions** like Jira for more stability, higher security, easy configuration and lower costs. 
- Bridge the gap between **structured Kanban management** and **daily planning**.
- Provide **full topic/task transparency** to a team, group or family.
- Don't rely on **heavy frameworks** or libraries which require dedicated skills and knowledge.
- Ensure **"Security by Design"** through strict headers, CSRF/XSS prevention, and rigorous testing.
- Slim and **modern software architecture** using only Go and Vanilla JavaScript.
- Rely only on **few dependencies** to significantly reduce the **supply chain attack surface**.
- **No tracking**, telemetry or any other "calling home" functions.
- **Easy** to deploy and use.
- **100% Open Source**.

## Features
- **Intuitive Planning & Kanban**: Combine flexible daily planning with a classic Kanban board view to easily organize your workflow side-by-side.
- **Projects**: Projects allow you to separate the visibility of issues for different teams, projects or topics. Each issue belongs to exactly one project.
- **Configurable Board Columns**: Adapt the board per project according to your workflow.
- **Release Management**: Group issues into named, time-boxed releases, track progress with a visual indicator and assign an owner responsible for a release.
- **Subtasks & Deadlines**: Break down larger issues into smaller, actionable tasks or checklists with individual deadlines.
- **Activity & Comments**: Discuss an issue with Markdown comments and track a full, automatic history of every status, field, and task change.
- **Custom Labels**: Categorize and color-code issues with an easy-to-use label management system per project.
- **Advanced Filtering & Search**: Quickly find issues by filtering based on labels, priority, assignees, or text search.
- **Multi-user Support**: Built-in user management with role-based access, allowing safe concurrent editing of issues.
- **Rich Text Markdown Editor**: Write readable issue descriptions using a built-in Markdown editor with formatting tools and live preview.
- **Prioritization & Assignment**: Assign issues directly to specific users, flag important work with High Priority and order the issues per column.
- **Backlog Management**: Use the backlog view to plan your work by sorting issues and assigning them to releases.
- **Issue Archiving**: Keep your active board clean by archiving completed issues for later reference.
- **No dependencies** on external services or libs during runtime. Allows for air-gapped deployments.
- More features to cover core functions for agile teams are coming.

The app is currently only tested to run in the Chrome browser.

## Dependencies
As a contrast to the other tools, the supply chain is radically minimal. The production runtime ships:
- Go binary with embedded assets
- A few Go packages
- 2 JS libraries: dompurify and marked — Rather than being reimplemented, these were deliberately chosen to leverage years of community scrutiny and proven security. Their exact versions are pinned in `package-lock.json`, and they are bundled into the frontend at build time, ensuring no external dependencies are loaded at runtime. 

The frontend is bundled by Vite, the only build tool beyond Go; it runs at build time and is not part of the runtime.

Maintaining such a minimal dependency count is remarkable for a full-stack application in 2026. While this lean approach is currently unconventional, I believe it could represent a trend enabled by AI-assisted development. By leveraging AI to build logic rather than importing heavy third-party libraries, this project explores a new development paradigm. This 'make-over-buy' strategy is a deliberate security choice, designed to eliminate the risks inherent in modern, over-bloated dependency trees. Supply chain attacks (Log4j, polyfill.io or the XZ Utils backdoors) or unintended security flaws (like React2Shell) have proven that every dependency is a potential liability. Let’s see how successful this strategy proves to be. 

## Configuration
Configuration is done by either Envvar or command line argument using the following priority (highest to lowest):
1. Command-line flags (e.g., `-port 8080`)
2. Environment variables (e.g., `WF_PORT=8080`)
3. Internal default values

**Configuration options:**

| Title | Envvar name | argument name | Default | short description |
|---|---|---|---|---|
| HTTP Port | `WF_PORT` | `-port` | `8080` | The port to run the web server on. |
| Database Path | `WF_DBPATH` | `-dbpath` | `wuflow.db` | The path and name of the SQLite file. |
| Secret Key | `WF_SECRET_KEY` | `-secret-key` | *Random* | Used for JWT signing and session token hash. |
| Admin Email | `WF_INITIAL_ADMIN_EMAIL` | `-initial-admin-email` | `admin@local` | Email for the first sysadmin user created on initial startup. |
| Admin Password | `WF_INITIAL_ADMIN_PASSWORD` | `-initial-admin-password` | *None* | Password for the first sysadmin user. **Must be provided on first run.** |
| Log Level | `WF_LOG_LEVEL` | `-log-level` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`). |
| Secure Cookie | `WF_SECURE_COOKIE` | `-secure-cookie` | `true` | Restricts auth cookies to HTTPS. Disable (`false`) only for internal HTTP networks. |
| API Rate Limit | `WF_API_RATE_LIMIT` | `-api-rate-limit` | `true` | Enables per-user API rate limiting to prevent abuse. |
| Remote IP Header | `WF_REMOTE_IP_HEADER` | `-remote-ip-header` | *None* | HTTP header with the client IP behind a reverse proxy (e.g. `X-Forwarded-For`, `CF-Connecting-IP`). Used only if the direct peer is a trusted proxy; the client is the rightmost entry that isn't a trusted proxy, see [Reverse Proxy](#reverse-proxy). |
| Trusted Proxies | `WF_TRUSTED_PROXIES` | `-trusted-proxies` | Loopback and private ranges | Comma-separated CIDRs or IPs of the reverse proxies whose Remote IP Header is used. Only takes effect if Remote IP Header is set. A set value replaces the default list. An invalid entry stops the app at startup, including an IPv4-mapped IPv6 range like `::ffff:10.0.0.0/104` (write it in IPv4 notation). |

Configuration Remarks:
- **Initial admin email/password** is **only** used to create the first sysadmin user on initial startup and store it in the database. For email, the default can be used, but the password **must** be defined for the initial startup and comply to the password policy (at least 12 characters, at most 72 bytes, no common passwords). The app won't start initially without a valid password. You can change email or password later in the user settings.
- If the **Secret Key** is not configured, a random key is generated on startup. This invalidates all sessions and forces users to login again. If you want to provide persistent sessions which survive restarts, you **must** provide a stable secret key. This key should have at least 32 characters, be a high-entropy random string and **must** be stored securely. Because it's used for JWT signing and session token hash, a **revealed or compromised key will compromise the security** of the entire application.
- **Secure Cookie** must be kept **enabled** for production environments. Otherwise, there is the risk that the critical security related cookies are sent over unencrypted connections. The Secure cookie flag requires TLS, so this only works correctly when the app runs behind a TLS-terminating reverse proxy. Setting this to false and going without a TLS terminating reverse proxy **is only recommended for internal and trustworthy HTTP networks**.
- The **Remote IP Header** setting lets wuFlow see the actual client IP behind a reverse proxy. If it is empty, the client IP is taken from the TCP connection, which behind a proxy is the proxy's IP: all users then share one login rate limit, and the request logs show the proxy's IP. **Trusted Proxies** defines which peers may set this header. The default (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`) fits a proxy on the same host, in a Docker network or in a Kubernetes cluster. Narrow it to your proxy's address if other hosts in your private networks shouldn't be able to set their own client IP. See [Reverse Proxy](#reverse-proxy).
- **Timing parameters** are not configurable but are fixed at well-reasoned defaults. None of these require tuning for typical deployments.
  - *Server (transport layer):*
    - `ReadTimeout` — **15 s**: maximum time to read the full HTTP request (headers + body).
    - `WriteTimeout` — **15 s**: maximum time to write the full HTTP response.
    - `IdleTimeout` — **60 s**: closes keep-alive connections that have been idle.
  - *Server (application layer):*
    - Request timeout — **5 s**: per-request deadline propagated through all database calls; a slow or blocked query is cancelled rather than held open indefinitely.
    - Graceful shutdown drain — **15 s**: maximum time the server waits for in-flight requests to finish after receiving `SIGTERM`.
  - *Session / authentication:*
    - JWT access token — **15 min**: short-lived token embedded in the auth cookie.
    - Refresh token — **24 h**: backs the persistent session; renewed automatically on each access-token refresh.

## Deployment Options

### Via Helm (Kubernetes)
For Kubernetes deployments, a Helm chart is published as an OCI artifact to GitHub Container Registry. Replace `<chart-version>` with the release you want to deploy and run:

```bash
helm install wuflow oci://ghcr.io/pwurbs/charts/wuflow --version <chart-version> \
  --namespace wuflow --create-namespace \
  -f values.yaml
```

See the [Helm chart documentation](chart/README.md) for configuration options, the dedicated-hostname requirement, and how the initial admin password is generated and retrieved.

The chart's [Artifact Hub page](https://artifacthub.io/packages/helm/wuflow/wuflow) lists all versions with their changes, the default values and the values schema.

### Via Container (Docker)
The recommended and easiest way to deploy wuFlow is using the pre-built container image. 
This is a minimal command to start the app initially for testing purposes in foreground mode. You should adapt it to your needs.
The version must be adapted to the latest release. There is no "latest" tag.

The image is built for linux/amd64 and linux/arm64.

```bash
docker run -it \
  -p 8080:8080 \
  -e WF_INITIAL_ADMIN_PASSWORD="secure-pssw0rd" \
  -e WF_SECURE_COOKIE=false \
  -v /tmp:/data \
  -e WF_DBPATH="/data/wuflow.db" \
  ghcr.io/pwurbs/wuflow:<image-version>
```

Then you can access the app at `http://localhost:8080` and login with email `admin@local` and the configured password.

### Via Go (Source binary)
If you prefer running the application directly from the source code, ensure you have Go and Node.js (version 24+) installed, clone the repository, and run:

```bash
(cd static/js && npm ci && npm run build)
go run . -initial-admin-password "secure-pssw0rd" -secure-cookie=false
```

The first command builds the frontend with Vite into `static/dist/app`, which the Go binary embeds. Run `npm run build` again after changing files in `static/`.

The same way, you can access the app at `http://localhost:8080` and login with email `admin@local` and the configured password.

## Reverse Proxy
As the app only offers unencrypted HTTP, **it is mandatory to run it behind a reverse proxy** (e.g. Nginx, Traefik) within the same environment that **handles TLS termination** and forwards requests to the app. Otherwise, it would not be possible to use the secure cookie flag, which is mandatory for the security of the application. The reverse proxy should also pass the actual client IP to the app, see below.

### Client IP
wuFlow uses the client IP for the login and token-refresh rate limits and in its request logs. Behind a reverse proxy, the TCP connection comes from the proxy, so set **Remote IP Header** (`WF_REMOTE_IP_HEADER`) to the header in which your proxy passes the client IP. Otherwise all users share the proxy's IP and thus one login rate limit.

How wuFlow selects the client IP:
- It uses the header only if the request comes directly from a **trusted proxy** (`WF_TRUSTED_PROXIES`, default: loopback and the private ranges). From any other peer, it ignores the header and uses the IP of the connection.
- It reads the header from the right and skips trusted proxies. The first IP that isn't a trusted proxy is the client. Entries left of it are ignored, because the client can write them itself. If every entry is a trusted proxy, the leftmost one is used. Several lines of the header count as one list.
- If it reaches an entry that isn't an IP address, it uses the IP of the connection and logs a warning.

So the proxy may append to an `X-Forwarded-For` header the client sent; that's the usual behaviour of Nginx and Cloudflare. Hosts in a private network count as trusted proxies under the default, so a client in your LAN can set its own client IP: directly at wuFlow's port, and through a proxy that appends to the header. Keeping wuFlow's port reachable only for the proxy (bind it to `localhost` or a private interface, or use a firewall rule) closes only the direct path. To rule out both, narrow `WF_TRUSTED_PROXIES` to the proxy's address.

Settings per setup:

| Setup | `WF_REMOTE_IP_HEADER` | `WF_TRUSTED_PROXIES` | Proxy requirement |
|---|---|---|---|
| Proxy on the same host or in a Docker/private network | `X-Forwarded-For` | default | Nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` — Traefik: nothing |
| Proxy with a public IP | `X-Forwarded-For` | the proxy's IP | as above |
| Kubernetes ([Helm chart](chart/README.md)) | set by the chart | default | A load balancer or CDN in front of the ingress controller must be trusted by it (Traefik: `forwardedHeaders.trustedIPs`) |
| Cloudflare proxy | `CF-Connecting-IP` | default | Only Cloudflare may reach the origin (firewall on [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) or Authenticated Origin Pulls); otherwise anyone can set this header |

A proxy that doesn't trust the hop in front of it replaces the header, and all users share that hop's IP. Add only proxies or CDNs you know to a proxy's trusted IPs, never a whole network that internet clients may appear from.

**Enable compression on the reverse proxy.** Like TLS, compression is left to the proxy; wuFlow itself sends its responses uncompressed. On slow connections, compression makes the first page load and the Backlog and Archive views considerably faster.
- **Traefik**: add the [`compress` middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/compress/) to the route that serves wuFlow. With the [Helm chart](chart/README.md), set `ingress.compress: true`.
- **Nginx**: `gzip on;` with `gzip_types text/css text/javascript application/javascript application/json;` (HTML is always compressed when `gzip` is on).

**Caching needs no proxy configuration.** wuFlow sets the cache headers itself; don't let the proxy override them (see [Frontend](docs/frontend.md#delivery)).

## Home Assistant Add-on
For instructions on how to deploy wuFlow as a Home Assistant Add-on, please refer to the [Home Assistant Add-on documentation](home-assistant-addon/README.md).

## Usage Guide
Please refer to the [Usage Guide](docs/usage-guide.md) for a brief overview on how to navigate the app, manage issues, and use the Kanban board.

## Technical Documentation
For deeper technical insights, architecture overviews, and detailed functional descriptions, please explore the markdown files provided in the [`docs/`](docs/) folder:

- [API Design](docs/api.md)
- [Swagger](docs/swagger.json)
- [Backend Architecture](docs/backend-architecture.md)
- [Frontend](docs/frontend.md)
- [User Management](docs/user-management.md)
- [Input Validation](docs/input-validation.md)
- [Client Security](docs/client-security.md)
- [Markdown Security & Sanitization](docs/markdown-security.md)
- [Security Guidelines](docs/security-guidelines.md)
- [Concurrency Control](docs/concurrency-control.md)
- [Testing](docs/testing.md)

## Outlook
We plan to add the following features in the future:
- Dependencies between Issues
- Links between issues
- Light mode
- Private Issues
- Postgres support
- Horizontal scalability
- OIDC support
- Project-scoped roles
- File Upload
- Prometheus metrics
- ...

## Feedback
If you have any feedback, want to report bugs or make a feature request, please open an issue on [GitHub](https://github.com/pwurbs/wuflow/issues).
