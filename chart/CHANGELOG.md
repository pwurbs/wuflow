
# 1.4.3
- The container's root filesystem is now read-only
- Added optional value `hostUsers` (default `true`); set to `false` to run the pod in its own Linux user namespace
- Added optional value `ingress.compress` (default `false`); set to `true` to compress responses via a Traefik `compress` Middleware attached to the ingress

# 1.4.2
- **Breaking:** Removed values `secrets.initialAdminPassword` and `secrets.secretKey`
- Added `secrets.existingSecret` / `secrets.existingSecretKeys`
- `secret.yaml`: `helm.sh/resource-policy: keep` annotation added
- Added securityContext, the pod now runs in namespaces with Restricted PSA
- Chart version is now the same as the app version
- Bumped app version to 1.4.2
- Added defaults and descriptions to the values schema for Artifact Hub's parameter docs
- Value `ingress.host` is now required and must be set explicitly; helm actions fail instead of deploying with an empty host
- Disabled Artifact Hub's automatic category prediction (had misclassified the chart as "Monitoring and logging")
- Added values schema
- Added Artifacthub annotations
- Added some more information in Chart.yaml
- Added this changelog
