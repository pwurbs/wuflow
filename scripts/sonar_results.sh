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
PROJECT="wuflow-oss"
ORG="pwurbs-oss"
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

# api <path> <curl args...> — GET request to the SonarCloud API.
api() {
    local path="$1"
    shift
    curl -sSfG "$API/$path" "$@"
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
        echo "NOTE: $BRANCH is a short-lived branch: it lists only issues in code changed against main."
    fi
    return 0
}

print_quality_gate() {
    echo "Quality gate:"
    api qualitygates/project_status -d projectKey="$PROJECT" --data-urlencode "branch=$1" \
        | jq -r '.projectStatus | "  \(.status)", (.conditions[] | select(.status != "OK")
            | "  failed: \(.metricKey) = \(.actualValue) (\(.comparator) \(.errorThreshold))")'
    return 0
}

# fetch_issues <branch> — one TSV row per open issue, all pages.
fetch_issues() {
    local page=1 json total
    while :; do
        json="$(api issues/search -d componentKeys="$PROJECT" -d organization="$ORG" \
            --data-urlencode "branch=$1" -d resolved=false -d ps="$PAGE_SIZE" -d p="$page")"
        jq -r '.issues[] | [.rule, .severity, .type,
            "\(.component | sub("^[^:]*:"; "")):\(.line // "-")", .message] | @tsv' <<<"$json"
        total="$(jq -r '.total' <<<"$json")"
        if (( page * PAGE_SIZE >= total )); then
            break
        fi
        page=$((page + 1))
    done
    return 0
}

print_issues() {
    local rows
    rows="$(fetch_issues "$1")"
    echo ""
    if [[ -z "$rows" ]]; then
        echo "Open issues: 0"
        return 0
    fi
    echo "Open issues: $(grep -c . <<<"$rows")"
    { printf 'RULE\tSEVERITY\tTYPE\tFILE:LINE\tMESSAGE\n'; printf '%s\n' "$rows"; } | table
    RULES="${RULES}$(cut -f1 <<<"$rows")"$'\n'
    return 0
}

print_hotspots() {
    local rows
    rows="$(api hotspots/search -d projectKey="$PROJECT" --data-urlencode "branch=$1" \
        -d status=TO_REVIEW -d ps="$PAGE_SIZE" \
        | jq -r '.hotspots[] | [.ruleKey, .vulnerabilityProbability,
            "\(.component | sub("^[^:]*:"; "")):\(.line // "-")", .message] | @tsv')"
    echo ""
    if [[ -z "$rows" ]]; then
        echo "Security hotspots to review: 0"
        return 0
    fi
    echo "Security hotspots to review: $(grep -c . <<<"$rows")"
    { printf 'RULE\tPROBABILITY\tFILE:LINE\tMESSAGE\n'; printf '%s\n' "$rows"; } | table
    RULES="${RULES}$(cut -f1 <<<"$rows")"$'\n'
    return 0
}

print_branch() {
    section "Branch $1"
    print_quality_gate "$1"
    print_issues "$1"
    print_hotspots "$1"
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
