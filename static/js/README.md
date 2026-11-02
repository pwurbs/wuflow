# Unit Testing Frontend (TypeScript)

This directory contains the TypeScript frontend without a framework of the wuFlow application.

## Testing

We use **Vitest** for unit testing logic-heavy components, ensuring that state management and data transformations are correct without relying on the DOM or backend.

### Setup

```bash
cd static/js
npm install
```

### Building the Frontend

The Go binary embeds the Vite production build (`vite.config.ts`, see [docs/frontend.md](../../docs/frontend.md#build)), not the source files. Build it before `go run` and after every change in `static/`:
```bash
npm run build
```
The output goes to `static/dist/app` (not committed). The "Run locally" task, the Playwright global setup, the Dockerfile and `scripts/run_wapiti_scan.sh` run this build themselves.

### Running Tests

Run all unit tests:
```bash
npm test
```

Run tests with coverage (generates LCOV report for SonarQube in `coverage/`):
```bash
npm run test:coverage
```

Check the types (see [docs/frontend.md](../../docs/frontend.md#type-checking)):
```bash
npm run typecheck
```

### Project Structure

The modules are described in [docs/frontend.md](../../docs/frontend.md#module-structure).

### Testing Strategy

- **Logic vs UI:** We test complex logic (filtering, sorting, state changes) in unit tests. UI interactions and flows are covered by Playwright E2E tests in the root `playwright/` directory.
- **Pure Functions:** Complex logic is extracted into pure functions (e.g., in `filters.ts`) to make testing easier and independent of browser state.
- **Test Data:** Tests build API objects with the factories in `tests/fixtures.ts` (`makeIssue({ status: 'Done' })` etc.), which fill every other field with an empty value, so a test states only the fields it is about. A mocked save answers with `savedIssue(sent)`, the issue as the server returns it.
