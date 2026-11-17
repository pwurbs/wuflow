#!/bin/bash
# scripts/image_release.sh
# Builds the multi-arch (amd64, arm64) container image and pushes it to GitHub Container Registry (ghcr.io).
#
# Usage: ./scripts/image_release.sh
#
# Prerequisites:
#   - Apple container CLI installed (the script starts its system service if it is not running)
#   - A GitHub Personal Access Token with the `write:packages` scope, stored in the macOS
#     keychain item `ghcr-push-token` (scripts/README.md)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
GITHUB_USER="pwurbs"
REGISTRY="ghcr.io"
IMAGE="${REGISTRY}/${GITHUB_USER}/wuflow"

VERSION=$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")
if [[ -z "${VERSION}" ]]; then
    echo "VERSION file is empty. Aborting."
    exit 1
fi

if ! command -v container >/dev/null 2>&1; then
    echo "The Apple container CLI is not installed (macOS only). Aborting." >&2
    exit 1
fi
if ! container system status 2>/dev/null | grep -q '^status *running'; then
    echo "==> Starting the container system service ..."
    container system start
fi

echo "==> Building ${IMAGE}:${VERSION} (amd64, arm64) ..."
container build --no-cache --arch amd64,arm64 --build-arg VERSION="${VERSION}" -t "${IMAGE}:${VERSION}" "${ROOT_DIR}"

# Read after the build, so all keychain prompts come together at the end.
GHCR_TOKEN=$(security find-generic-password -a "$USER" -s ghcr-push-token -w 2>/dev/null || true)
if [[ -z "${GHCR_TOKEN}" ]]; then
    echo "The keychain item 'ghcr-push-token' could not be read (missing or access denied). Aborting." >&2
    exit 1
fi

# The login lasts only for the push: the trap logs out on every exit, also after a failed push.
trap 'container registry logout "${REGISTRY}" >/dev/null 2>&1 || true' EXIT
echo "==> Logging in to ${REGISTRY} as ${GITHUB_USER} ..."
printf '%s' "${GHCR_TOKEN}" | container registry login "${REGISTRY}" -u "${GITHUB_USER}" --password-stdin
unset GHCR_TOKEN

echo "==> Pushing ${IMAGE}:${VERSION} ..."
container image push "${IMAGE}:${VERSION}"

echo ""
echo "==> Done!"
echo "    Pull with: container image pull ${IMAGE}:${VERSION}"
