# Testing Approach

## Overview

| Test Type | Scope | Tooling | SonarQube Reporting |
| :--- | :--- | :--- | :--- |
| **Unit (Backend)** | Go logic, APIs, Math | `go test` | Yes |
| **Unit (Frontend)** | JS State logic, Utilities | `vitest` | Yes |
| **End-to-End** | Essential User Journeys | `playwright` | No |
| **Go Fuzzing** | Edge Cases, Input Validation | `go test -fuzz` | No |
| **Vulnerability Scan** | Security vulnerabilities | `wapiti` | No |
| **Image Scanning** | Container security | `trivy` | No |

Additionally, the whole repository is under security monitoring using [snyk.io](https://snyk.io).

---

## Backend Unit Testing (Go)
All business logic, database interactions (via interfaces), and API handlers must be covered by unit tests.
* **Focus:** Edge cases, error handling, and data validation (Title, Name, Color).
 
## Fuzz Testing (Go)
We use Go's native fuzzing (`go test -fuzz`) to discover edge-case panics and security bypasses in our validation logic.
* **Focus:** NUL byte stripping, HTML tag removal from plain-text fields (Title), and password normalization across complex character sets.
* **Markdown:** Note that the Markdown **description** field is *not* sanitized by the backend (only length-checked). Sanitization is a frontend responsibility. See [Markdown Security](markdown-security.md).


## Frontend Unit Testing (Plain JS)
Since the frontend contains complex state logic, we do not rely solely on the browser for testing.
Unit Tests verify logic and state.
Any JavaScript file containing "decisions" (if/else, state transitions, data mapping) must have a corresponding unit test.
* **Requirement:** Decouple state logic from the DOM.
* **Tool:** Vitest (preferred for speed).
* **Why:** Testing state transitions in a unit test is ~100x faster than in a browser.
All Unit tests are located in the [static/js](static/js/README.md) directory.


## End-to-End (E2E) Tests
We use **Playwright** to ensure that the essential user related functions are working as expected.
* **Focus:** Authentication flows, multi-step forms, and "critical path" UI rendering.
* **Policy:** We do not track code coverage for Playwright in SonarQube. E2E tests prove *functionality*, while Unit tests prove *logic correctness*. High E2E coverage often provides a false sense of security regarding edge cases.
This E2E test acts also as a kind of smoke or regression test.
All E2E tests are located in the [playwright](playwright/README.md) directory.


## Quality Gate & SonarQube
SonarQube acts as the single source of truth for **Code Health**.

1. **Combined Coverage:** SonarQube aggregates coverage from both Go (`cover.out`) and JavaScript (`lcov.info`).
2. **Static Analysis:** We monitor for code smells, cognitive complexity (especially in JS state logic), and security vulnerabilities.
3. **Requirement:** New PRs should not decrease the overall coverage percentage.

## Vulnerability Scan
We use **Wapiti** to perform black-box vulnerability scanning against the running application.
* **Focus:** Identifying security flaws like XSS, SQLi, and misconfigurations from an external attacker's perspective.
* **Process:** Automated scans are run against both unauthenticated and authenticated application states to ensure comprehensive coverage.

## Image Scanning
We use **Trivy** to scan the generated container images for known vulnerabilities (CVEs).
* **Focus:** Ensuring that the base images and OS-level dependencies are free of known security issues.
* **Process:** Performed to catch vulnerable packages in the environment running the application.
