# Unit Testing Frontend (JavaScript)

This directory contains the vanilla JavaScript frontend code for the wuTrak application.

## Testing

We use **Vitest** for unit testing logic-heavy components, ensuring that state management and data transformations are correct without relying on the DOM or backend.

### Setup

```bash
cd static/js
npm install
```

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

- **`components/`**: UI components (Board, Backlog, etc.)
- **`tests/`**: Unit test files (collocated with logic where possible, or in this folder)
- **`filters.js`**: Pure functions for filtering and sorting issues (extracted for testability)
- **`state.js`**: Core client-side state management
- **`utils.js`**: Helper functions (HTML escaping, debouncing, etc.)
- **`api.js`**: Backend API interaction

### Testing Strategy

- **Logic vs UI:** We test complex logic (filtering, sorting, state changes) in unit tests. UI interactions and flows are covered by Playwright E2E tests in the root `playwright/` directory.
- **Pure Functions:** Complex logic is extracted into pure functions (e.g., in `filters.js`) to make testing easier and independent of browser state.

### Coverage Breakdown


| Module | Coverage | Status |
|--------|----------|--------|
| **`state.js`** | **100%** | ✅ **Covered**. All state transitions are verified. |
| **`filters.js`** | **100%** | ✅ **Covered**. Complex filtering/sorting logic is verified. |
| **`utils.js`** | **~31%** | ✅ **Sufficient**. Only pure functions (`stripHtml`, `escapeHtml`, `debounce`) covered. |
| **`components/board.js`** | **~90%** | ✅ **Excellent**. Rendering, drag-drop, and state updates covered. |
| **`components/tasks.js`** | **~84%** | ✅ **Detailed**. Rendering, status toggling, deletion, and editing covered. |
| **`components/modal.js`** | **~75%** | ✅ **Comprehensive**. Form state, inline editing, dropdowns, and helper functions covered. |
| Other `components/` | 0% | ✅ **Intended**. Pure DOM rendering delegated to E2E tests. |
| `api.js` | 0% | ⚠️ **Acceptable**. Contains only `fetch` wrappers. Logic is minimal. |


