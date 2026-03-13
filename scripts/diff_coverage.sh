#!/bin/bash
# Check diff coverage for Vitest and Go tests compared to main branch

set -e

echo "Converting Go coverage to Cobertura format..."
go run github.com/boumenot/gocover-cobertura@latest < backend/test-results/coverage.out > backend/test-results/coverage.xml

echo "Running diff-cover..."
diff-cover static/js/coverage/cobertura-coverage.xml backend/test-results/coverage.xml --compare-branch=main --format html:test-results/code-coverage.html

echo "Opening coverage report..."
if [[ -f "test-results/code-coverage.html" ]]; then
    open test-results/code-coverage.html
else
    echo "Error: Report file not found at test-results/code-coverage.html" >&2
    exit 1
fi
