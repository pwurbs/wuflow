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
