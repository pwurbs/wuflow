



# Testing Strategy

## 1. The Testing Pyramid

| Test Type | Scope | Tooling | SonarQube Reporting |
| :--- | :--- | :--- | :--- |
| **Unit (Backend)** | Go logic, APIs, Math | `go test` | **Yes** |
| **Unit (Frontend)** | JS State logic, Utilities | `Vitest` / `Jest` | **Yes** |
| **End-to-End** | Critical User Journeys | `Playwright` | **No** (Pass/Fail only) |

---

## 2. Backend Unit Testing (Go)
All business logic, database interactions (via interfaces), and API handlers must be covered by unit tests.
* **Focus:** Edge cases, error handling, and data validation.


## 3. Frontend Unit Testing (Plain JS)
Since the frontend contains complex state logic, we do not rely solely on the browser for testing.
Unit Tests verify logic and state.
Any JavaScript file containing "decisions" (if/else, state transitions, data mapping) must have a corresponding unit test.
* **Requirement:** Decouple state logic from the DOM.
* **Tool:** Vitest (preferred for speed).
* **Why:** Testing state transitions in a unit test is ~100x faster than in a browser.
All Unit tests are located in the [static/js](static/js/README.md) directory.


## 4. End-to-End (E2E) Tests
We use **Playwright** to ensure the "Happy Path" works across different browsers.
* **Focus:** Authentication flows, multi-step forms, and "critical path" UI rendering.
* **Policy:** We do not track code coverage for Playwright in SonarQube. E2E tests prove *functionality*, while Unit tests prove *logic correctness*. High E2E coverage often provides a false sense of security regarding edge cases.
This E2E test acts also as a kind of smoke or regression test.
All E2E tests are located in the [playwright](playwright/README.md) directory.


## 5. Quality Gate & SonarQube
SonarQube acts as the single source of truth for **Code Health**.

1. **Combined Coverage:** SonarQube aggregates coverage from both Go (`cover.out`) and JavaScript (`lcov.info`).
2. **Static Analysis:** We monitor for code smells, cognitive complexity (especially in JS state logic), and security vulnerabilities.
3. **Requirement:** New PRs should not decrease the overall coverage percentage.
