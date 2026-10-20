#!/usr/bin/env bash
#
# Start checks of the /release skill. Prints the release state and exits 1 if
# the release can't go on. "prepare" expects the feature branch, "publish"
# expects main after the merge. Reads the release tags from GitHub; changes
# nothing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

REMOTE="github"
# Files the release itself changes. Uncommitted changes to only these files
# come from an earlier, unfinished prepare run and don't block it.
RELEASE_FILES='^(VERSION|CHANGELOG\.md|README\.md|home-assistant-addon/(CHANGELOG\.md|config\.yaml)|chart/(Chart\.yaml|CHANGELOG\.md|README\.md)|docs/.*)$'

MODE="${1:-}"
if [[ "$MODE" != "prepare" && "$MODE" != "publish" ]]; then
    echo "Usage: $0 prepare|publish" >&2
    exit 2
fi

PROBLEMS=0

# The trailing `return 0` is required by SonarQube (see go_checks.sh).
problem() {
    echo "PROBLEM: $1"
    PROBLEMS=$((PROBLEMS + 1))
    return 0
}

# newer <a> <b> — true if version a is higher than version b.
newer() {
    local a="$1" b="$2"
    [[ "$a" != "$b" && "$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -1)" == "$a" ]]
}

BRANCH="$(git branch --show-current)"
VERSION="$(cat VERSION)"
TARGET="${VERSION%%-*}"
LAST_RELEASE="$(git ls-remote --tags --refs "$REMOTE" 'v*' | awk '{print $2}' \
    | sed 's#^refs/tags/v##' | sort -V | tail -1)"

# pre: VERSION is X.Y.Z-preN, final: X.Y.Z not released yet,
# released: X.Y.Z is not newer than the last release, no new version was started.
if [[ -n "$LAST_RELEASE" ]] && ! newer "$TARGET" "$LAST_RELEASE"; then
    STATE="released"
elif [[ "$VERSION" != "$TARGET" ]]; then
    STATE="pre"
else
    STATE="final"
fi

echo "Branch:        $BRANCH"
echo "VERSION:       $VERSION"
echo "Last release:  ${LAST_RELEASE:-none} (tags on $REMOTE)"
echo "Target:        $TARGET"
echo "State:         $STATE"

check_prepare() {
    local dirty other
    if [[ -z "$BRANCH" || "$BRANCH" == "main" ]]; then
        problem "prepare runs on the feature branch, not on '${BRANCH:-detached HEAD}'."
    fi
    dirty="$(git status --porcelain | cut -c4-)"
    other="$(grep -Ev "$RELEASE_FILES" <<<"$dirty" | grep . || true)"
    if [[ -n "$other" ]]; then
        problem "uncommitted changes outside the release files: $(tr '\n' ' ' <<<"$other")"
    elif [[ -n "$dirty" ]]; then
        echo "NOTE: uncommitted release changes from an earlier run: $(tr '\n' ' ' <<<"$dirty")"
    fi
    if ! git merge-base --is-ancestor main HEAD; then
        problem "main has commits this branch lacks; the merge would not be a fast-forward."
    fi
    if [[ "$STATE" == "released" ]]; then
        echo "NOTE: $TARGET is already released; no new version was started."
    fi
    return 0
}

check_publish() {
    if [[ "$BRANCH" != "main" ]]; then
        problem "publish runs on main, not on '${BRANCH:-detached HEAD}'."
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        problem "the working tree has uncommitted changes."
    fi
    case "$STATE" in
        pre) problem "VERSION still has a pre suffix; run prepare first." ;;
        released) problem "v$TARGET is already released." ;;
        *) ;; # final: nothing to check
    esac
    return 0
}

"check_$MODE"

if [[ "$PROBLEMS" -gt 0 ]]; then
    echo "RESULT: $PROBLEMS problem(s)"
    exit 1
fi
echo "RESULT: OK"
