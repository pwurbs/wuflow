#!/bin/sh
# This script performs a local Trivy scan on the container image.

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# Ensure the .trivy directory exists and is clean
rm -rf .trivy
mkdir -p .trivy

# Use the commands provided by the user
export VERSION=$(cat VERSION)
container image save -o .trivy/wuflow-local.tar wuflow:$VERSION
tar -xf .trivy/wuflow-local.tar -C .trivy
trivy image --platform linux/arm64 --severity HIGH,CRITICAL --input .trivy
