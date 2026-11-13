#!/bin/bash
# scripts/helm_release.sh
# Packages the Helm chart and pushes it to GitHub Container Registry (ghcr.io) as an OCI artifact.
#
# Usage: ./scripts/helm_release.sh
#
# Prerequisites:
#   - helm 3.8+ installed
#   - A GitHub Personal Access Token with the `write:packages` scope, either exported as
#     GHCR_TOKEN or stored in the macOS keychain item `ghcr-push-token` (scripts/README.md)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/../chart"
DIST_DIR="${SCRIPT_DIR}/../dist"
GITHUB_USER="pwurbs"
REGISTRY="ghcr.io"
OCI_REPO="oci://${REGISTRY}/${GITHUB_USER}/charts"

CHART_VERSION=$(awk '/^version:/ {print $2}' "${CHART_DIR}/Chart.yaml")
APP_VERSION=$(awk -F'"' '/^appVersion:/ {print $2}' "${CHART_DIR}/Chart.yaml")

if [[ "${CHART_VERSION}" != "${APP_VERSION}" ]]; then
    echo "Chart version (${CHART_VERSION}) must equal appVersion (${APP_VERSION}) in chart/Chart.yaml. Aborting."
    exit 1
fi

IMAGE_TAG=$(sed -n -E "s#.*ghcr\.io/${GITHUB_USER}/wuflow:([^\"[:space:]]+).*#\1#p" "${CHART_DIR}/Chart.yaml")

if [[ "${IMAGE_TAG}" != "${APP_VERSION}" ]]; then
    echo "artifacthub.io/images tag (${IMAGE_TAG}) must equal appVersion (${APP_VERSION}) in chart/Chart.yaml (normally set by scripts/new_version.sh). Aborting."
    exit 1
fi

if [[ -z "${GHCR_TOKEN:-}" ]]; then
    GHCR_TOKEN=$(security find-generic-password -a "$USER" -s ghcr-push-token -w 2>/dev/null || true)
fi
if [[ -z "${GHCR_TOKEN:-}" ]]; then
    echo "GHCR_TOKEN is not set and the keychain item 'ghcr-push-token' could not be read (missing or access denied). Aborting." >&2
    exit 1
fi

echo "==> Packaging chart wuflow-${CHART_VERSION} ..."
mkdir -p "${DIST_DIR}"
helm package "${CHART_DIR}" -d "${DIST_DIR}"

# helm registry login writes the token to the registry config file: the trap logs out on every
# exit, also after a failed push, so it stays there only while the script runs.
trap 'helm registry logout "${REGISTRY}" >/dev/null 2>&1 || true' EXIT
echo "==> Logging in to ${REGISTRY} as ${GITHUB_USER} ..."
printf '%s' "${GHCR_TOKEN}" | helm registry login "${REGISTRY}" -u "${GITHUB_USER}" --password-stdin
unset GHCR_TOKEN

echo "==> Pushing to ${OCI_REPO} ..."
helm push "${DIST_DIR}/wuflow-${CHART_VERSION}.tgz" "${OCI_REPO}"

echo ""
echo "==> Done!"
echo "    Install with: helm install wuflow ${OCI_REPO}/wuflow --version ${CHART_VERSION}"
