# wuTrak

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
   container run -d -p 8080:8080 --name wutrak-test wutrak
   ```

2. **Run the Tests**:
   ```bash
   npm test
   ```

3. **Cleanup**:
   ```bash
   container stop wutrak-test && container rm wutrak-test
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

| Suite | File | Purpose |
|-------|------|---------|
| Landing Page | `landing_page.spec.ts` | Verifies app loads correctly with all UI elements |
| Issues | `issues.spec.ts` | CRUD operations for issues |
| Board | `board.spec.ts` | Kanban board navigation, drag-drop, sidebars |
| Backlog | `backlog.spec.ts` | Backlog view and status transitions |
| Labels | `labels.spec.ts` | Label management in Setup |
| Tasks | `tasks.spec.ts` | Subtask creation and management |
| Filters | `filters.spec.ts` | Label, priority, and text filtering |

### File Structure
```
playwright/
├── playwright.config.ts   # Playwright configuration
├── landing_page.spec.ts   # Landing page tests
├── issues.spec.ts         # Issue CRUD tests
├── board.spec.ts          # Board functionality tests
├── backlog.spec.ts        # Backlog view tests
├── labels.spec.ts         # Label management tests
├── tasks.spec.ts          # Subtask tests
├── filters.spec.ts        # Filter/search tests
└── helpers/
    └── test-utils.ts      # Shared test utilities
```
