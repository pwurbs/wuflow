# wuFlow Helm Chart

Deploys [wuFlow](https://github.com/pwurbs/wuflow) into a Kubernetes cluster.

## Installation

The chart is published as an OCI artifact to GitHub Container Registry:

```bash
helm install wuflow oci://ghcr.io/pwurbs/charts/wuflow --version <chart-version> \
  --namespace wuflow --create-namespace \
  -f values.yaml
```

> **After the first install**, retrieve the auto-generated initial admin password — see [Secrets](#secrets) below. It is not printed anywhere automatically.

## Important: Dedicated Hostname Required

> **wuFlow does not support a context path.** The ingress `host` must be a dedicated (sub)domain such as `wuflow.example.com`. Deploying under a subpath (e.g. `example.com/wuflow`) is **not supported** and will not work correctly.

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image | `ghcr.io/pwurbs/wuflow` |
| `image.tag` | Image tag | chart's `appVersion` (override only to test a different image tag) |
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

The chart auto-generates both secrets on first install and persists them across upgrades (the
`Secret` is only regenerated if it doesn't already exist in the cluster):

| Key | Description |
|-----|-------------|
| `secrets.initialAdminPassword` | Password for the initial admin account. Auto-generated if left empty (minimum 12 characters if set explicitly). |
| `secrets.secretKey` | Key used to sign JWTs and session tokens. Auto-generated if left empty (minimum 32 characters if set explicitly). Never needs to be read back. |

Retrieve the auto-generated admin password:

```bash
kubectl get secret <release-name>-secrets -n <namespace> -o jsonpath='{.data.initial-admin-password}' | base64 -d; echo
```

Change it immediately after logging in — it only exists to get you into the app on first boot.

Only set `secrets.initialAdminPassword` / `secrets.secretKey` explicitly if you need a fixed,
externally-managed value.
