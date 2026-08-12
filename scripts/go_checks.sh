#!/usr/bin/env bash
#
# Runs the Go static-analysis / security checks used by the "Go Checks"
# VS Code task. Each command's output is delimited by a banner so the
# console output is easy to scan.

# Deliberately no `set -e`: every check runs even if an earlier one fails, so a
# single pass reports all problems rather than stopping at the first. Failures
# are collected by run_step and turned into a non-zero exit at the end, so the
# "Go Checks" task goes red instead of silently reporting success.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Failure bookkeeping. A counter plus a plain string rather than an array:
# macOS ships bash 3.2, where expanding an empty array under `set -u` errors.
FAILURE_COUNT=0
FAILED_STEPS=""

# The trailing `return 0` is redundant to bash (a function returns the status of
# its last command) but required by SonarQube, which flags functions without an
# explicit return. Keep it.
section() {
    local title="$1"
    echo ""
    echo "============================================================"
    echo "  $title"
    echo "============================================================"
    return 0
}

# run_step <title> <command...> — prints the banner, runs the command, and
# records a failure without aborting the script. Every tool used here exits
# non-zero on findings (and still writes its report file), so the exit code is
# the signal we key on.
run_step() {
    local title="$1"
    shift
    section "$title"
    "$@"
    local status=$?
    if [[ "$status" -ne 0 ]]; then
        echo ""
        echo "  ✗ FAILED (exit $status)"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        FAILED_STEPS="${FAILED_STEPS}  - ${title} (exit ${status})
"
    fi
    return "$status"
}

# gosec (sonarqube report) — feeds the Sonar scanner. golangci-lint runs gosec
# itself, but cannot emit the sonarqube format, so this step has to stay.
# Note: gosec skips _test.go unless -tests is passed, so test files are scanned
# by neither this step nor golangci-lint (which excludes them). That matches the
# exclusion rationale in .golangci.yml — test fixtures are not production risk.
run_step "gosec (sonarqube report → backend/test-results/gosec-report.json)" \
    gosec -fmt sonarqube -out backend/test-results/gosec-report.json ./...

# golangci-lint — the core static-analysis step, subsuming the former standalone
# gosec console, "go vet" and "gopls check" steps. Config: .golangci.yml (which
# also carries run.timeout, so every invocation gets it, not just this script).
run_step "golangci-lint run" golangci-lint run

# golangci-lint fmt — 'run' already reports formatting violations (the enabled
# formatters run as linters too); this step exists only to print the actual
# patch. --diff reports without rewriting, and covers the whole module, where
# the former "gofmt -d backend/*.go" step only looked at backend/*.go.
run_step "golangci-lint fmt --diff (formatting issues, if any)" \
    golangci-lint fmt --diff

# govulncheck — CVE database lookup rather than static analysis, so nothing in
# golangci-lint covers it.
run_step "govulncheck ./..." govulncheck ./...

section "Summary"
if [[ "$FAILURE_COUNT" -eq 0 ]]; then
    echo "All Go checks passed."
    exit 0
fi

echo "${FAILURE_COUNT} check(s) FAILED:"
printf '%s' "$FAILED_STEPS"
exit 1
