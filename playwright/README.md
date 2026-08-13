# End-to-End Tests

## Automated Regression Testing
This project uses **Playwright** for automated UI/DOM regression testing.

### Prerequisites
- Node.js installed
- Docker/Podman/Container (for running the containerized app)

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
The tests run against a containerized instance of the application to ensure a clean state (ephemeral database).

1. **Start the Container**:
   ```bash
   container run -d -p 8080:8080 --name wuflow-test wuflow
   ```

2. **Run the Tests**:
   ```bash
   npm test
   ```

3. **Cleanup**:
   ```bash
   container stop wuflow-test && container rm wuflow-test
   ```

4. **Open Test Report**:
   ```bash
   open playwright-report/index.html
   ```

### VS Code Tasks
You can also use the defined VS Code tasks to run the full regression pipeline:
- **Run Regression Tests**: Executes the full sequence (Start -> Test -> Stop -> Open Report).
- **Start Test Container**: Starts the ephemeral DB container.
- **Run E2E Tests**: Runs the Playwright tests.
- **Stop Test Container**: Stops and removes the container.
- **Open Test Report**: Opens the HTML report in your default browser.

---

## Test Concept

### Philosophy
- **Happy Path Testing**: Tests focus on essential user flows that cover core functionality
- **Fresh Database**: Each test run starts with an empty database (ephemeral container)
- **Complete User Flows**: Tests simulate real user journeys rather than isolated unit actions
- **Cross-Browser**: Tests can run on Chromium, Firefox, and WebKit (Chromium only by default for speed)

### Sequential Execution Mode

> [!IMPORTANT]
> Tests run in **sequential mode** (`workers: 1`) to avoid database state conflicts.

Since all tests share the same database instance in the container, parallel test execution would cause issues:
- Tests create data that persists across the test run
- Multiple tests modifying data simultaneously leads to unpredictable state
- Selectors may match elements from other tests' data

To enable cross-browser testing, uncomment Firefox/WebKit in `playwright.config.ts`. For a completely fresh state, restart the container between test runs.

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
| Releases | `releases.spec.ts` | Release lifecycle and trigger behaviour |
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
├── global-setup.ts        # Builds the binary before the run
├── global-teardown.ts     # Opens the report, checks backend logs
├── *.spec.ts              # Test suites (see the table above)
└── helpers/
    └── test-utils.ts      # Shared test utilities
```
