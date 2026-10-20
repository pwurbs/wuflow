# wuFlow Maintenance Scripts

This directory contains scripts for maintaining and testing the wuFlow application.

## Scripts

### `seed_demo_data.sh`
A shell script that creates a fresh wuFlow SQLite database pre-loaded with realistic demo data. Use it to set up a demo environment or generate screenshots for the usage guide.

**What it creates:**
- 4 team members: one sysadmin, one admin, two regular users
- 2 projects: *Development* (board: In Review / In Testing / Staging) and *Company Website* (board: Draft / Review)
- Labels and releases per project, including closed releases
- 31 issues spread across all board statuses (Open, Todo, In Review, In Testing, Staging, Done, Archive)
- Subtasks for several issues with realistic done/pending progress
- Deadlines clustered within the next 10 days; archived issues linked to the closed release

All dates are relative to the day the script is run, so the data stays current whenever you use it.

**Usage:**
```bash
./scripts/seed_demo_data.sh [db-path] [password]
```
The script prompts for the database path (default: `wuflow.db`) and the password to assign to all demo accounts if not provided as arguments. The target path must not exist — the script exits immediately if it does.

**Requirements:** `sqlite3` and `python3` with the `bcrypt` package (`pip3 install bcrypt`).

### `generate_issues.mjs`
A script to generate 1000 issues with random data for testing and performance evaluation.

**Usage:**
```bash
node scripts/generate_issues.mjs
```
The script will ask for the admin password (`admin@local`) when started. It covers all issue states and assigns random labels and users where available.
It expects a running instance at http://localhost:8080

### `trivy_scan.sh`
A shell script to perform a local Trivy security scan on the container image, used by the "Scan Image" VS Code task and the `/release` Claude Code skill. It builds the image for arm64 only, tagged with the version from `VERSION`, saves it to a tarball, extracts it, and scans the contents for HIGH and CRITICAL vulnerabilities. The released multi-arch image comes from `image_release.sh`; scanning the arm64 build is enough as a check and much faster.

**Usage:**
```bash
./scripts/trivy_scan.sh
```
The script expects `container` and `trivy` to be installed and available in your PATH.

### `run_wapiti_scan.sh`
A fully automated two-phase shell script that:
1. Builds the frontend and the binary, then starts the wuFlow application on port 8088 using a temporary database.
2. Disables API rate limiting for the scan.
3. Automatically authenticates and retrieves a JWT token.
4. Performs an **Authenticated Scan**, which crawls and discovers all endpoints (saved as `report-auth.html`).
5. Performs an **Unauthenticated Scan** that attacks the same discovered URLs without the session cookie (saved as `report-unauth.html`).
6. Cleans up by stopping the server and removing the temporary database.

**Usage:**
```bash
./scripts/run_wapiti_scan.sh
```
The script expects Wapiti to be installed in a virtual environment at `~/python_wapiti_env`. Results are saved in the `./test-results` directory. If a server already listens on port 8088, e.g. one left over from an aborted scan, the script stops and names the process instead of killing it. `check_dependencies.sh` reports when a newer Wapiti release is available; update it with `~/python_wapiti_env/bin/pip install --upgrade wapiti3`.

### `check_dependencies.sh`
A shell script to check for available updates across all dependencies in the repository. It checks:
1. NPM dependencies in `static/js` (including the build tool Vite) and `playwright`.
2. Go modules updates, the Go version used by the repo (including minor patch updates), and runs `govulncheck`.
3. Whether the installed system Go and the Go used to build `gopls`, `gosec`, `govulncheck` and `golangci-lint` are older than the `go` directive in `go.mod`, and whether a newer `golangci-lint` release is available.
4. Whether newer Docker base images are available for the `FROM` lines of the `Dockerfile` (newest tag of the same form within the same major version, via the Docker Hub API).
5. Whether a newer Wapiti release is available on PyPI than the one in `~/python_wapiti_env` (see `run_wapiti_scan.sh`).
6. Whether a newer SonarScanner CLI release is available on GitHub than the installed `sonar-scanner` (see `sonar_scan.sh`). Only the CLI needs updating: SonarCloud supplies the analyzers on each scan.

Inside the repo `go version` reports the toolchain selected by `go.mod` (downloaded automatically), not the installed system Go — check 3 catches a system Go or tool build that was left behind after a Go version bump.

**Usage:**
```bash
./scripts/check_dependencies.sh
```
The script expects `go`, `npm` and `curl` to be available in your PATH.

### `new_version.sh`
A shell script to automate the versioning process for wuFlow, its Home Assistant Add-on and the Helm chart. It prompts for the new version, updates the `VERSION` file, patches the Home Assistant `config.yaml`, and sets `version`, `appVersion` and the `artifacthub.io/images` image tag in `chart/Chart.yaml` to the new version.

**Usage:**
```bash
./scripts/new_version.sh [version]
```
Without `version`, the script asks for it in a macOS dialog box (`osascript`), so it must be run on a macOS environment.

### `helm_release.sh`
A shell script to package the Helm chart in [`chart/`](../chart) and push it to GitHub Container Registry (`ghcr.io`) as an OCI artifact, using the version currently set in `chart/Chart.yaml`. It doesn't modify any files: it aborts if the chart `version`, `appVersion` and the `artifacthub.io/images` image tag differ.

**Usage:**
```bash
./scripts/helm_release.sh
```
The script expects `helm` (3.8+) to be available in your PATH, and a GitHub Personal Access Token with the `write:packages` scope, either exported as `GHCR_TOKEN` or entered when prompted. The login is skipped if a cached `ghcr.io` login already exists. Without a terminal (e.g. run by the `/release` skill), the script stops instead of prompting.

### `image_release.sh`
A shell script to build the multi-arch (`amd64`, `arm64`) container image with the version from the `VERSION` file and push it to GitHub Container Registry (`ghcr.io`).

**Usage:**
```bash
./scripts/image_release.sh
```
The script expects the Apple `container` CLI to be available in your PATH, and a GitHub Personal Access Token with the `write:packages` scope, either exported as `GHCR_TOKEN` or entered when prompted. The login is skipped if a cached `ghcr.io` login already exists. Without a terminal (e.g. run by the `/release` skill), the script stops instead of prompting.

### `go_checks.sh`
Runs the Go static-analysis and security checks used by the "Go Checks" VS Code task: `gosec` (sonarqube report), `golangci-lint run`, `golangci-lint fmt --diff`, and `govulncheck`. Each command's output is preceded by a banner so results are easy to scan in the console.

**Usage:**
```bash
./scripts/go_checks.sh
```
The script expects `gosec`, `go`, `golangci-lint` (v2), and `govulncheck` to be available in your PATH. `golangci-lint` is configured by [`.golangci.yml`](../.golangci.yml) in the repo root.

Every check runs even if an earlier one fails, so a single pass reports all problems. The script then prints a summary and exits `1` if any check failed (`0` only when all pass), which is what turns the "Go Checks" task red.

### `sonar_scan.sh`
Uploads a SonarCloud analysis of the current branch, used by the "Sonar" VS Code task and the `/sonar` Claude Code skill. It waits until SonarCloud has processed the report and exits `1` if the quality gate fails.

**Usage:**
```bash
./scripts/sonar_scan.sh
```
The script expects `sonar-scanner` in your PATH and a SonarCloud token exported as `SONAR_TOKEN`. It needs the coverage and gosec reports from the "Go Test", "JS Test" and "Go Checks" tasks; the VS Code task runs them first, and the script stops if a report is missing.

### `sonar_results.sh`
Prints the SonarCloud results for the current branch and for `main`: which commit was analysed (with a warning if it is not HEAD), the quality gate, open issues, security hotspots to review and the names of the rules found. The "Sonar" VS Code task runs it after `sonar_scan.sh`, also when the scan or the quality gate failed. Feature branches list the issues that `main`'s last analysis doesn't have, so `main` shows the existing ones; these are mostly in changed code, but a newer SonarCloud analyzer can also add findings in unchanged code.

**Usage:**
```bash
./scripts/sonar_results.sh
```
The script reads only the public SonarCloud API, so it needs no token; it expects `curl` and `jq` in your PATH. If an API request fails, it stops with exit code 1 instead of printing incomplete results.

### `release_check.sh`
Checks whether a release can start: the `/release` Claude Code skill runs it first in both modes and stops if it reports a problem. It prints the branch, `VERSION`, the last release (the highest `v*` tag on the `github` remote), the target version (`VERSION` without a `-preN` suffix) and the state: `pre`, `final` (not released yet) or `released` (no new version started). It exits `1` if the release can't go on:
- Both modes: a version copy that `new_version.sh` writes (Home Assistant `config.yaml`; `version`, `appVersion` and the `artifacthub.io/images` tag in `chart/Chart.yaml`) differs from `VERSION`; in state `final` also a missing `# X.Y.Z` section in `CHANGELOG.md`, `home-assistant-addon/CHANGELOG.md` or `chart/CHANGELOG.md`.
- `prepare`: not on a feature branch; uncommitted changes outside the files a release changes; or main has commits the feature branch lacks, so the merge would not be a fast-forward.
- `publish`: not on main; uncommitted changes; `VERSION` still has a pre suffix; or the version is already released.

**Usage:**
```bash
./scripts/release_check.sh prepare|publish
```
The script only reads, including the tags on GitHub (`git ls-remote`); it changes no files.

### `go_race_fuzz.sh`
Runs the slow Go test passes used by the "Go Race & Fuzz" VS Code task: the backend test suite under the race detector (`go test -race`), then every fuzz target for a fixed duration each.

**Usage:**
```bash
./scripts/go_race_fuzz.sh [fuzztime]
```
`fuzztime` is the fuzz duration per target (e.g. `30s`, `2m`, default `30s`); the VS Code task prompts for it. Like `go_checks.sh`, every step runs even if an earlier one fails, then a summary is printed and the script exits `1` if any step failed. A failing fuzz input is saved under `backend/testdata/fuzz/` and replayed by every later `go test` run.

### `diff_coverage.sh`
Calculates and visualizes code coverage changes compared to the `main` branch for both Go (backend) and Vitest (frontend). It generates a combined HTML report showing which new or modified lines are covered by tests.

**Usage:**
```bash
./scripts/diff_coverage.sh
```
The script expects `diff-cover` and `gocover-cobertura` (via `go run`) to be available. It assumes coverage data has already been generated.
