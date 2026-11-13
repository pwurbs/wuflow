#!/bin/bash
# scripts/image_release.sh
# Builds the multi-arch (amd64, arm64) container image and pushes it to GitHub Container Registry (ghcr.io).
#
# Usage: ./scripts/image_release.sh
#
# Prerequisites:
#   - Apple container CLI installed and its system service running (`container system start`)
#   - A GitHub Personal Access Token with the `write:packages` scope, either exported as
#     GHCR_TOKEN or stored in the macOS keychain item `ghcr-push-token` (scripts/README.md)

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

if [[ -z "${GHCR_TOKEN:-}" ]]; then
    GHCR_TOKEN=$(security find-generic-password -a "$USER" -s ghcr-push-token -w 2>/dev/null || true)
fi
if [[ -z "${GHCR_TOKEN:-}" ]]; then
    echo "GHCR_TOKEN is not set and the keychain item 'ghcr-push-token' could not be read (missing or access denied). Aborting." >&2
    exit 1
fi

echo "==> Building ${IMAGE}:${VERSION} (amd64, arm64) ..."
container build --no-cache --arch amd64,arm64 --build-arg VERSION="${VERSION}" -t "${IMAGE}:${VERSION}" "${ROOT_DIR}"

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
