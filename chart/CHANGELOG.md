
# 1.4.2
- Bumped app version to 1.4.2
- Added defaults and descriptions to the values schema for Artifact Hub's parameter docs
- Value `ingress.host` is now required and must be set explicitly; helm actions fail instead of deploying with an empty host
- Disabled Artifact Hub's automatic category prediction (had misclassified the chart as "Monitoring and logging")
- Added values schema
- Added Artifacthub annotations
- Added some more information in Chart.yaml
- Added this changelog
