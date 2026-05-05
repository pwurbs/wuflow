#!/bin/bash

# A script to check for updates for all dependencies in the repository.
# This script covers Go modules, NPM packages (in multiple subdirectories), 
# and Docker base images.

# Exit on unexpected errors
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color


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
echo -e "${YELLOW}--> Checking Go local version...${NC}"
set +e
if command -v go >/dev/null 2>&1; then
    LOCAL_GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
    if [[ "$LOCAL_GO_VERSION" == *.*.* ]]; then
        LOCAL_MINOR=$(echo "$LOCAL_GO_VERSION" | cut -d. -f1,2)
    else
        LOCAL_MINOR="$LOCAL_GO_VERSION"
    fi
    
    LATEST_ALL_GO=$(curl -s "https://go.dev/VERSION?m=text" | head -n 1 | sed 's/go//')
    
    # Try to find the latest patch for the current minor version (e.g. 1.25.x for 1.25.7)
    LATEST_MINOR=$(curl -s "https://go.dev/dl/?mode=json" | grep -o 'go[0-9]\+\.[0-9]\+\.[0-9]\+' | sort -uV | grep -E "^go$LOCAL_MINOR\." | tail -n 1 | sed 's/go//')
    
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



echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}                 Check Complete!                      ${NC}"
echo -e "${GREEN}======================================================${NC}"
