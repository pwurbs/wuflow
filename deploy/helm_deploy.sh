#!/bin/bash
# Usage: bash deploy/helm_deploy.sh [dev|prod]  (run from repo root)
#
# Prerequisites:
#   - helm installed
#   - Kubeconfig at ~/.kube/wuflow-{env}.yaml (download from your cluster management UI)
#   - deploy/secrets.{env}.yaml present (not in Git, see chart/README.md)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${1}" ]]; then
    echo "Usage: bash deploy/helm_deploy.sh [dev|prod]"
    exit 1
fi
ENV=${1}
KUBECONFIG_PATH="${HOME}/.kube/wuflow-${ENV}.yaml"
SECRETS_FILE="${SCRIPT_DIR}/secrets.${ENV}.yaml"

if [[ ! -f "${KUBECONFIG_PATH}" ]]; then
    echo "Error: Kubeconfig not found: ${KUBECONFIG_PATH}" >&2
    echo "Download the kubeconfig from your cluster management UI." >&2
    exit 1
fi

if [[ ! -f "${SECRETS_FILE}" ]]; then
    echo "Error: ${SECRETS_FILE} not found." >&2
    echo "See chart/README.md for the required file structure." >&2
    exit 1
fi

echo "==> Deploying wuFlow (${ENV}) ..."
helm upgrade --install wuflow "${SCRIPT_DIR}/../chart" \
    --namespace wuflow \
    --create-namespace \
    -f "${SCRIPT_DIR}/values.${ENV}.yaml" \
    -f "${SECRETS_FILE}" \
    --kubeconfig "${KUBECONFIG_PATH}"

echo ""
echo "==> Done!"
echo "    Status:  kubectl --kubeconfig ${KUBECONFIG_PATH} -n wuflow get pods"
echo "    Logs:    kubectl --kubeconfig ${KUBECONFIG_PATH} -n wuflow logs -f deploy/wuflow"
