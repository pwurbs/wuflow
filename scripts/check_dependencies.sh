#!/bin/bash

# A script to check for updates for all dependencies in the repository.
# This script covers Go modules, NPM packages (in multiple subdirectories),
# Docker base images and the Wapiti vulnerability scanner.

# Exit on unexpected errors
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# sed expression turning "go1.27.2" (as printed by `go version`) into "1.27.2"
STRIP_GO_PREFIX='s/go//'


# 1. NPM Dependencies
echo -e "\n${BLUE}=====================================================${NC}"
echo -e "${BLUE}               Checking NPM Dependencies             ${NC}"
echo -e "${BLUE}=====================================================${NC}"
NPM_DIRS=("static/js" "playwright")

for dir in "${NPM_DIRS[@]}"; do
    if [[ -d "$dir" ]] && [[ -f "$dir/package.json" ]]; then
        echo -e "${BLUE}------------------------------------------------------${NC}"
        echo -e "${BLUE}  $dir${NC}"
        echo -e "${BLUE}------------------------------------------------------${NC}"

        echo -e "${YELLOW}--> npm outdated${NC}"
        # npm outdated returns exit code 1 if there are updates available.
        # We disable 'set -e' temporarily to handle this gracefully.
        set +e
        OUTPUT=$(cd "$dir" && npm outdated 2>&1)
        EXIT_CODE=$?
        set -e

        if [[ $EXIT_CODE -eq 0 ]] && [[ -z "$OUTPUT" ]]; then
            echo -e "${GREEN}All NPM packages in $dir are up to date.${NC}"
        else
            echo -e "${YELLOW}Note: Only packages with available updates are listed below.${NC}"
            echo "$OUTPUT"
        fi

        echo -e "\n${YELLOW}--> npm audit${NC}"
        set +e
        (cd "$dir" && npm audit)
        AUDIT_EXIT=$?
        set -e
        if [[ $AUDIT_EXIT -eq 0 ]]; then
            echo -e "${GREEN}No vulnerabilities found in $dir.${NC}"
        fi
    else
        echo -e "${YELLOW}--> Skipping $dir (no package.json found)${NC}"
    fi

    echo ""
done

# 2. Go Dependencies
echo -e "\n${BLUE}=====================================================${NC}"
echo -e "${BLUE}                    Checking Go                      ${NC}"
echo -e "${BLUE}=====================================================${NC}"

# Check Go CLI Version
# Note: inside this repo `go version` reports the toolchain selected by the go
# directive in go.mod (GOTOOLCHAIN=auto downloads it on demand), not the
# installed system Go. The system Go and tool builds are checked further below.
echo -e "${YELLOW}--> Checking Go version used by this repo (go.mod toolchain)...${NC}"
set +e
if command -v go >/dev/null 2>&1; then
    LOCAL_GO_VERSION=$(go version | awk '{print $3}' | sed "$STRIP_GO_PREFIX")
    if [[ "$LOCAL_GO_VERSION" == *.*.* ]]; then
        LOCAL_MINOR=$(echo "$LOCAL_GO_VERSION" | cut -d. -f1,2)
    else
        LOCAL_MINOR="$LOCAL_GO_VERSION"
    fi
    
    LATEST_ALL_GO=$(curl -s "https://go.dev/VERSION?m=text" | head -n 1 | sed "$STRIP_GO_PREFIX")
    
    # Try to find the latest patch for the current minor version (e.g. 1.25.x for 1.25.7)
    LATEST_MINOR=$(curl -s "https://go.dev/dl/?mode=json" | grep -o 'go[0-9]\+\.[0-9]\+\.[0-9]\+' | sort -uV | grep -E "^go$LOCAL_MINOR\." | tail -n 1 | sed "$STRIP_GO_PREFIX")
    
    # Fallback if we couldn't parse the minor properly
    if [[ -z "$LATEST_MINOR" ]]; then
        LATEST_MINOR="$LOCAL_GO_VERSION"
    fi

    if [[ "$LOCAL_GO_VERSION" == "$LATEST_ALL_GO" ]]; then
        echo -e "${GREEN}Go version ($LOCAL_GO_VERSION) is fully up-to-date with the absolute latest.${NC}"
    elif [[ "$LOCAL_GO_VERSION" == "$LATEST_MINOR" ]]; then
        echo -e "Go version ($LOCAL_GO_VERSION) is up to date for its minor release branch. (Latest overall is $LATEST_ALL_GO)."
    else
        echo -e "${RED}Go version ($LOCAL_GO_VERSION) is outdated! An update for your minor version ($LATEST_MINOR) is available. (Latest overall is $LATEST_ALL_GO).${NC}"
    fi
else
    echo -e "${RED}Go command not found.${NC}"
fi
set -e

# minor_older <a> <b> — true if the major.minor of version a is lower than that of b.
minor_older() {
    local a b
    a=$(echo "$1" | cut -d. -f1,2)
    b=$(echo "$2" | cut -d. -f1,2)
    [[ "$a" != "$b" ]] && [[ "$(printf '%s\n%s\n' "$a" "$b" | sort -V | head -n 1)" == "$a" ]]
}

# The toolchain switch only covers `go` commands run in this repo. The system Go
# and tools built from source keep the Go version they were installed/built with,
# and both lag silently behind a go.mod bump unless checked explicitly.
GOMOD_GO_VERSION=$(awk '/^go /{print $2; exit}' go.mod 2>/dev/null || true)
if [[ -n "$GOMOD_GO_VERSION" ]] && command -v go >/dev/null 2>&1; then
    set +e
    echo -e "${YELLOW}--> Checking installed system Go against go.mod ($GOMOD_GO_VERSION)...${NC}"
    SYSTEM_GO_VERSION=$(GOTOOLCHAIN=local go version | awk '{print $3}' | sed "$STRIP_GO_PREFIX")
    if minor_older "$SYSTEM_GO_VERSION" "$GOMOD_GO_VERSION"; then
        echo -e "${RED}System Go ($SYSTEM_GO_VERSION) is older than go.mod ($GOMOD_GO_VERSION). Install the new Go from https://go.dev/dl/, then run 'Go: Install/Update Tools' in VS Code.${NC}"
    else
        echo -e "${GREEN}System Go ($SYSTEM_GO_VERSION) matches the go.mod minor version.${NC}"
    fi

    # Source-parsing tools only understand the language features of the Go they
    # were built with: an older gopls reports false errors in the IDE, older
    # gosec/govulncheck builds fail outright in go_checks.sh, and golangci-lint
    # refuses to run at all. Entries are "binary|rebuild hint"; gopls and
    # golangci-lint are on the VS Code extension's tool list, gosec and
    # govulncheck are not and need a manual go install.
    SOURCE_TOOLS="gopls|run 'Go: Install/Update Tools' in VS Code
golangci-lint|run 'Go: Install/Update Tools' in VS Code (go.lintTool: golangci-lint-v2)
gosec|go install github.com/securego/gosec/v2/cmd/gosec@latest
govulncheck|go install golang.org/x/vuln/cmd/govulncheck@latest"
    while IFS='|' read -r TOOL HINT; do
        echo -e "${YELLOW}--> Checking Go version $TOOL was built with...${NC}"
        if command -v "$TOOL" >/dev/null 2>&1; then
            TOOL_GO_VERSION=$(go version "$(command -v "$TOOL")" | awk '{print $NF}' | sed "$STRIP_GO_PREFIX")
            if minor_older "$TOOL_GO_VERSION" "$GOMOD_GO_VERSION"; then
                echo -e "${RED}$TOOL was built with Go $TOOL_GO_VERSION, older than go.mod ($GOMOD_GO_VERSION) and may fail on newer syntax. Rebuild: $HINT${NC}"
            else
                echo -e "${GREEN}$TOOL was built with Go $TOOL_GO_VERSION.${NC}"
            fi
        else
            echo -e "${YELLOW}$TOOL not found in PATH (skipped).${NC}"
        fi
    done <<< "$SOURCE_TOOLS"

    # Release check only; its build Go version is checked in the loop above.
    echo -e "${YELLOW}--> Checking golangci-lint version...${NC}"
    if command -v golangci-lint >/dev/null 2>&1; then
        # Parsed from the full output: v1 has no --short flag, and source builds
        # print the version with a "v" prefix ("v2.14.0") while releases do not.
        GOLANGCI_VERSION=$(golangci-lint version 2>/dev/null | sed -E 's/.*has version v?([0-9][0-9.]*).*/\1/')
        LATEST_GOLANGCI=$(curl -s "https://api.github.com/repos/golangci/golangci-lint/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
        if [[ -z "$LATEST_GOLANGCI" ]]; then
            echo -e "${YELLOW}golangci-lint $GOLANGCI_VERSION installed (could not fetch the latest release from GitHub).${NC}"
        elif [[ "$GOLANGCI_VERSION" == "$LATEST_GOLANGCI" ]]; then
            echo -e "${GREEN}golangci-lint ($GOLANGCI_VERSION) is up to date.${NC}"
        else
            echo -e "${RED}golangci-lint ($GOLANGCI_VERSION) is outdated! Latest is $LATEST_GOLANGCI. Update via 'Go: Install/Update Tools' in VS Code (go.lintTool: golangci-lint-v2).${NC}"
        fi
    else
        echo -e "${RED}golangci-lint is not installed.${NC}"
    fi
    set -e
fi

if [[ -f "go.mod" ]]; then
    echo -e "${YELLOW}--> Checking Go modules...${NC}"
    set +e
    # Lists modules with updates and marks indirect ones
    OUTPUT=$(go list -m -u -f '{{if .Update}}{{if .Indirect}} (indirect) {{end}}{{.Path}} {{.Version}} [{{.Update.Version}}]{{end}}' all | grep -v "^$")
    set -e
    
if [[ -z "$OUTPUT" ]]; then
        echo -e "${GREEN}All Go modules are up to date.${NC}"
    else
        echo "$OUTPUT"
    fi

    echo -e "${YELLOW}--> Running govulncheck...${NC}"
    set +e
    if command -v govulncheck >/dev/null 2>&1; then
        govulncheck ./...
    else
        echo -e "${RED}govulncheck is not installed. Install it with: go install golang.org/x/vuln/cmd/govulncheck@latest${NC}"
    fi
    set -e
else
    echo -e "${YELLOW}--> Skipping Go (no go.mod found)${NC}"
fi


# 3. Docker Base Images
echo -e "\n${BLUE}=====================================================${NC}"
echo -e "${BLUE}              Checking Docker Base Images            ${NC}"
echo -e "${BLUE}      (newest tag within the same major version)     ${NC}"
echo -e "${BLUE}=====================================================${NC}"

# latest_docker_tag <repository> <tag> — prints the newest Docker Hub tag of the
# same form as <tag> within the same major version, e.g. node 24.21.0-alpine3.24
# → newest 24.x.y-alpineX.Y. The major version stays fixed because a major
# upgrade (e.g. a new Node LTS line) is a deliberate decision, not a routine bump.
# The tags are fetched sorted by last update, so the newest ones are on page 1.
latest_docker_tag() {
    local repo="$1" tag="$2" major rest pattern
    major="${tag%%[!0-9]*}"
    rest="${tag#"$major"}"
    pattern="^${major}$(printf '%s' "$rest" | sed -E 's/[0-9]+/[0-9]+/g; s/\./\\./g')\$"
    curl -s "https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated&name=${major}." \
        | grep -o '"name":"[^"]*"' | sed 's/"name":"//; s/"$//' \
        | grep -E "$pattern" | sort -V | tail -1
    return 0
}

if [[ -f Dockerfile ]]; then
    # Image of every FROM line, without --platform options and the docker.io/ prefix
    IMAGES=$(grep -E '^FROM ' Dockerfile | awk '{for (i = 2; i <= NF; i++) if ($i !~ /^--/) { print $i; break }}' | sed 's|^docker\.io/||')
    set +e
    for image in $IMAGES; do
        repo="${image%%:*}"
        tag="${image#*:}"
        # Official images live in the "library" namespace of the Docker Hub API
        [[ "$repo" == */* ]] || repo="library/$repo"
        LATEST_TAG=$(latest_docker_tag "$repo" "$tag")
        if [[ -z "$LATEST_TAG" ]]; then
            echo -e "${YELLOW}${image}: could not fetch the tags from Docker Hub.${NC}"
        elif [[ "$LATEST_TAG" == "$tag" ]]; then
            echo -e "${GREEN}${image} is up to date.${NC}"
        else
            echo -e "${RED}${image} is outdated! Latest is ${LATEST_TAG}. Update the Dockerfile.${NC}"
        fi
    done
    set -e
else
    echo -e "${YELLOW}--> Skipping Docker base images (no Dockerfile found)${NC}"
fi


# 4. Wapiti (vulnerability scanner used by scripts/run_wapiti_scan.sh)
echo -e "\n${BLUE}=====================================================${NC}"
echo -e "${BLUE}                  Checking Wapiti                    ${NC}"
echo -e "${BLUE}=====================================================${NC}"
WAPITI_VENV="$HOME/python_wapiti_env"

if [[ -x "$WAPITI_VENV/bin/pip" ]]; then
    set +e
    WAPITI_VERSION=$("$WAPITI_VENV/bin/pip" show wapiti3 2>/dev/null | awk '/^Version:/ {print $2}')
    LATEST_WAPITI=$(curl -s "https://pypi.org/pypi/wapiti3/json" | grep -o -m1 '"version":"[^"]*"' | sed -E 's/"version":"([^"]+)"/\1/')
    if [[ -z "$WAPITI_VERSION" ]]; then
        echo -e "${RED}wapiti3 is not installed in $WAPITI_VENV.${NC}"
    elif [[ -z "$LATEST_WAPITI" ]]; then
        echo -e "${YELLOW}Wapiti $WAPITI_VERSION installed (could not fetch the latest release from PyPI).${NC}"
    elif [[ "$WAPITI_VERSION" == "$LATEST_WAPITI" ]]; then
        echo -e "${GREEN}Wapiti ($WAPITI_VERSION) is up to date.${NC}"
    else
        echo -e "${RED}Wapiti ($WAPITI_VERSION) is outdated! Latest is $LATEST_WAPITI. Update with: $WAPITI_VENV/bin/pip install --upgrade wapiti3${NC}"
    fi
    set -e
else
    echo -e "${YELLOW}--> Skipping Wapiti (no virtual environment at $WAPITI_VENV)${NC}"
fi


echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}                 Check Complete!                      ${NC}"
echo -e "${GREEN}======================================================${NC}"
