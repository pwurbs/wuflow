# End-to-End Tests

## Automated Regression Testing
This project uses **Playwright** for automated UI/DOM regression testing.

### Prerequisites
- Node.js (version 24+)
- Go (the tests start the app from source with `go run`)
- The frontend dependencies installed once: `npm ci` in `static/js`

### Setup
All commands in this section must be executed in the `playwright` directory.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install Playwright browsers (locally):
   ```bash
   npx playwright install
   ```

### Running Tests
Run the tests in the `playwright` directory, or with the VS Code task **Run Playwright Tests**:
```bash
npm test
```

A run proceeds as follows:
1. **Global setup** (`global-setup.ts`) builds the frontend (`npm run build` in `static/js`), because the Go binary embeds the build output. It also stops servers left over from an earlier run and deletes old test data.
2. **Per worker** (`fixtures.ts`), Playwright starts its own app server with `go run .` on ports 8090–8094, each with a fresh SQLite database and a random admin password under `test-data/worker-<n>/`.
3. **Global teardown** (`global-teardown.ts`) opens the HTML report (`playwright-report/index.html`) and lists every WARN/ERROR line of the backend logs (`test-data/worker-<n>/backend.log`).

Set `SKIP_SETUP=1` to skip the cleanup of the global setup; the frontend build always runs.

---

## Test Concept

### Philosophy
- **Happy Path Testing**: Tests focus on essential user flows that cover core functionality
- **Fresh Database**: Each worker starts with an empty database of its own
- **Complete User Flows**: Tests simulate real user journeys rather than isolated unit actions
- **Cross-Browser**: Tests can run on Chromium, Firefox, and WebKit (Chromium only by default for speed)

### Parallel Execution
Tests run fully parallel with 5 workers (`playwright.config.ts`). Each worker has its own server and database, so workers never see each other's data. Tests within a worker share that worker's database, so a test must not rely on data it did not create itself, e.g. use unique names (`Date.now()`) and scope selectors to its own items.

To enable cross-browser testing, uncomment Firefox/WebKit in `playwright.config.ts`.

### Test Suites

The three issue-related suites are split by *what* is under test, not by which screen it happens on:

- `issues.spec.ts` — the issue lifecycle: creating and deleting an issue, and the board reflecting it
- `issue_edits.spec.ts` — what an individual field does when changed (status, priority, description, deadline)
- `modal_behavior.spec.ts` — the modal as a widget, regardless of field: save timing, unload guard, scroll cue

Permission-gated behaviour belongs in `role_authorization.spec.ts` even when the gated control lives in the issue modal, and drag-and-drop belongs in `board.spec.ts` even when it changes issue data.

| Suite | File | Purpose |
|-------|------|---------|
| Landing Page | `landing_page.spec.ts` | Verifies app loads correctly with all UI elements |
| Issues | `issues.spec.ts` | Issue lifecycle: create, delete, assignee binding |
| Issue Edits | `issue_edits.spec.ts` | Per-field edits: status, priority, description, deadlines, project change |
| Modal Behavior | `modal_behavior.spec.ts` | Modal mechanics: autosave on blur/Done, unload guard, scroll cue |
| Activity | `activity.spec.ts` | Issue History and Comments tabs |
| Board | `board.spec.ts` | Kanban board navigation, drag-drop, card context menu |
| Board Columns | `board_columns.spec.ts` | Per-project column naming and visibility config |
| Backlog | `backlog.spec.ts` | Backlog view, status transitions, release lanes |
| Archive | `archive.spec.ts` | Archive view and un/archiving |
| Planning | `planning.spec.ts` | Planning panel scheduling |
| Releases | `releases.spec.ts` | Release lifecycle and trigger behaviour, request efficiency of view switches and refreshes |
| Labels | `labels.spec.ts` | Label management, including project scoping |
| Tasks | `tasks.spec.ts` | Subtask creation, management, deadline warnings |
| Filters | `filters.spec.ts` | Label, priority, and text filtering |
| Projects | `projects.spec.ts` | Project management and project selector |
| Users | `users.spec.ts` | User management |
| Auth | `auth.spec.ts` | Authentication security and rate limiting |
| Authorization | `role_authorization.spec.ts` | Role-based UI and API restrictions |
| Notifications | `notifications.spec.ts` | Toast notifications on issue actions |
| Concurrent Editing | `concurrent_editing.spec.ts` | ETag-based edit conflict detection |
| Input Validation | `input_validation.spec.ts` | Length limits on issue and task input |
| Edge Cases | `edge_cases.spec.ts` | Validation and release edge cases |
| System | `system.spec.ts` | Client disconnect and graceful shutdown |

### File Structure
```
playwright/
├── playwright.config.ts   # Playwright configuration
├── fixtures.ts            # Per-worker server + login fixtures
├── global-setup.ts        # Builds the frontend, cleans up stale servers and test data
├── global-teardown.ts     # Opens the report, checks backend logs
├── *.spec.ts              # Test suites (see the table above)
└── helpers/
    ├── server-utils.ts    # Server start/stop helpers for the fixtures
    └── test-utils.ts      # Shared test utilities
```
