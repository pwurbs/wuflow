#!/usr/bin/env bash
#
# Prints the SonarCloud results for the current branch and for main: analysis
# state, quality gate, open issues, security hotspots to review and the names
# of the rules found. Used by the "Sonar" VS Code task and the /sonar skill.
# Reads only the public API, so no token is needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

API="https://sonarcloud.io/api"
# The same project the scanner uploads to (sonar_scan.sh).
PROJECT="$(sed -n 's/^sonar\.projectKey=//p' sonar-project.properties)"
ORG="$(sed -n 's/^sonar\.organization=//p' sonar-project.properties)"
PAGE_SIZE=500

BRANCH="$(git branch --show-current)"
if [[ -z "$BRANCH" ]]; then
    echo "Not on a branch (detached HEAD)." >&2
    exit 1
fi

# Rule keys of all issues and hotspots printed, for the rule list at the end.
RULES=""

# The trailing `return 0` is required by SonarQube (see go_checks.sh).
section() {
    echo ""
    echo "============================================================"
    echo "  $1"
    echo "============================================================"
    return 0
}

# api <path> <curl args...> — GET request to the SonarCloud API. bash turns off
# `set -e` inside $(...), so callers there must pass a failure on themselves.
api() {
    local path="$1"
    shift
    curl -sSfG "$API/$path" "$@" || return 1
    return 0
}

table() {
    column -t -s $'\t'
    return 0
}

print_analysis_state() {
    section "Analysis state"
    local branches head analysed
    branches="$(api project_branches/list -d project="$PROJECT")"
    head="$(git rev-parse HEAD)"
    { printf 'BRANCH\tTYPE\tANALYSED\tCOMMIT\n'
      jq -r --arg b "$BRANCH" '.branches[] | select(.name == $b or .isMain)
        | [.name, .type, .analysisDate, .commit.sha[0:7]] | @tsv' <<<"$branches"; } | table
    analysed="$(jq -r --arg b "$BRANCH" '.branches[] | select(.name == $b) | .commit.sha' <<<"$branches")"
    echo ""
    if [[ -z "$analysed" ]]; then
        echo "WARNING: branch $BRANCH has no analysis yet."
    elif [[ "$analysed" != "$head" ]]; then
        echo "WARNING: the analysis is of commit ${analysed:0:7}, HEAD is ${head:0:7}; the results describe that commit."
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "NOTE: the working tree has uncommitted changes; the results may not match it."
    fi
    if [[ "$BRANCH" != "main" ]]; then
        echo "NOTE: $BRANCH is a short-lived branch: it lists the issues main's last analysis doesn't have"
        echo "      (mostly in changed code, but also new analyzer findings in unchanged code)."
    fi
    return 0
}

print_quality_gate() {
    local branch="$1"
    echo "Quality gate:"
    api qualitygates/project_status -d projectKey="$PROJECT" --data-urlencode "branch=$branch" \
        | jq -r '.projectStatus | "  \(.status)", (.conditions[] | select(.status != "OK")
            | "  failed: \(.metricKey) = \(.actualValue) (\(.comparator) \(.errorThreshold))")'
    return 0
}

# fetch_all <path> <jq row filter> <curl args...> — the rows of all result
# pages. Runs inside $(...), so every step passes a failure on explicitly.
fetch_all() {
    local path="$1" filter="$2" page=1 json total
    shift 2
    while :; do
        json="$(api "$path" "$@" -d ps="$PAGE_SIZE" -d p="$page")" || return 1
        jq -r "$filter" <<<"$json" || return 1
        total="$(jq -r '.paging.total' <<<"$json")" || return 1
        if (( page * PAGE_SIZE >= total )); then
            break
        fi
        page=$((page + 1))
    done
    return 0
}

# print_rows <label> <header> <rows> — count and table of TSV rows whose first
# column is a rule key; the keys are collected for print_rules.
print_rows() {
    local label="$1" header="$2" rows="$3"
    echo ""
    if [[ -z "$rows" ]]; then
        echo "$label: 0"
        return 0
    fi
    echo "$label: $(grep -c . <<<"$rows")"
    { printf '%s\n' "$header"; printf '%s\n' "$rows"; } | table
    RULES="${RULES}$(cut -f1 <<<"$rows")"$'\n'
    return 0
}

print_issues() {
    local rows
    rows="$(fetch_all issues/search '.issues[] | [.rule, .severity, .type,
            "\(.component | sub("^[^:]*:"; "")):\(.line // "-")", .message] | @tsv' \
        -d componentKeys="$PROJECT" -d organization="$ORG" --data-urlencode "branch=$1" -d resolved=false)"
    print_rows "Open issues" $'RULE\tSEVERITY\tTYPE\tFILE:LINE\tMESSAGE' "$rows"
    return 0
}

print_hotspots() {
    local rows
    rows="$(fetch_all hotspots/search '.hotspots[] | [.ruleKey, .vulnerabilityProbability,
            "\(.component | sub("^[^:]*:"; "")):\(.line // "-")", .message] | @tsv' \
        -d projectKey="$PROJECT" --data-urlencode "branch=$1" -d status=TO_REVIEW)"
    print_rows "Security hotspots to review" $'RULE\tPROBABILITY\tFILE:LINE\tMESSAGE' "$rows"
    return 0
}

print_branch() {
    local branch="$1"
    section "Branch $branch"
    print_quality_gate "$branch"
    print_issues "$branch"
    print_hotspots "$branch"
    return 0
}

print_rules() {
    local keys
    keys="$(grep . <<<"$RULES" | sort -u || true)"
    [[ -z "$keys" ]] && return 0
    section "Rules"
    { printf 'RULE\tNAME\tTYPE\tSEVERITY\tDETAILS\n'
      while read -r rule; do
          api rules/show --data-urlencode "key=$rule" -d organization="$ORG" \
              | jq -r --arg org "$ORG" '.rule | [.key, .name, .type, .severity,
                  "https://sonarcloud.io/organizations/\($org)/rules?open=\(.key)&rule_key=\(.key)"] | @tsv'
      done <<<"$keys"; } | table
    return 0
}

print_analysis_state
print_branch "$BRANCH"
if [[ "$BRANCH" != "main" ]]; then
    print_branch "main"
fi
print_rules
