# Unit Testing Frontend (JavaScript)

This directory contains the vanilla JavaScript frontend code for the wuFlow application.

## Testing

We use **Vitest** for unit testing logic-heavy components, ensuring that state management and data transformations are correct without relying on the DOM or backend.

### Setup

```bash
cd static/js
npm install
```

### Building the Frontend

The Go binary embeds the Vite production build (`vite.config.js`, see [docs/frontend.md](../../docs/frontend.md#build)), not the source files. Build it before `go run` and after every change in `static/`:
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

### Project Structure

The modules are described in [docs/frontend.md](../../docs/frontend.md#module-structure).

### Testing Strategy

- **Logic vs UI:** We test complex logic (filtering, sorting, state changes) in unit tests. UI interactions and flows are covered by Playwright E2E tests in the root `playwright/` directory.
- **Pure Functions:** Complex logic is extracted into pure functions (e.g., in `filters.js`) to make testing easier and independent of browser state.
