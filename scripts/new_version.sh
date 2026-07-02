#!/bin/bash

# scripts/new_version.sh
# Automates the versioning process

set -e

# Get old version
OLD_VERSION=$(cat VERSION)

# Prompt for new version using AppleScript (since we're on macOS)
NEW_VERSION=$(osascript -e "display dialog \"New Version:\" default answer \"$OLD_VERSION\"" -e "text returned of result")

if [[ -z "$NEW_VERSION" ]]; then
    echo "No version entered. Aborting."
    exit 1
fi

# 1. Update VERSION file
echo "$NEW_VERSION" > VERSION

# 2. Update Home Assistant Add-on config
sed -i '' "s/^version: \".*\"/version: \"$NEW_VERSION\"/" home-assistant-addon/config.yaml

# 3. Update Helm chart version, appVersion and image tag
# Chart version format: <base>00<pre-suffix> e.g. 1.3.2-pre1 → 1.3.200-pre1
BASE_VERSION="${NEW_VERSION%%-*}"
PRE_SUFFIX="${NEW_VERSION#"$BASE_VERSION"}"
CHART_VERSION="${BASE_VERSION}00${PRE_SUFFIX}"
sed -i '' "s/^version: .*/version: ${CHART_VERSION}/" chart/Chart.yaml
sed -i '' "s/^appVersion: \".*\"/appVersion: \"$NEW_VERSION\"/" chart/Chart.yaml
sed -i '' "s/^  tag: \".*\"/  tag: \"$NEW_VERSION\"/" deploy/values.dev.yaml

echo "Successfully updated to version $NEW_VERSION"
