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

# 3. Update Helm chart version, appVersion and the artifacthub.io/images annotation
# (image tag defaults to appVersion, see chart/values.yaml)
# Chart version is kept identical to the app version
sed -i '' "s/^version: .*/version: ${NEW_VERSION}/" chart/Chart.yaml
sed -i '' "s/^appVersion: \".*\"/appVersion: \"$NEW_VERSION\"/" chart/Chart.yaml
sed -i '' -E "s#(ghcr\.io/pwurbs/wuflow:)[^\"[:space:]]+#\1${NEW_VERSION}#" chart/Chart.yaml

echo "Successfully updated to version $NEW_VERSION"
