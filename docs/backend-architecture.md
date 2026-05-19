# Backend Architecture

A quick map of how routing, handlers, and DB access fit together in `backend/`. Read this before adding a new endpoint or changing one — the layering looks ordinary at a glance but a few constraints are load-bearing.

## Layers

| File | Role |
| :--- | :--- |
| [server.go](../backend/server.go) | Declarative route table. Every endpoint is one line: `method`, `path`, factory-wrapped handler. The mux dispatches by method+path (Go 1.22), so there is no `switch r.Method` anywhere. |
| [handlers.go](../backend/handlers.go) | Two things: the four **factories** (`withRole`, `withResource`, `withProject`, `withProjectResource`) and the **inner handlers** that contain business logic. Inner handlers never re-check permissions or re-parse path variables — that's the factory's job. |
| [db.go](../backend/db.go) | All SQL. Handlers call these by name; no DB code outside this file. Project-scoped reads/mutations are expressed as queries filtered by both `id` and `project_id` (`GetIssueByIDInProject`, `GetReleaseByIDInProject`, `DeleteLabel(id, projectID)`) — see *Resource ownership* below. |
| [permissions.go](../backend/permissions.go) | `Action` enum + `Can(role, action)` table. Permission rules in one place. |
| [auth.go](../backend/auth.go) | `AuthMiddleware` (cookie → context: userID, role, email) and JWT/session handling. |
| [validation.go](../backend/validation.go) | Pure validators called by `decodeAndValidate` inside handlers. Don't put DB-touching checks here. |

## Routing

`server.go` reads top-to-bottom as the public API. Patterns to know:

- **Method+path routing** — `mux.Handle("PUT /api/projects/{pId}/issues/{id}", …)`. The mux returns `405` automatically when the path matches but the method doesn't. Don't reintroduce per-handler method switches.
- **Literal-before-wildcard** is handled by the mux: `/issues/active` always wins over `/issues/{id}` when both match. Registration order doesn't matter.
- **`APIMux`** is the production entry point — full middleware chain (auth, rate limit, JSON-content-type, etc.). Tests use a parallel test-only mux (`bareAPIMux` in `testhelpers_test.go`) with no middleware and inject context manually.

## Anatomy of a route line

A typical row in the route table looks like:

```go
hf("GET", "/api/users", withRole(ActionListUsers, handleListUsers), authAPI)
```

Four slots, left to right:

| Slot | Example | Role |
| :--- | :--- | :--- |
| `method` | `"GET"` | HTTP verb. The mux dispatches on this and returns `405` if a request arrives with the wrong method. |
| `pattern` | `"/api/users"` | URL path. Can contain placeholders like `{pId}` / `{id}` — extracted via `r.PathValue(...)`. Literal segments (`/issues/active`) win over wildcards (`/issues/{id}`) automatically. |
| `handler` | `withRole(ActionListUsers, handleListUsers)` | The factory wraps an inner handler with permission + path-var + ownership checks. See the [Factories](#factories) section. |
| `wrap` | `authAPI` | The outer middleware chain. Use `authAPI` for protected routes, `commonAPI` for the three public auth endpoints. |

`hf` is a tiny helper in `buildAPIMux` that just calls `mux.Handle(method+" "+pattern, wrap(handler))`. So at runtime a request travels through the layers in this order (outside → in):

```
authAPI:  Logging → CSP → ValidatePath → LimitBody → RequireJSON → Auth → UserRateLimit
                        ↓
factory:  Can(role, action)? → parse path vars? → project exists? → ownership? 
                        ↓
inner handler:  business logic + DB call + response
```

Each layer either passes the request through or writes an HTTP error and returns. The inner handler only runs once everything above it has succeeded.

## Factories

Every protected route flows through one of six factories. They all start with the same role-based permission check; what differs is which URL slots they parse and pass to the handler.

| Factory | Use it for | Steps it runs (in order) | Handler signature |
| :--- | :--- | :--- | :--- |
| `withRole(action, h)` | Routes with no path vars (`POST /api/users`, `GET /api/projects`). | role check → handler | `(w, r)` |
| `withResource(action, h)` | Routes with `{id}` but no project (`PUT /api/users/{id}`). | role check → parse `{id}` → handler | `(w, r, id)` |
| `withProject(action, h)` | Routes with `{pId}` but no resource id (`POST /api/projects/{pId}/issues`, list endpoints). | role check → `checkProjectAccess` (parse `{pId}` + project exists) → handler | `(w, r, projectID)` |
| `withProjectResource(action, h)` | Routes with `{pId}` AND `{id}` (`PUT /api/projects/{pId}/issues/{id}`, etc.). | role check → `checkProjectAccess` → parse `{id}` → handler | `(w, r, projectID, id)` |
| `withIssue(action, h)` | Routes scoped to an issue with no further resource id (`POST /api/projects/{pId}/issues/{iId}/tasks`). | role check → `checkProjectAccess` → parse `{iId}` → `GetIssueByIDInProject` (nil → 404) → handler | `(w, r, projectID, issueID, *Issue)` |
| `withIssueResource(action, h)` | Routes scoped to an issue with an additional `{id}` (`PUT /api/projects/{pId}/issues/{iId}/tasks/{id}`). | role check → `checkProjectAccess` → parse `{iId}` → `GetIssueByIDInProject` → parse `{id}` → handler | `(w, r, projectID, issueID, id, *Issue)` |

In all six, the role check fires first and short-circuits with `403` before any path parsing or DB query.

**On `withIssue` / `withIssueResource`**: tasks are currently the only issue-nested resource, but these factories are intentionally generic — comments, activity logs, and attachments are planned as further children of an issue. Each will reuse the same factories with no changes; the route line and DB helpers are the only additions needed (mirror the task pattern: child mutations must include `AND issue_id = ?` in their WHERE so the ownership-in-SQL discipline below extends one level deeper).

The project factories overlap: each runs `checkProjectAccess`, and the two issue-scoped variants additionally run `GetIssueByIDInProject` so the loaded issue is available to the handler (which is how the task handlers run the archive check without a second DB query). The split exists so the handler signature declares what URL slots it consumes — without the split, every handler would start with a duplicate `resourceIDFromPath(...)` call and a duplicate issue lookup.

**Why role check first**: tests that assert `403 Forbidden` set a `RoleUser` (or empty) context but do **not** call `setupTestDB()`. If the role check ran after a DB query, those tests would panic on `nil DB`. Keep the order.

### Resource ownership: encoded in the SQL query, not in a separate check

`withProjectResource` does **not** verify that `{id}` belongs to `{pId}` — and neither does the handler, with a Go-level comparison. Instead, the DB helpers handlers use (`GetIssueByIDInProject`, `GetReleaseByIDInProject`, `DeleteLabel`, …) filter by **both** `id` and `project_id` in their `WHERE` clause. A wrong-project row is simply not returned, so:

- on a SELECT (`GetXByIDInProject`): the helper returns `nil` → handler responds `404`;
- on a DELETE (`DeleteLabel`): zero rows affected → helper returns `ErrXNotFound` → handler responds `404`.

```go
func handlePutIssue(w, r, projectID, id int) {
    current, err := GetIssueByIDInProject(id, projectID)
    if err != nil { /* 500 */ }
    if current == nil { /* 404 — no such issue in this project */ }
    // ... business logic ...
}
```

Why this shape rather than a factory-level COUNT pre-check:

- **One query, not two.** The handler already loads the row for business logic (etag, archived status, current values). Folding `AND project_id = ?` into that `WHERE` is free.
- **No separate "ownership check" to forget.** The scoping is a SQL predicate; the handler can't accidentally bypass it without writing different SQL.
- **No callback plumbing.** The factory stays generic — no `belongs` adapter per resource type.
- **No information leak.** "Wrong project" is indistinguishable from "doesn't exist" at the API level.

**The discipline**: in any handler with the `(w, r, projectID, id)` signature, the **first DB call MUST be the `*InProject` variant** (or a mutating helper like `DeleteLabel(id, projectID)` that filters on both columns internally). A missed `*InProject` call reopens the cross-project hole. When introducing a new project-scoped resource, add a `GetXByIDInProject` to `db.go` whose query filters by both `id` and `project_id` — same shape as the existing two.

## `checkProjectAccess` — the future-membership hook

```go
func checkProjectAccess(w, r) (int, bool) {
    // parse pId → 400 on bad input
    // ProjectExists → 404 on unknown project
    // TODO(per-project-membership): membership lookup goes here
    return pID, true
}
```

This helper sits at the single chokepoint reached by `withProject` and `withProjectResource`. When the `project_users` table lands, the membership check goes inside this function (after `ProjectExists`, before the return) and nothing else needs to change. The `TODO(per-project-membership)` marker in the body points at the exact insertion line.

## Inner handler conventions

Every inner handler conforms to one of three signatures (see `handlers.go`):

```go
type resourceHandler    func(w, r, id int)                    // /api/users/{id}
type projectHandler     func(w, r, projectID int)             // /api/projects/{pId}/...
type projectResHandler  func(w, r, projectID, resourceID int) // /api/projects/{pId}/.../{id}
```

Conventions:

- **Trust the factory.** Inner handlers do not re-check permissions, re-parse path values, or re-verify the project/resource exists. If you find yourself wanting to, the factory is the wrong shape — fix the factory.
- **URL pins the project.** For create/update routes, set `model.ProjectID = projectID` from the URL after decoding the body. Body's `project_id` is ignored. This rules out cross-project moves via PUT (a known limitation — see follow-up needed in the modal's project-select handler).
- **Validators are pure.** Use `decodeAndValidate(w, r, &v, validateFoo)` for JSON validation. DB-touching pre-checks (`checkAssignee`, `checkLabel`, `checkRelease`) are separate helpers and run after permission check.
- **404 vs 403.** If the resource exists in *another* project, return `404` (matches the ownership check in `withProjectResource`) — never `403`. Existence is what's being denied, not authority.

## Database access

- All queries go through helpers in `db.go`. No `DB.Query(...)` calls in handlers.
- Ownership-check helpers follow the pattern `XBelongsToProject(projectID, xID) (bool, error)` (named `XExistsInProject` for historical reasons). When adding a new project-scoped resource, add one.
- Use `existsQuery(ctx, "SELECT COUNT(*) FROM … WHERE …", args...)` for boolean existence checks; it already handles the count/error pattern.

## Context propagation

Every DB helper in `db.go` takes `ctx context.Context` as its first parameter and uses the `*Context` variants of `database/sql` (`QueryRowContext`, `QueryContext`, `ExecContext`, `BeginTx`). Handlers pass `r.Context()` down; startup-time callers (`InitDB`, `EnsureInitialAdmin`, `DeleteExpiredSessions` in `server.go`) pass `context.Background()`.

What this buys:

- **Client disconnect cancellation** — `net/http` cancels `r.Context()` when the client connection drops; the in-flight DB query stops immediately instead of running to completion.
- **Per-request timeout** — `TimeoutMiddleware` (in `server.go`, wired into both `commonAPI` and `authAPI` after `AuthMiddleware`) attaches a 5 s `context.WithTimeout` to every request. This is the application-layer deadline that actually reaches DB calls, distinct from the server's `ReadTimeout`/`WriteTimeout` which only close the TCP socket.
- **Graceful shutdown** — `StartServer` blocks on `SIGINT`/`SIGTERM`, then calls `srv.Shutdown(ctx)` with a 15 s drain window so in-flight requests finish before the process exits. Required for cloud orchestrators (Kubernetes, Docker, etc.) that rely on graceful container drain during rolling deploys.

**The discipline**: when adding a DB helper or a handler-side helper that calls one, take `ctx context.Context` as the first parameter and thread it through. Helpers without `r` (e.g. `respondWithUpdatedIssue`, `checkAssignee`, `persistIssueUpdate`) follow the same convention.

> **Future consideration (Postgres / multi-statement transactions):** when a context is cancelled mid-transaction, individual `ExecContext` calls return an error but the transaction stays open server-side until rolled back. Use `defer tx.Rollback()` immediately after `BeginTx` (no-op after a successful `Commit`). Not needed for the current single-statement SQLite handlers; apply when introducing multi-statement transactions.

## Adding a new endpoint — checklist

1. Add the route to `server.go`. Pick the right factory.
2. Write the inner handler in `handlers.go` with the matching signature. Take `ctx` from `r.Context()` and pass it to every DB call.
3. If it's project-scoped with a resource ID, add an `XBelongsToProject` helper in `db.go` (first parameter `ctx context.Context`, SQL via `*Context` variants).
4. If the role-based permission is new, add the `Action` constant and policy row in `permissions.go`.
5. Tests: invoke via `testAPI.ServeHTTP(rr, req)` so the factory chain runs. Add an ownership-404 test for any new project-scoped resource.
6. Update [api.md](api.md) (handler-mapping table + per-endpoint section) and [swagger.json](swagger.json).
