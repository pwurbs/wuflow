#!/bin/sh
# Builds the container image locally (arm64 only, tagged with VERSION) and
# scans it with Trivy. Used by the "Scan Image" VS Code task and the /release
# skill. The released multi-arch image is built by image_release.sh.
set -e

# Ensure we are in the project root
cd "$(dirname "$0")/.."

VERSION=$(cat VERSION)

if ! command -v container >/dev/null 2>&1; then
    echo "The Apple container CLI is not installed (macOS only). Aborting." >&2
    exit 1
fi
system_started=false
stop_started_system() {
    if [ "$system_started" = true ]; then
        echo "==> Stopping the container system service ..."
        container system stop || echo "The container system service could not be stopped." >&2
    fi
}
trap stop_started_system EXIT
if ! container system status 2>/dev/null | grep -q '^status *running'; then
    echo "==> Starting the container system service ..."
    system_started=true
    container system start
fi

container build --no-cache --arch arm64 --build-arg VERSION="$VERSION" -t "wuflow:$VERSION" .

# Ensure the .trivy directory exists and is clean
rm -rf .trivy
mkdir -p .trivy

container image save -o .trivy/wuflow-local.tar "wuflow:$VERSION"
tar -xf .trivy/wuflow-local.tar -C .trivy
trivy image --platform linux/arm64 --severity HIGH,CRITICAL --input .trivy
