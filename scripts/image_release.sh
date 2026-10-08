#!/bin/bash
# scripts/image_release.sh
# Builds the multi-arch (amd64, arm64) container image and pushes it to GitHub Container Registry (ghcr.io).
#
# Usage: bash scripts/image_release.sh
#
# Prerequisites:
#   - Apple container CLI installed and its system service running (`container system start`)
#   - A GitHub Personal Access Token with the `write:packages` scope, either exported as
#     GHCR_TOKEN or entered when prompted (only needed if not already logged in to ghcr.io)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
GITHUB_USER="pwurbs"
IMAGE="ghcr.io/${GITHUB_USER}/wuflow"

VERSION=$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")
if [[ -z "${VERSION}" ]]; then
    echo "VERSION file is empty. Aborting."
    exit 1
fi

# container registry login persists credentials in the macOS keychain — skip the token
# prompt/login when a cached entry for ghcr.io already exists.
ALREADY_LOGGED_IN=false
if [[ -z "${GHCR_TOKEN}" ]] && container registry list -q 2>/dev/null | grep -qx "ghcr.io"; then
    ALREADY_LOGGED_IN=true
fi

if [[ "${ALREADY_LOGGED_IN}" == false && -z "${GHCR_TOKEN}" ]]; then
    read -rsp "GitHub PAT for ${GITHUB_USER} (write:packages scope): " GHCR_TOKEN
    echo
fi

if [[ "${ALREADY_LOGGED_IN}" == true ]]; then
    echo "==> Already logged in to ghcr.io (cached credentials), skipping login"
else
    echo "==> Logging in to ghcr.io as ${GITHUB_USER} ..."
    printf '%s' "${GHCR_TOKEN}" | container registry login ghcr.io -u "${GITHUB_USER}" --password-stdin
fi

echo "==> Building ${IMAGE}:${VERSION} (amd64, arm64) ..."
container build --no-cache --arch amd64,arm64 --build-arg VERSION="${VERSION}" -t "${IMAGE}:${VERSION}" "${ROOT_DIR}"

echo "==> Pushing ${IMAGE}:${VERSION} ..."
container image push "${IMAGE}:${VERSION}"

echo ""
echo "==> Done!"
echo "    Pull with: container image pull ${IMAGE}:${VERSION}"
