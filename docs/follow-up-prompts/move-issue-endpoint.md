# Hand-off prompt — implement issue-move endpoint

Use this as the **first message** to a fresh agent in a new thread.

---

## Context

I just finished a refactor that moved every issue/release mutation under
`/api/projects/{pId}/...` and enforces project ownership at the SQL layer
(`GetIssueByIDInProject(id, projectID)`). The URL is now the source of truth
for which project an issue lives in, so `PUT /api/projects/{pId}/issues/{id}`
cannot move an issue across projects — if the URL's `pId` differs from the
issue's stored `project_id`, the helper returns `nil` and the handler responds
`404`.

The previous frontend allowed users to change an issue's project via the
project-select dropdown in the edit modal; that flow now breaks because the
PUT URL uses the *new* project. I disabled the dropdown for existing issues
and skipped the e2e test that drove it:

- Frontend: [static/js/components/modal.js](../../static/js/components/modal.js)
  near "Project Dropdown" — sets `projectTrigger.disabled = !!issue` with a
  tooltip explaining why.
- Skipped test: [playwright/issue_edits.spec.ts](../../playwright/issue_edits.spec.ts)
  `test.skip('changing project resets label, release and status to defaults', …)`
  — carries a `TODO(move-endpoint)` referring to this work.

## What to build

A dedicated **move** endpoint that re-enables the cross-project move as an
explicit operation. Required pieces:

### Backend

1. **Route**: `POST /api/projects/{pId}/issues/{id}/move` in
   [backend/server.go](../../backend/server.go), wrapped with
   `withProjectResource(ActionMoveIssue, handleMoveIssue)` so the URL still
   identifies the issue's **current** project (`pId` = source). Same
   ownership rules as every other project-scoped route: the issue must
   actually live in `pId`, else `404`.

2. **Request body**: `{ "new_project_id": N }` where `N` is the target
   project. Validate it's a positive int and differs from `pId`; reject
   `400` otherwise.

3. **Permission**: add `ActionMoveIssue` to
   [backend/permissions.go](../../backend/permissions.go). My recommendation:
   `{RoleSysAdmin, RoleAdmin}` — moving an issue is a destructive,
   cross-project op (drops label/release, resets status). Mirror in
   [static/js/permissions.js](../../static/js/permissions.js).

4. **Handler** (`handleMoveIssue` in
   [backend/handlers.go](../../backend/handlers.go)):
   - Load issue via `GetIssueByIDInProject(id, projectID)` → `404` on nil
     (factory wrapper also enforces this, but keep the load for the
     business-logic step).
   - Validate `new_project_id` exists via `ProjectExists` → `400` if not.
   - Reset `label_id = NULL`, `release_id = NULL`, `status = StatusOpen`
     on the issue (matches the old in-place behavior that the test expects).
   - Set `project_id = new_project_id`.
   - Persist via `UpdateIssue(...)` (or a new `MoveIssue` DB helper if you
     prefer; existing `UpdateIssue` already writes `project_id`, so plain
     `UpdateIssue` works).
   - Return the updated issue as JSON.

5. **Tests** in [backend/handlers_test.go](../../backend/handlers_test.go):
   - Happy path: move issue from project 1 → project 2; verify response
     issue has `project_id=2`, `label=null`, `release_id=null`,
     `status="Open"`; verify the DB reflects the move.
   - Cross-project source: move via URL `/api/projects/2/issues/{id}` when
     the issue is in project 1 → `404`.
   - Same source and target: `new_project_id == pId` → `400`.
   - Unknown target: `new_project_id` doesn't exist → `400`.
   - Insufficient role: non-admin → `403`.

### Frontend

6. Add `moveIssue(currentProjectId, issueId, newProjectId)` in
   [static/js/api.js](../../static/js/api.js) — calls
   `POST /api/projects/{currentProjectId}/issues/{issueId}/move` with body
   `{ new_project_id: newProjectId }`. Return the updated issue.

7. In [static/js/components/modal.js](../../static/js/components/modal.js):
   - Re-enable `projectTrigger.disabled` only when permission allows
     (`userCan(state.currentUser, ACTION_MOVE_ISSUE)`).
   - In the project-select change handler (~line 943), replace the
     `saveIssueWithConflictCheck(updatedIssue, …)` path with a call to
     `moveIssue(state.currentIssue.project_id, state.currentIssue.id,
     newProjectId)`. On success, refresh `state.currentIssue` from the
     response and re-render the modal (label/release/status will be
     reset server-side).
   - Remove the tooltip/disable + the comment that points at this TODO.

8. Update the JS unit test for the project-select handler in
   [static/js/tests/modal.test.js](../../static/js/tests/modal.test.js)
   (search for "should save project update when project-select changes"):
   it currently asserts `api.updateIssue` is called; it must now assert
   `api.moveIssue` is called.

### Tests + docs

9. Un-skip the e2e test:
   [playwright/issue_edits.spec.ts](../../playwright/issue_edits.spec.ts)
   `'changing project resets label, release and status to defaults'`.
   Drop the `test.skip(...)` back to `test(...)` and update any inner
   `waitForResponse` substring filters to match `/move` if needed.

10. Update [docs/api.md](../../docs/api.md): add the new endpoint row in
    the Handler Mapping table and a new per-endpoint section under Issues.

11. Update [docs/swagger.json](../../docs/swagger.json) similarly.

12. Update [docs/user-management.md](../../docs/user-management.md) and
    [docs/usage-guide.md](../../docs/usage-guide.md) — add a "Move an issue
    to another project" row to the role matrix (admin/sysadmin only).

13. Update [docs/backend-architecture.md](../../docs/backend-architecture.md)
    — the "URL pins the project" rule gets a small caveat: "moves are a
    dedicated POST endpoint, not a PUT side effect."

## Architectural constraints

- Same factory + ownership rules as the rest of the refactor:
  permission check before any DB access; ownership via
  `GetIssueByIDInProject(id, pId)` in the handler; no Go-level
  `if x.ProjectID != pId` outside the DB layer.
- Don't pass `new_project_id` via query string — keep it in the body.
- Don't add a route shape like `POST /api/projects/{pId}/issues/{id}/move-to/{newPid}`;
  the URL path identifies one resource, and the move *value* belongs in
  the body. Stay consistent with how releases are triggered
  (`POST .../release` with body `{archive_done: bool}`).

## Verification checklist

- `go vet ./...` clean.
- `go test ./backend/...` passes (with new tests).
- `cd static/js && npm test` passes (with updated mock assertions).
- Manual: log in as admin, open an issue, change project — issue moves;
  label/release cleared; status resets to Open.
- Manual: log in as user — project-select still disabled.
- Playwright suite passes the unskipped test.

## Out of scope

- Per-project membership (separate work; see `checkProjectAccess`'s
  `TODO(per-project-membership)` marker in
  [backend/handlers.go](../../backend/handlers.go)).
- Task scoping (tasks remain flat per the original plan).
