#!/usr/bin/env bash
#
# Runs the Go static-analysis / security checks used by the "Go Checks"
# VS Code task. Each command's output is delimited by a banner so the
# console output is easy to scan.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

section() {
    local title="$1"
    echo ""
    echo "============================================================"
    echo "  $title"
    echo "============================================================"
    return 0
}

# gosec (sonarqube report) — feeds the Sonar scanner. golangci-lint runs gosec
# itself, but cannot emit the sonarqube format, so this step has to stay. It
# also still covers the test files, which .golangci.yml excludes from gosec.
section "gosec (sonarqube report → backend/test-results/gosec-report.json)"
gosec -fmt sonarqube -out backend/test-results/gosec-report.json ./...

# golangci-lint — the core static-analysis step. Config: .golangci.yml (which
# also carries run.timeout, so every invocation gets it, not just this script).
#
# Three former steps were dropped here because golangci-lint subsumes them:
#   - "gosec (console output)" : gosec runs as one of its linters
#   - "go vet ./..."           : govet is part of its default 'standard' set
#   - "gopls check"            : those diagnostics are the staticcheck suite,
#                                which golangci-lint runs directly
section "golangci-lint run"
golangci-lint run

# golangci-lint fmt — 'run' does NOT check formatting in v2, only 'fmt' does, so
# this replaces the former "gofmt -d backend/*.go" step. --diff reports without
# rewriting, and covers the whole module with gofmt + goimports, where the old
# step only looked at backend/*.go.
section "golangci-lint fmt --diff (formatting issues, if any)"
golangci-lint fmt --diff

# govulncheck — CVE database lookup rather than static analysis, so nothing in
# golangci-lint covers it.
section "govulncheck ./..."
govulncheck ./...

echo ""
echo "All Go checks finished."
