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

# Prompt for changelog entry
CHANGELOG=$(osascript -e "display dialog \"Changelog:\" default answer \"\"" -e "text returned of result")

if [[ -z "$CHANGELOG" ]]; then
    echo "No changelog entry entered. Aborting."
    exit 1
fi

# 1. Update VERSION file
echo "$NEW_VERSION" > VERSION

# 2. Update Home Assistant Add-on config
sed -i '' "s/^version: \".*\"/version: \"$NEW_VERSION\"/" home-assistant-addon/config.yaml

# 3. Update Home Assistant Add-on CHANGELOG.md (## header)
printf '\n## %s\n\n%s\n' "$NEW_VERSION" "$CHANGELOG" | cat - home-assistant-addon/CHANGELOG.md > CHANGELOG.tmp
mv CHANGELOG.tmp home-assistant-addon/CHANGELOG.md

# 4. Update Root CHANGELOG.md (# header)
printf '\n# %s\n\n%s\n' "$NEW_VERSION" "$CHANGELOG" | cat - CHANGELOG.md > CHANGELOG_ROOT.tmp
mv CHANGELOG_ROOT.tmp CHANGELOG.md

# 5. Update Helm chart version, appVersion and image tag
sed -i '' "s/^version: .*/version: ${NEW_VERSION}00/" chart/Chart.yaml
sed -i '' "s/^appVersion: \".*\"/appVersion: \"$NEW_VERSION\"/" chart/Chart.yaml
sed -i '' "s/^  tag: \".*\"/  tag: \"$NEW_VERSION\"/" deploy/values.dev.yaml

echo "Successfully updated to version $NEW_VERSION"
