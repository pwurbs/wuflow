#!/usr/bin/env bash
#
# Uploads a SonarCloud analysis of the working tree for the current branch.
# Used by the "Sonar" VS Code task and the /sonar skill; sonar_results.sh
# prints the results.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# The scanner reads the token from SONAR_TOKEN itself; passing it as
# -Dsonar.token would show it in the process list. Without SONAR_TOKEN, the
# token comes from the macOS keychain.
if [[ -z "${SONAR_TOKEN:-}" ]] && command -v security >/dev/null 2>&1; then
    SONAR_TOKEN=$(security find-generic-password -a "$USER" -s wuflow-sonar-token -w 2>/dev/null || true)
    export SONAR_TOKEN
fi
if [[ -z "${SONAR_TOKEN:-}" ]]; then
    echo "SONAR_TOKEN is not set and the keychain item 'wuflow-sonar-token' could not be read (missing or access denied)." >&2
    exit 1
fi

# Written by the "Go Test", "JS Test" and "Go Checks" tasks. Without them the
# upload succeeds but reports zero coverage and no gosec findings.
for report in backend/test-results/coverage.out static/js/coverage/lcov.info backend/test-results/gosec-report.json; do
    if [[ ! -f "$report" ]]; then
        echo "Missing $report — run the Go Test, JS Test and Go Checks tasks first." >&2
        exit 1
    fi
done

# qualitygate.wait: return only after SonarCloud has processed the report, so
# the results can be read right away; exits non-zero if the quality gate fails.
sonar-scanner \
    -Dsonar.projectVersion="$(cat VERSION)" \
    -Dsonar.branch.name="$(git branch --show-current)" \
    -Dsonar.qualitygate.wait=true
