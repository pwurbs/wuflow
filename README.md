# wuFlow

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) 
[![GitHub Release](https://img.shields.io/github/v/release/pwurbs/wuflow)](https://github.com/pwurbs/wuflow/releases) 
[![GitHub issues](https://img.shields.io/github/issues/pwurbs/wuflow)](https://github.com/pwurbs/wuflow/issues)  <br>
[![Go Version](https://img.shields.io/github/go-mod/go-version/pwurbs/wuflow)](https://github.com/pwurbs/wuflow) 
[![Go Report Card](https://goreportcard.com/badge/github.com/pwurbs/wuflow)](https://goreportcard.com/report/github.com/pwurbs/wuflow) <br>
[![Container Image](https://img.shields.io/badge/ghcr.io-image-blue?logo=docker)](https://github.com/pwurbs/wuflow/pkgs/container/wuflow) <br>
![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=wuflow&metric=alert_status&token=70554a588df3511feeedd61292f37aa8a1785d11) 
![Coverage](https://sonarcloud.io/api/project_badges/measure?project=wuflow&metric=coverage&token=70554a588df3511feeedd61292f37aa8a1785d11) 
![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=wuflow&metric=vulnerabilities&token=70554a588df3511feeedd61292f37aa8a1785d11) 
![Bugs](https://sonarcloud.io/api/project_badges/measure?project=wuflow&metric=bugs&token=70554a588df3511feeedd61292f37aa8a1785d11)

<img src="static/logo.png" alt="wuFlow Logo" width="100">

## General
wuFlow is a simple, modern, and lightweight issue tracking and planning application. It is designed to combine the immediate visual overview of a classic Kanban board with structural planning capabilities to help you organize tasks effectively without unnecessary complexity.
This tool wants to help you to organize, balance and track the work in a team to achieve a better **flow** of work by a transparent visualization. This is one of the main intentions of a [Kanban board](https://en.wikipedia.org/wiki/Kanban_board).
The usage is not limited to software development teams, it can be used by any person, group or even families that wants to organize and track their work.

<img src="docs/screenshots/board.png" alt="wuFlow Board" >

We developed this app having the following goals in mind:
- Create a **modern and lightweight** issue tracking solution focused on the mostly used core functions to ensure a good **flow** of work.
- Can be used **without expensive subscriptions** or being forced into the cloud.
- **Avoid the complexity of existing solutions** like Jira for more stability, higher security, easy configuration and lower costs. 
- Bridge the gap between **structured Kanban management** and **daily planning**.
- Provide **full topic/task transparency** to a team, group or family.
- Don't rely on **heavy frameworks** or libraries which require dedicated skills and knowledge.
- Ensure **"Security by Design"** through strict headers, CSRF/XSS prevention, and rigorous testing.
- Slim and **modern software architecture** using Go and Vanilla JavaScript.
- Rely only on **few dependencies** to significantly reduce the **Supply Chain Attack surface**.
- **No tracking, telemetry or any other "calling home"** functions.
- Easy to deploy and use.
- Open Source.

## Features
- **Intuitive Planning & Kanban**: Combine flexible daily planning with a classic Kanban board view to easily organize your workflow side-by-side.
- **Projects**: Projects allow you to separate the visibility of issues for different teams, projects or topics. Each issue belongs to exactly one project.
- **Subtasks & Deadlines**: Break down larger issues into smaller, actionable tasks with individual deadlines.
- **Custom Labels**: Categorize and color-code issues with an easy-to-use label management system.
- **Advanced Filtering & Search**: Quickly find issues by filtering based on labels, priority, assignees, or text search.
- **Multi-user Support**: Built-in user management with role-based access, allowing safe concurrent editing of issues.
- **Rich Text Markdown Editor**: Write readable issue descriptions using a built-in Markdown editor with formatting tools and live preview.
- **Prioritization & Assignment**: Assign issues directly to specific users and flag important work with High Priority.
- **Backlog Management**: Use the backlog view to plan and prioritize your work.
- **Issue Archiving**: Keep your active board clean by archiving completed issues for later reference.
- **No dependencies** on external services or libs during runtime. Allows for air-gapped deployments.

The app is currently only tested to run in the Chrome browser.

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
| Admin Email | `WF_INITIAL_ADMIN_EMAIL` | `-initial-admin-email` | `admin@local` | Email for the first admin user created on initial startup. |
| Admin Password | `WF_INITIAL_ADMIN_PASSWORD` | `-initial-admin-password` | *None* | Password for the first admin user. **Must be provided on first run.** |
| Log Level | `WF_LOG_LEVEL` | `-log-level` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`). |
| Secure Cookie | `WF_SECURE_COOKIE` | `-secure-cookie` | `true` | Restricts auth cookies to HTTPS. Disable (`false`) only for internal HTTP networks. |
| API Rate Limit | `WF_API_RATE_LIMIT` | `-api-rate-limit` | `true` | Enables per-user API rate limiting to prevent abuse. |
| Remote IP Header | `WF_REMOTE_IP_HEADER` | `-remote-ip-header` | *None* | Trusted HTTP header for detecting client IP behind proxies (e.g., `X-Forwarded-For`). |

Configuration Remarks:
- **Initial admin email/password** is **only** used to create the first admin user on initial startup and store it in the database. For email, the default can be used, but the password **must** be defined for the initial startup and comply to the password policy (12 characters, no common passwords). The app won't start initially without a valid password. You can change email or password later in the user settings.
- If the **Secret Key** is not configured, a random key is generated on startup. This invalidates all sessions and forces users to login again. If you want to provide persistent sessions which survive restarts, you **must** provide a stable secret key. This key should have at least 32 characters, be a high-entropy random string and **must** be stored securely. Because it's used for JWT signing and session token hash, a **revealed or compromised key will compromise the security** of the entire application.
- **Secure Cookie** must be kept **enabled** for production environments. Otherwise, there is the risk that the critical security related cookies are sent over unencrypted connections. The Secure cookie flag requires TLS, so this only works correctly when the app runs behind a TLS-terminating reverse proxy. Setting this to false and going without a TLS terminating reverse proxy **is only recommended for internal and trustworthy HTTP networks**.
- The **Remote IP Header** setting is used to correctly detect the actual client IP when the app is running behind proxies. If empty, the client IP is directly taken from the request. If you are running the app behind a reverse proxy, you **must** set this to the HTTP header that the proxy sets with the actual client IP (e.g., `X-Forwarded-For` or `X-Real-IP`). Otherwise, the login rate limiting is based on wrong IP address information and the request logging contains the IP address of the reverse proxy instead of the actual client IP.

## Deployment Options

### Via Container (Docker)
The recommended and easiest way to deploy wuFlow is using the pre-built container image. 
This is a minimal command to start the app initially for testing purposes in foreground mode. You should adapt it to your needs.
The version must be adapted to the latest release. There is no "latest" tag.

```bash
docker run -it \
  -p 8080:8080 \
  -e WF_INITIAL_ADMIN_PASSWORD="secure-pssw0rd" \
  -e WF_SECURE_COOKIE=false \
  -v /tmp:/data \
  -e WF_DBPATH="/data/wuflow.db" \
  ghcr.io/pwurbs/wuflow:1.0.0
```

Then you can access the app at `http://localhost:8080` and login with email `admin@local` and the configured password.

### Via Go (Source binary)
If you prefer running the application directly from the source code, ensure you have Go installed (version 1.25+), clone the repository, and run:

```bash
go run . -initial-admin-password "secure-pssw0rd" -secure-cookie=false
```

The same way, you can access the app at `http://localhost:8080` and login with email `admin@local` and the configured password.

### Reverse Proxy
As the app only offers unencrypted HTTP, **it is mandatory to run it behind a reverse proxy** (e.g. Nginx, Caddy, Traefik) that **handles TLS termination** and forwards requests to the app. Otherwise, it would not be possible to use the secure cookie flag, which is mandatory for the security of the application. The reverse proxy should also be configured to forward the actual client IP to the app using the configured **Remote IP Header**.

## Home Assistant Add-on
For instructions on how to deploy wuFlow as a Home Assistant Add-on, please refer to the [Home Assistant Add-on documentation](home-assistant-addon/README.md).

## Usage Guide
Please refer to the [Usage Guide](docs/usage-guide.md) for a brief overview on how to navigate the app, manage issues, and use the Kanban board.

## Technical Documentation
For deeper technical insights, architecture overviews, and detailed functional descriptions, please explore the markdown files provided in the [`docs/`](docs/) folder:

- [API Design](docs/api.md)
- [Swagger](docs/swagger.json)
- [User Management](docs/user-management.md)
- [Input Validation](docs/input-validation.md)
- [Client Security](docs/client-security.md)
- [Markdown Security & Sanitization](docs/markdown-security.md)
- [Concurrency Control](docs/concurrency-control.md)
- [Lazy Loading / Data Fetching](docs/lazy-loading.md)
- [Testing](docs/testing.md)

## Outlook
We plan to add the following features in the future:
- Dependencies between Issues
- Links between issues
- Postgres support
- Horizontal scalability
- OIDC support
- Add comments in issues
- EPICs
- Releases (maybe basis for executing simple SCRUM)
- Configurable column names
- More roles
- File Upload
- Helm Chart
- Prometheus metrics
- Light/Dark mode, configurable by user
- Private Issues
- ???

## Feedback
If you have any feedback, want to report bugs or make a feature request, please open an issue on [GitHub](https://github.com/pwurbs/wuflow/issues).
