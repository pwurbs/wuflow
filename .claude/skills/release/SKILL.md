---
name: release
description: Prepares and publishes a wuFlow release — version, changelogs, Artifact Hub annotations, docs, all tests and scans, Sonar, container image, Helm chart, GitHub, wiki.
argument-hint: "prepare|publish"
disable-model-invocation: true
allowed-tools: Bash(./scripts/release_check.sh*) Bash(./scripts/run_wapiti_scan.sh*) Bash(sh scripts/trivy_scan.sh*) Bash(./scripts/sonar_scan.sh*) Bash(./scripts/sonar_results.sh*)
---

Mode `$ARGUMENTS`:
- `prepare` (P1–P7): everything local and reversible; ends with the release merged into the local main.
- `publish` (U1–U8): everything public. The user starts it once they decided the release goes out.
- Anything else: ask which mode.

## Rules for both modes
- Commits, pushes, the merge, `new_version.sh`, `helm` and the release scripts ask the user (ask rules).
  If the user declines, stop and report — never try another way.
- Checkpoint = say what to check and where, then wait for the user's "ok".
- A failed step stops the run: report it, classify test failures as in CLAUDE.md "Testing". After the
  fix the user runs the mode again; every step can be repeated.
- `X.Y.Z` below = the target version from the start check.
- Local steps: if `.claude/skills/release/local.md` exists (gitignored), follow it where it says. It
  holds steps for the maintainer's own environments.
- End each mode with a short report: what was done, findings, what's next.

## prepare
**P1 Start and version:** `./scripts/release_check.sh prepare`. On `PROBLEM` lines stop. By `State`:
`pre` → `./scripts/new_version.sh X.Y.Z`; `final` → nothing to do; `released` → no new version was
started: propose the next patch version, ask, then `./scripts/new_version.sh <version>`.

**P2 Changelogs and Artifact Hub.** Base: `git log --oneline main..HEAD` and `git diff main...HEAD`.
- `CHANGELOG.md`, section `# X.Y.Z`: propose missing user-facing lines (CLAUDE.md "Writing"); add
  them after the user's ok.
- `home-assistant-addon/CHANGELOG.md`: the same section with identical lines, at the top.
- `chart/CHANGELOG.md`, section `# X.Y.Z`: the chart changes (`git diff main...HEAD -- chart/`) plus
  the line `Bumped app version to X.Y.Z`.
- `chart/Chart.yaml`, `artifacthub.io/changes`: first entry `kind: changed`, `description: wuFlow X.Y.Z`,
  link "Release notes" → `https://github.com/pwurbs/wuflow/releases/tag/vX.Y.Z`; then one entry per
  chart change. Kinds: added, changed, deprecated, removed, fixed, security — by effect, `security`
  only for actual security fixes.
- `artifacthub.io/containsSecurityUpdates`: propose `"true"` if the app or the chart has a security
  change, else `"false"`; the user decides.

**P3 Docs:** run the doc-sync agent on the release diff (`main...HEAD`). Then check that docs/,
README.md, docs/swagger.json and chart/README.md cover every change; report gaps.

**P4 Tests and scans on the feature branch**, in this order; run long ones in the background.
Steps 1–3 also write the coverage and gosec reports that the Sonar scan in P7 uploads.
1. `go test -coverprofile=backend/test-results/coverage.out ./backend/...`
2. `./scripts/go_checks.sh`
3. `cd static/js && npm run test:coverage`
4. `./scripts/go_race_fuzz.sh`
5. `./scripts/check_dependencies.sh` — no pass/fail: list outstanding updates and npm audit /
   govulncheck findings; the user decides whether one blocks the release.
6. `./scripts/run_wapiti_scan.sh` — findings from `test-results/wapiti/` (console log, reports);
   compare with the accepted risks in docs/security-guidelines.md.
7. `helm lint chart`
8. `sh scripts/trivy_scan.sh` — builds the arm64 image `wuflow:X.Y.Z` and lists HIGH/CRITICAL findings.

**P5 Commit** all release changes on the feature branch, one commit:
`chore(release): Finalized changelog and version for X.Y.Z`.

**P6 Merge:** `git checkout main`, then `git merge --ff-only <feature branch>`. If it is not a
fast-forward, stop: main then differs from what P4 tested.

**P7 Final QA on main:**
- `cd playwright && npm test`
- Sonar: `./scripts/sonar_scan.sh`, then `./scripts/sonar_results.sh`. Only the quality gate counts
  here: if it failed, stop and report the failed conditions; the fix belongs on the feature branch.
  Mention the number of open issues on main for information, without classifying them.

Next: `/release publish`, once the user decided the release goes out.

## publish
**U1 Start:** `./scripts/release_check.sh publish`; on `PROBLEM` lines stop. Then
`./scripts/sonar_results.sh`: the quality gate on main must be OK and the analysis must be of HEAD;
otherwise stop.

**U2 Image:** `bash ./scripts/image_release.sh` — builds and pushes the multi-arch image. It needs a
cached ghcr.io login or `GHCR_TOKEN`; if it asks for a token, stop: the user runs the "Image Release" task.

**U3 Chart:** `bash ./scripts/helm_release.sh`. Checkpoint: the chart package on GitHub (Artifact Hub
picks it up later).

**U4 Push main:** `git push github main`.

**U5 Checkpoint:** the GitHub security report (Security tab of pwurbs/wuflow).

**U6 Wiki:** in `../wuflow.wiki`, if `git status` shows changes: commit `Changes for X.Y.Z`, then push.

**U7 GitHub release:** write the release notes from `.github/release_template.md`: sort the lines of
`CHANGELOG.md` `# X.Y.Z` into its sections, drop empty sections, add 1–3 highlights. Checkpoint: the
user creates the release with tag `vX.Y.Z` on main. Then `git fetch github --tags`.

**U8 Local steps** from `local.md`, if it exists.
