# wuFlow Maintenance Scripts

This directory contains scripts for maintaining and testing the wuFlow application.

## Scripts

### `generate_issues.mjs`
A script to generate 1000 issues with random data for testing and performance evaluation.

**Usage:**
```bash
node scripts/generate_issues.mjs
```
The script will ask for the admin password (`admin@local`) when started. It covers all issue states and assigns random labels and users where available.
It expects a running instance at http://localhost:8080

### `trivy_scan.sh`
A shell script to perform a local Trivy security scan on the container image. It saves the current version's image to a tarball, extracts it, and scans the contents for vulnerabilities.

**Usage:**
```bash
sh scripts/trivy_scan.sh
```
The script expects `container` and `trivy` to be installed and available in your PATH.

### `run_wapiti_scan.sh`
A fully automated two-phase shell script that:
1. Starts the wuFlow application on port 8088 using a temporary database.
2. Disables API rate limiting for the scan.
3. Performs an **Unauthenticated Scan** (saved as `report-unauth.html`).
4. Automatically authenticates and retrieves a JWT token.
5. Performs an **Authenticated Scan** (saved as `report-auth.html`).
6. Cleans up by stopping the server and removing the temporary database.

**Usage:**
```bash
./scripts/run_wapiti_scan.sh
```
The script expects Wapiti to be installed in a virtual environment at `~/python_wapiti_env`. Results are saved in the `./test-results` directory.
