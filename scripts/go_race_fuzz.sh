#!/usr/bin/env bash
#
# Runs the slow Go test passes used by the "Go Race & Fuzz" VS Code task: the
# backend test suite under the race detector, then every fuzz target for a
# fixed duration. Kept separate from the "Go Test" task because both passes
# take minutes rather than seconds.
#
# Usage: ./scripts/go_race_fuzz.sh [fuzztime]   (default: 30s per fuzz target)

# Deliberately no `set -e`: every step runs even if an earlier one fails, so a
# single pass reports all problems. Failures are collected by run_step and
# turned into a non-zero exit at the end, so the task goes red.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FUZZTIME="${1:-30s}"
# Every Fuzz* function in the backend package, so new fuzz tests are picked up automatically.
FUZZ_TARGETS=$(go test -list '^Fuzz' ./backend/ | grep '^Fuzz')

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
# records a failure without aborting the script.
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

# -count=1 bypasses the test cache: a cached pass from a plain "go test" run
# would otherwise be reported without the race detector ever executing.
run_step "go test -race ./backend/..." go test -race -count=1 ./backend/...

# One target per invocation: go test -fuzz accepts only a single matching target.
for t in $FUZZ_TARGETS; do
    run_step "fuzz $t ($FUZZTIME)" go test -run='^$' -fuzz="^${t}\$" -fuzztime="$FUZZTIME" ./backend/
done

section "Summary"
if [[ "$FAILURE_COUNT" -eq 0 ]]; then
    echo "All race and fuzz runs passed."
    exit 0
fi

echo "${FAILURE_COUNT} run(s) FAILED:"
printf '%s' "$FAILED_STEPS"
exit 1
