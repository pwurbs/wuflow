wuFlow is a self-hosted Kanban/issue tracker: one Go binary (net/http, SQLite file) that embeds a
plain-JS frontend, deployed behind a reverse proxy via Docker, Helm or as a Home Assistant add-on.

## Docs
Docs are the source of truth — read the matching one before changing an area:
- API routes, handlers, database access, project access → docs/backend-architecture.md ("Adding a new endpoint"), docs/api.md
- Roles and permissions → docs/user-management.md
- Issue updates, ETags, drag-and-drop ordering → docs/concurrency-control.md
- Markdown rendering and sanitization → docs/markdown-security.md
- Cookies, security headers, middleware → docs/client-security.md
- Validation limits → docs/input-validation.md
- Frontend modules, styles, build, delivery → docs/frontend.md
- Test strategy → docs/testing.md; writing E2E tests → playwright/README.md
- Scripts and their required tools → scripts/README.md
- Configuration, deployment, Helm chart → README.md, chart/README.md
- Security rules and accepted risks → docs/security-guidelines.md

## Code search
If `.codegraph/` exists, look up project symbols (function, type, route, component) with CodeGraph
(`codegraph_explore` / `codegraph explore "<query>"`) first — also in plan mode and in subagents;
tell Explore agents not to fall back to grep/find. grep/find only for what it doesn't index
(stdlib/external calls, SQL/config strings, YAML, Dockerfile, HTML/CSS, docs) — say why in one line.

## Commands (repo root unless noted)
- Go tests: `go test ./backend/...`
- Go lint + SAST + vuln: `./scripts/go_checks.sh` (runs all, exit 1 if any failed)
- JS unit tests: `cd static/js && npm test`
- E2E: `cd playwright && npm test` (builds the frontend, starts its own servers on 8090–8094)
- `go run`/`go build` need `cd static/js && npm run build` first (go:embed); tests and lint don't.
- The "Run locally" VS Code task logs to `local-databases/wuflow-local.log` (JSON slog) — read it
  instead of asking for logs.

## Before reporting a task as done
After any code change, these must pass (commands above):
- Go tests
- Go checks (`./scripts/go_checks.sh`)
- JS unit tests
- E2E tests (Playwright) — when production code or dependencies changed: `main.go`, `backend/`
  (except `_test.go`), `static/` (except `static/js/tests/`), `go.mod`, `package.json`

## Wrap-up
- Check and update docs/, README.md and docs/swagger.json where the change requires it.
- Then run the doc-sync subagent (.claude/agents/doc-sync.md): it mirrors docs/ and README into
  the GitHub wiki (separate repo, sibling checkout `../wuflow.wiki`) and catches remaining spots.
- The maintainer commits the wiki right before a release; don't remind about uncommitted wiki changes.

## Project rules
- The backend enforces everything — authorization, validation, ownership; frontend checks are UX
  only. Exception: Markdown is sanitized in the frontend (docs/markdown-security.md).
- Secrets (passwords, password hashes, session/JWT tokens, the secret key) must never appear in API
  responses, logs or error messages. Check every new output path for this.
- Backend errors: the client gets a validation message (400) or a generic `errMsg…` constant;
  internal details go only to the log. Log via `LogDebug`/`LogInfo`/`LogWarn`/`LogError`
  (backend/utils.go) with key-value pairs; `fmt`/`log` only for startup output.
- Keep each function's cognitive complexity at 15 or below (SonarQube rule S3776, Go and JS):
  prefer early returns and small helpers over deep nesting.
- Frontend mirrors of backend definitions (`permissions.js`, `domain-constants.js`,
  `validation-config.js`) change in the same change as the backend.
- Schema changes must work on existing databases: idempotent migration in `runMigrations`
  (backend/db.go).
- Few dependencies: Go stdlib plus a few packages; plain JS (ES modules) and CSS, no UI framework.
  No new runtime dependency without asking.
- Cross-cutting transport concerns — TLS, HTTP/2, compression — belong in the reverse proxy, not
  the app (README "Reverse Proxy").
- CSS: before writing a new rule, check what exists — custom properties in
  `static/styles/abstracts/variables.css`, selector groups in `base/typography.css`, existing
  component classes. Use a custom property (add one if needed) instead of a literal color or size,
  even where older files still contain literals.
- Shared UI mechanisms (`showNotification`, `showConfirm`, `guardSubmit`) are app-wide conventions:
  change them only deliberately and app-wide, never as a side effect of a feature.