#!/usr/bin/env bash
#
# Runs the Go static-analysis / security checks used by the "Go Checks"
# VS Code task. Each command's output is delimited by a banner so the
# console output is easy to scan.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

section() {
    echo ""
    echo "============================================================"
    echo "  $1"
    echo "============================================================"
}

# gosec (sonarqube report) — feeds the Sonar scanner
section "gosec (sonarqube report → backend/test-results/gosec-report.json)"
gosec -fmt sonarqube -out backend/test-results/gosec-report.json ./...

# gosec (console output) — for standalone reading
section "gosec (console output)"
gosec ./...

# go vet
section "go vet ./..."
go vet ./...

# govulncheck
section "govulncheck ./..."
govulncheck ./...

# gopls check
section "gopls check -severity=hint backend/*.go"
gopls check -severity=hint backend/*.go

echo ""
echo "All Go checks finished."
