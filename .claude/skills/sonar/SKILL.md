---
name: sonar
description: Runs the SonarCloud analysis for the current branch, reads the open issues, hotspots and quality gate from the SonarCloud API, classifies them and proposes fixes.
argument-hint: "[fetch]"
disable-model-invocation: true
allowed-tools: Bash(./scripts/sonar_scan.sh*) Bash(./scripts/sonar_results.sh*)
---

SonarCloud project `wuflow-oss`, organization `pwurbs-oss` (sonar-project.properties). The project
is public: reading the API needs no token. Only the upload in step 2 uses `SONAR_TOKEN`, which the
scanner reads from the environment. Never print it or put it on a command line.

Mode: `$ARGUMENTS` = `fetch` → skip steps 1–2 (the user already ran the "Sonar" VS Code task);
otherwise run all steps.

## 1. Prerequisites
Run in order; if one fails, stop and report — do not scan:
- `go test -coverprofile=backend/test-results/coverage.out ./backend/...`
- `cd static/js && npm run test:coverage`
- `./scripts/go_checks.sh` (writes the gosec report; findings make it exit 1 — report them, then
  ask whether to scan anyway)

## 2. Scan
`./scripts/sonar_scan.sh > <scratchpad>/sonar-scan.log 2>&1` — uploads and waits for the quality
gate. A non-zero exit after the upload because the gate failed is a result for step 5, not an error.
Then `grep -E 'WARN|ERROR'` the log and report each line in step 5: a parser warning means Sonar
skipped that file, so its issues are missing from the results.

## 3. Fetch
`./scripts/sonar_results.sh` — prints the analysis state, then quality gate, open issues and hotspots
to review for the current branch and for `main`, then the rule names with links (the API has no rule
descriptions). Feature branches list only issues in code changed against `main`, so `main` holds
the existing debt. Carry its WARNING/NOTE lines (analysis not of HEAD, uncommitted changes) to the
top of the report: the results describe the analysed commit, not the current code.

## 4. Classify
Group the issues by rule. Read the flagged lines, then put each group (or single issue) in one class.
For CSS rules such as `!important` or specificity, first find the rules the flagged one competes
with (same element, other selectors, load order in `static/styles/main.css` and `login.html`):
whether `!important` is redundant, needed or covers a duplicate decides the class.
- **fix** — a real issue a code change removes. Name the change and the tests it touches.
- **conflicts with a project decision** — the code is like this on purpose: CLAUDE.md, docs/
  (especially docs/security-guidelines.md), a code comment. Quote the decision and ask.
- **false positive / ignored on purpose** — list the options, without a default:
  exclusion via `sonar.issue.ignore.multicriteria` in sonar-project.properties, the user marks it
  as Accepted / False positive in the SonarCloud UI, or `//NOSONAR` on the line.

## 5. Report and stop
Start with the quality gate (status, failed conditions), the lag warning and the scanner warnings
from step 2, if any. Then one table each for the current branch (new issues) and `main` (debt)
with: rule (linked), name, type/severity, count, files:lines, class, proposed action. Hotspots to
review in a separate list.

Then stop. The user decides what gets fixed; fixes follow CLAUDE.md "Testing". Never change issue
or hotspot status through the API, and never add exclusions or `//NOSONAR` without the user's go.
