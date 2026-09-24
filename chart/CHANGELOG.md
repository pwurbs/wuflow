# Changelog

## 1.4.108
- Added defaults and descriptions to the values schema for Artifact Hub's parameter docs
- Value `ingress.host` is now required and must be set explicitly; helm actions fail instead of deploying with an empty host
- Disabled Artifact Hub's automatic category prediction (had misclassified the chart as "Monitoring and logging")

## 1.4.107
- Added values schema

## 1.4.106
- Added Artifacthub annotations

## 1.4.105
- Added this changelog
- Added some more information in Chart.yaml