<img src="static/logo.png" alt="wuFlow Logo" width="100">

# wuFlow

**Keep your work flowing.** wuFlow is a lean, security-first, self-hosted issue tracker: Kanban board, backlog, releases and a daily planner in one place. Open source, no subscription, no tracking.

[Website](https://wuflow.dev) · [Docs](#documentation) · [Releases](https://github.com/pwurbs/wuflow/releases)

[![GitHub Release](https://img.shields.io/github/v/release/pwurbs/wuflow)](https://github.com/pwurbs/wuflow/releases)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/wuflow)](https://artifacthub.io/packages/search?repo=wuflow)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=alert_status)](https://sonarcloud.io/dashboard?id=wuflow-oss)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=wuflow-oss&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=wuflow-oss)

wuFlow ships as a single Go binary that stores its data in an embedded SQLite database and serves the vanilla-JavaScript frontend from embedded assets. It runs as a Docker container, on Kubernetes via Helm, or as a Home Assistant add-on.

Why wuFlow and full feature overview → [wuflow.dev](https://wuflow.dev)

<img src="docs/screenshots/board.png" alt="wuFlow board with workflow columns and the daily planner">

## Features
- Kanban board with configurable columns per project
- Daily planner next to the board
- Backlog, releases, archive
- Subtasks with due dates
- Change history per issue
- Labels, filters, text search
- Users and roles, safe concurrent editing
- Markdown descriptions and comments

Planned features are listed in the [roadmap on wuflow.dev](https://wuflow.dev/#roadmap).

## Supply chain
wuFlow keeps its runtime small:

```
wuflow                  Go binary, frontend assets embedded
├─ golang-jwt/jwt       Go: session tokens
├─ mattn/go-sqlite3     Go: embedded SQLite database
├─ golang.org/x/crypto  Go: password hashing
├─ dompurify            JS: Markdown sanitisation
└─ marked               JS: Markdown rendering
```

Everything else is the Go standard library and vanilla JavaScript. The JS packages are pinned and bundled. Vite is used only at build time. Nothing is loaded from outside at runtime, and no external services are needed.

## Quick start
Docker images are available for linux/amd64 and linux/arm64:

```bash
docker run -p 8080:8080 \
  -e WF_INITIAL_ADMIN_PASSWORD="change-me-to-something-long" \
  -e WF_SECURE_COOKIE=false \
  -v wuflow-data:/data \
  ghcr.io/pwurbs/wuflow:<version>
```

Replace `<version>` with the newest tag in the [image repository](https://github.com/pwurbs/wuflow/pkgs/container/wuflow). There is no `latest` tag. Then open `http://localhost:8080` and log in as `admin@local` with the given password. This password must meet the [password policy](docs/user-management.md#password-policy), otherwise the app doesn't start. Data is stored in an embedded SQLite database in the `/data` volume.

## Usage Guide
Please refer to the [Usage Guide](docs/usage-guide.md) for a brief overview of how to navigate the app, manage issues, and use the Kanban board.

## Deployment options
Described in [Deployment](docs/deployment.md#deployment-options):
- Docker: for quick tests and simple setups.
- Kubernetes (Helm): for production use.
- Home Assistant: for private use at home.

## Configuration
wuFlow is configured with environment variables or command-line flags. [Configuration](docs/configuration.md) lists all options.

> **Run wuFlow behind a TLS-terminating reverse proxy and keep Secure Cookie enabled.** The Quick start command turns it off, which is only meant for local tests. See [Reverse proxy](docs/deployment.md#reverse-proxy).

## Building from source
You need Go, a C compiler (the SQLite driver uses cgo) and Node.js 24+. Clone the repository, then:

```bash
# Build the frontend into static/dist/app (the binary embeds it, so repeat after changing static/)
cd static/js
npm ci
npm run build
cd ../..

# Build the binary
go build -o wuflow .

# Start it
./wuflow -initial-admin-password "change-me-to-something-long" -secure-cookie=false
```

## Documentation
- Operation: [Deployment](docs/deployment.md), [Configuration](docs/configuration.md), [Helm chart](chart/README.md), [Home Assistant add-on](home-assistant-addon/README.md)
- API: [API Design](docs/api.md), [Swagger](docs/swagger.json)
- Architecture: [Backend](docs/backend-architecture.md), [Frontend](docs/frontend.md), [Concurrency Control](docs/concurrency-control.md), [Testing](docs/testing.md)
- Security: [Security Guidelines](docs/security-guidelines.md), [User Management](docs/user-management.md), [Client Security](docs/client-security.md), [Input Validation](docs/input-validation.md), [Markdown Security](docs/markdown-security.md)

## Feedback
Found a bug or have an idea? [Open an issue](https://github.com/pwurbs/wuflow/issues). Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License
[Apache 2.0](LICENSE)
