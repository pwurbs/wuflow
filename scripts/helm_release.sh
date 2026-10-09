#!/bin/bash
# scripts/helm_release.sh
# Packages the Helm chart and pushes it to GitHub Container Registry (ghcr.io) as an OCI artifact.
#
# Usage: bash scripts/helm_release.sh
#
# Prerequisites:
#   - helm 3.8+ installed
#   - A GitHub Personal Access Token with the `write:packages` scope, either exported as
#     GHCR_TOKEN or entered when prompted
#   - jq (optional; without it, login is always re-run instead of reusing a cached session)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/../chart"
DIST_DIR="${SCRIPT_DIR}/../dist"
GITHUB_USER="pwurbs"
OCI_REPO="oci://ghcr.io/${GITHUB_USER}/charts"

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

# helm registry login persists credentials to $HELM_REGISTRY_CONFIG (like docker login) — skip
# the token prompt/login when jq is available and a cached entry for ghcr.io already exists.
HELM_REGISTRY_CONFIG_PATH="$(helm env | sed -n 's/^HELM_REGISTRY_CONFIG="\(.*\)"$/\1/p')"
if [[ -z "${GHCR_TOKEN}" ]] && command -v jq &>/dev/null \
    && [[ -f "${HELM_REGISTRY_CONFIG_PATH}" ]] \
    && jq -e '.auths["ghcr.io"]' "${HELM_REGISTRY_CONFIG_PATH}" &>/dev/null; then
    echo "==> Already logged in to ghcr.io (cached credentials), skipping login"
else
    if [[ -z "${GHCR_TOKEN}" ]]; then
        read -rsp "GitHub PAT for ${GITHUB_USER} (write:packages scope): " GHCR_TOKEN
        echo
    fi
    echo "==> Logging in to ghcr.io as ${GITHUB_USER} ..."
    echo "${GHCR_TOKEN}" | helm registry login ghcr.io -u "${GITHUB_USER}" --password-stdin
fi

echo "==> Packaging chart wuflow-${CHART_VERSION} ..."
mkdir -p "${DIST_DIR}"
helm package "${CHART_DIR}" -d "${DIST_DIR}"

echo "==> Pushing to ${OCI_REPO} ..."
helm push "${DIST_DIR}/wuflow-${CHART_VERSION}.tgz" "${OCI_REPO}"

echo ""
echo "==> Done!"
echo "    Install with: helm install wuflow ${OCI_REPO}/wuflow --version ${CHART_VERSION}"
