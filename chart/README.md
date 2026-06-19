# wuFlow Helm Chart

Deploys [wuFlow](https://github.com/pwurbs/wuflow) — a lightweight, self-hosted Agile board — to a Kubernetes cluster.

## Prerequisites

- Helm 3 installed
- Kubeconfig at `~/.kube/wuflow-{env}.yaml` (download from your cluster management UI)
- A `secrets.{env}.yaml` file with credentials (see below)

## Quick Start

```bash
# 1. Create deploy/secrets.dev.yaml with your credentials (see Secrets section below)

# 2. Set the ingress host in deploy/values.dev.yaml
#    (wuFlow requires a dedicated hostname — see note below)

# 3. Deploy
bash deploy/helm_deploy.sh dev
```

## Important: Dedicated Hostname Required

> **wuFlow does not support a context path.** The ingress `host` must be a dedicated (sub)domain such as `wuflow.example.com`. Deploying under a subpath (e.g. `example.com/wuflow`) is **not supported** and will not work correctly.

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image | `ghcr.io/pwurbs/wuflow` |
| `image.tag` | Image tag | `1.3.1` |
| `wuflow.initialAdminEmail` | First admin email | `admin@local` |
| `wuflow.logLevel` | Log level (`debug`, `info`, `warn`, `error`) | `info` |
| `wuflow.secureCookie` | Require HTTPS for auth cookies | `true` |
| `wuflow.apiRateLimit` | Enable per-user rate limiting | `true` |
| `wuflow.remoteIpHeader` | Header for client IP behind proxy (e.g. `X-Forwarded-For`) | `""` |
| `ingress.host` | Dedicated hostname for the app | `""` |
| `ingress.className` | Ingress class name | `traefik` |
| `ingress.annotations` | Ingress annotations (map) | Traefik websecure + TLS |
| `ingress.tls.enabled` | Enable TLS on the ingress | `true` |
| `ingress.tls.secretName` | TLS secret name (empty = Traefik default cert) | `""` |
| `storage.storageClass` | Kubernetes storage class for the data volume | `local-path` |
| `storage.data.size` | Size of the SQLite data volume | `1Gi` |

## Secrets

Create `deploy/secrets.{env}.yaml` manually — this file must not be committed to Git (it is covered by `.gitignore`).

```yaml
secrets:
  adminPassword: "your-admin-password"   # minimum 12 characters
  secretKey: "your-secret-key"           # minimum 32 characters, used for JWT signing
```

| Key | Description |
|-----|-------------|
| `secrets.adminPassword` | Password for the initial admin account (minimum 12 characters) |
| `secrets.secretKey` | Key used to sign JWTs and session tokens (minimum 32 characters) |

## Environments

- `values.dev.yaml` — dev-specific overrides (ingress host, etc.)
- `values.prod.yaml` — prod-specific overrides
- `secrets.dev.yaml` / `secrets.prod.yaml` — credentials per environment (not in Git)
