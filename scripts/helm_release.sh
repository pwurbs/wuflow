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

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="${SCRIPT_DIR}/../chart"
DIST_DIR="${SCRIPT_DIR}/../dist"
GITHUB_USER="pwurbs"
OCI_REPO="oci://ghcr.io/${GITHUB_USER}/charts"

CHART_VERSION=$(awk '/^version:/ {print $2}' "${CHART_DIR}/Chart.yaml")

if [[ -z "${GHCR_TOKEN}" ]]; then
    read -rsp "GitHub PAT for ${GITHUB_USER} (write:packages scope): " GHCR_TOKEN
    echo
fi

echo "==> Logging in to ghcr.io as ${GITHUB_USER} ..."
echo "${GHCR_TOKEN}" | helm registry login ghcr.io -u "${GITHUB_USER}" --password-stdin

echo "==> Packaging chart wuflow-${CHART_VERSION} ..."
mkdir -p "${DIST_DIR}"
helm package "${CHART_DIR}" -d "${DIST_DIR}"

echo "==> Pushing to ${OCI_REPO} ..."
helm push "${DIST_DIR}/wuflow-${CHART_VERSION}.tgz" "${OCI_REPO}"

echo ""
echo "==> Done!"
echo "    Install with: helm install wuflow ${OCI_REPO}/wuflow --version ${CHART_VERSION}"
