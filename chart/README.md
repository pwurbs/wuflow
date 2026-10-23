# wuFlow Helm Chart

Helm chart for deploying [wuFlow](https://github.com/pwurbs/wuflow), a lightweight issue tracking and planning application, on Kubernetes. wuFlow runs as a single pod with an embedded SQLite database on a persistent volume, so no external database is needed.

This chart aims to provide a secure and simple deployment of wuFlow, keeping the values you need to set to a minimum.

The chart is oriented towards **Traefik** as ingress controller (the default of k3s): the defaults of `ingress.className` and `ingress.annotations` and the option `ingress.compress` are Traefik-specific. With another ingress controller, set `ingress.className`, replace `ingress.annotations` with your controller's equivalents, and enable compression in the controller itself (e.g. `use-gzip` in the ingress-nginx ConfigMap).

The chart runs under the Kubernetes [Restricted Pod Security Standard](https://kubernetes.io/docs/concepts/security/pod-security-standards/#restricted) out of the box. The wuFlow image is built to run as a non-root user, so no workarounds are needed.

## Installation

Pull the chart directly from GitHub Container Registry as an OCI artifact:

```bash
helm install wuflow oci://ghcr.io/pwurbs/charts/wuflow --version <chart-version> \
  --namespace wuflow --create-namespace \
  -f my-values.yaml
```

> **After the first install**, retrieve the generated initial admin password, see [Secrets](#secrets) below.

> **wuFlow does not support a context path.** The ingress `host` must be a dedicated (sub)domain such as `wuflow.example.com`. Deploying under a subpath (e.g. `example.com/wuflow`) is **not supported**.

## Configuration

Most important values in [`values.yaml`](values.yaml):

| Key | Description |
|-----|-------------|
| `ingress.host` | Dedicated hostname, e.g. `wuflow.example.com`. Required, no default. |
| `storage.storageClass` | StorageClass of the data volume. Default `local-path` (k3s), override for other distributions. |
| `storage.data.size` | Size of the data volume. Review before going to production; the default `local-path` StorageClass doesn't support resizing an existing PVC. |
| `wuflow.initialAdminEmail` | Login of the initial admin account, only used at the very first start. Default `admin@local`. |
| `secrets.existingSecret` | Name of an already existing Secret in the cluster, see [Secrets](#secrets) below. If empty, the chart creates the Secret itself. |
| `wuflow.remoteIpHeader` | HTTP header with the client IP, for login rate limits and request logs. Default `X-Forwarded-For`, as set by the ingress controller; behind the Cloudflare proxy use `CF-Connecting-IP`. Empty = all users share the ingress controller's IP and thus one login rate limit. How wuFlow selects the client IP: [Deployment "Client IP"](https://github.com/pwurbs/wuflow/blob/main/docs/deployment.md#client-ip). |
| `wuflow.trustedProxies` | CIDRs or IPs (comma-separated) of the proxies whose `wuflow.remoteIpHeader` is used. Empty (default) = loopback and the private ranges, which include the usual pod networks. No effect if `wuflow.remoteIpHeader` is empty. See [`WF_TRUSTED_PROXIES`](https://github.com/pwurbs/wuflow/blob/main/docs/configuration.md). |
| `ingress.compress` | `true` creates a Traefik `compress` Middleware and attaches it to the ingress router, so responses are sent compressed. wuFlow itself doesn't compress, and this makes it considerably faster on slow connections. Requires `ingress.className: traefik` (helm fails otherwise) and Traefik's Kubernetes CRDs (`traefik.io/v1alpha1`, included with k3s and the Traefik Helm chart). Middlewares already set via the `traefik.ingress.kubernetes.io/router.middlewares` annotation are kept. Default `false`; not needed behind a CDN that compresses. |

All other values (log level, cookie and rate limit settings, ingress class and TLS, resource requests/limits, image tag, ...) have workable defaults. See [`values.yaml`](values.yaml) for the full list and further explanations.

## Secrets

By default (`secrets.existingSecret` empty), the chart generates `initial-admin-password` and `secret-key` itself on first install, so no cleartext secret ever needs to be set as a value. On every subsequent render, it carries the live values through unchanged. As long as nothing changed them out of band, the rendered Secret is byte-identical to the live one.
If the Secret already exists but is missing one of the two keys, the chart refuses to render rather than silently generating a replacement.

Exception: rendering offline (plain `helm template`, no cluster) always generates fresh, throwaway values instead. **Argo CD** renders charts exactly that way, so it would generate a new `secret-key` on every sync and log out all users each time. With Argo CD, always use `secrets.existingSecret`.

**How wuFlow uses the two values:**

- `initial-admin-password` is only used when the database contains no users yet, i.e. at the very first start. Later starts read but ignore it.
- `secret-key` is read on every start. It is the root key for signing JWTs and session tokens. Changing it logs out all users; nothing else breaks. If you change it directly in the cluster while Flux drift detection is enabled, add an `ignore` rule for the `/data` path of this Secret to the HelmRelease, otherwise Flux reverts your change.

Retrieve the generated admin password for the initial login:

```bash
kubectl get secret <release-name>-secrets -n <namespace> -o jsonpath='{.data.initial-admin-password}' | base64 -d; echo
```

Change it right after logging in the first time. From that point on, the initial password in the Secret is no longer relevant.

The Secret gets a `helm.sh/resource-policy: keep` annotation as a protection against an unintended `helm uninstall`. Back it up together with the data PVC, though: losing it generates a new `secret-key`, which logs out all users.

If you'd rather manage the Secret yourself outside of Helm (SOPS, External Secrets Operator, Sealed Secrets, ...), set `secrets.existingSecret` to its name and create it out of band. If it uses different key names, point the chart at them via `secrets.existingSecretKeys.initialAdminPassword` / `secretKey`.

## Persistent Volumes

The container user matters when manually copying data into the volume from outside the container.

| Volume | Mountpoint | Container user (UID) | Default size |
|--------|------------|----------------------|--------------|
| `<release-name>-data` | `/data` (SQLite database `wuflow.db`) | appuser (999) | 1Gi |

The Deployment uses the `Recreate` strategy, so the old pod has released the volume before the new one starts.

## Security Measures

The image runs as the non-root user `appuser` (UID/GID 999). The pod and its container set an explicit `securityContext` that satisfies the Restricted Pod Security Standard:

```yaml
runAsNonRoot: true
runAsUser: 999
runAsGroup: 999
seccompProfile:
  type: RuntimeDefault
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
privileged: false
readOnlyRootFilesystem: true
```

In addition:

- **Unprivileged port:** wuFlow listens on port 8080, so no extra capability or sysctl is needed.
- **No service account token:** `automountServiceAccountToken: false`, since wuFlow never talks to the Kubernetes API.
- **No cleartext secrets in values:** see [Secrets](#secrets).
- **Read-only root filesystem:** the only writable paths are the data volume `/data` and `/tmp`, a disk-backed `emptyDir` (max 64Mi, not persistent) for SQLite temp files.- **Optional user namespace:** `hostUsers: false` maps the container's UID 999 to an unprivileged, pod-unique UID on the node. Existing data stays accessible. Requires Kubernetes 1.33+, Linux kernel 6.3+ and a recent container runtime; pods fail to start on nodes without support.

## Health check

wuFlow provides the endpoint `GET /api/health` (no authentication, returns `HTTP 200`, no database access). The chart uses it for the startup, readiness and liveness probes. You can use it as an availability check too.

## License

[Apache License 2.0](../LICENSE)
