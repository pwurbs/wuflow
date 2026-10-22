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
- The "Run locally" VS Code task builds the frontend itself and logs to `local-databases/wuflow-local.log` (JSON slog) — read it
  instead of asking for logs.

## Testing
- New or changed behaviour needs test cases that assert it: write new tests or extend existing ones
  in the matching layer (docs/testing.md) — existing tests that merely keep passing don't count.
  Go logic/handlers → `backend/*_test.go`, JS with decisions → `static/js/tests/`, user-visible
  flows → `playwright/`.
- After a production code change, run the existing suites first, before writing new tests.
- Classify every failure: expected (the test asserts behaviour the change intentionally altered)
  or regression. There is no third class: a failure the change doesn't explain is a regression,
  also when it is "unrelated" or passes on rerun. Name the expected ones in the report and adapt
  those tests explicitly; find the root cause of every regression and fix it. Never adapt, weaken
  or delete a test just to make it pass. Keep the full output of every test run, so each failure
  can be named.
- Then add the new tests and run everything again.
- Required suites (commands above): Go tests, Go checks, JS unit tests, and E2E (Playwright) when
  production code or dependencies changed: `main.go`, `backend/` (except `_test.go`), `static/`
  (except `static/js/tests/`), `go.mod`, `package.json`
- Only do the full playwright test as the final step. After each change only execute the affected tests to save time.

## Before reporting a task as done
- Testing done as described in [Testing](#testing); all required suites pass.
- Check and update docs/, README.md and docs/swagger.json where the change requires it.

## Wrap-up
- Run the doc-sync subagent (.claude/agents/doc-sync.md): it mirrors docs/ and README into
  the GitHub wiki (separate repo, sibling checkout `../wuflow.wiki`).
- The maintainer commits the wiki right before a release; don't remind about uncommitted wiki changes.

## Project rules
- The backend enforces everything — authorization, validation, ownership; frontend checks are UX
  only. Exception: Markdown is sanitized in the frontend (docs/markdown-security.md).
- Secrets (passwords, password hashes, session/JWT tokens, the secret key) must never appear in API
  responses, logs or error messages. Check every new output path for this.
- Errors: handle each error once — return it or log it, not both. Backend: the client gets a
  validation message (400) or a generic `errMsg…` constant; internal details go only to the log
  (`LogError`). Every successful write logs `LogInfo` with resource ID and `user_email` (audit
  trail). Log via `LogDebug`/`LogInfo`/`LogWarn`/`LogError` (backend/utils.go) with key-value
  pairs; `fmt`/`log` only for startup output. Frontend: API errors go to `showNotification`;
  no empty `catch` without a comment saying why.
- New input fields, on input: reject what's invalid — a validator in `backend/validation.go`
  (length, format; 400) plus its mirror in `validation-config.js`; then decide plain text vs
  Markdown. Plain text is cleaned with `sanitizeString` before storing and rendered with
  `textContent`/`escapeHtml`; Markdown is stored raw and rendered via `renderMarkdown`
  (docs/markdown-security.md). No user data in `innerHTML` otherwise.
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