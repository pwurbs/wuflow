# Deployment
wuFlow runs as a single binary with an embedded SQLite database. Container images are built for linux/amd64 and linux/arm64. Image tags match the release version without the leading `v` (release `v1.4.4` → image `1.4.4`). The [image repository](https://github.com/pwurbs/wuflow/pkgs/container/wuflow) lists all available tags. There is no `latest` tag.

## Deployment options
Whichever option you choose, run wuFlow behind a reverse proxy that terminates TLS and keep the Secure Cookie flag enabled. For details, see [Reverse proxy](#reverse-proxy) and [Secure cookie](configuration.md#secure-cookie).

### Docker
*For simple setups.*

For a Docker setup on a single host, put the settings in an env file and keep the port reachable only for the reverse proxy on the same host:

```bash
docker run -d --name wuflow --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  --env-file wuflow.env \
  -v wuflow-data:/data \
  ghcr.io/pwurbs/wuflow:<version>
```

`wuflow.env`:

```
WF_INITIAL_ADMIN_PASSWORD=change-me-to-something-long
WF_SECRET_KEY=<random string, at least 32 characters>
WF_REMOTE_IP_HEADER=X-Forwarded-For
```

The initial admin password must meet the [password policy](user-management.md#password-policy), otherwise the app doesn't start.

The embedded SQLite database is stored in the volume at `/data/wuflow.db`. After the first start, remove `WF_INITIAL_ADMIN_PASSWORD` from the env file. It is only used to create the first admin. All configuration options are listed in [Configuration](configuration.md).

### Kubernetes (Helm)
*For production use.*

The Helm chart is published as an OCI artifact on GitHub Container Registry:

```bash
helm install wuflow oci://ghcr.io/pwurbs/charts/wuflow --version <chart-version> \
  --namespace wuflow --create-namespace \
  --set ingress.host=wuflow.example.com
```

For all chart details, such as values and special requirements, see the [chart documentation](../chart/README.md).

For a detailed view of versions, manifests, values and changes, see [Artifact Hub](https://artifacthub.io/packages/helm/wuflow/wuflow).

### Home Assistant
*For private use at home.*

Run wuFlow as an add-on next to your smart home, ideal for organising the household: [add-on documentation](../home-assistant-addon/README.md).

## Reverse proxy
wuFlow serves plain HTTP. **It must run behind a reverse proxy** (e.g. Nginx, Traefik) in the same environment that **terminates TLS** and forwards requests to the app. Without TLS, the [Secure cookie](configuration.md#secure-cookie) flag can't work. The proxy should also pass the client IP and compress the responses.

### Client IP
wuFlow uses the client IP for the login and token-refresh rate limits and in its request logs. Behind a reverse proxy, the TCP connection comes from the proxy, so set **Remote IP Header** (`WF_REMOTE_IP_HEADER`) to the header in which your proxy passes the client IP. Otherwise all users share the proxy's IP and thus one login rate limit, and the request logs show the proxy's IP.

**Trusted Proxies** (`WF_TRUSTED_PROXIES`) defines which peers may set this header. The default (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`, `fc00::/7`) fits a proxy on the same host, in a Docker network or in a Kubernetes cluster. An invalid entry stops the app at startup, including an IPv4-mapped IPv6 range like `::ffff:10.0.0.0/104` (write it in IPv4 notation).

How wuFlow selects the client IP:
- It uses the header only if the request comes directly from a trusted proxy. From any other peer, it ignores the header and uses the IP of the connection.
- It reads the header from the right and skips trusted proxies. The first IP that isn't a trusted proxy is the client. Entries left of it are ignored, because the client can write them itself. If every entry is a trusted proxy, the leftmost one is used. Several lines of the header count as one list.
- If it reaches an entry that isn't an IP address, it uses the IP of the connection and logs a warning.

So the proxy may append to an `X-Forwarded-For` header the client sent. That's the usual behaviour of Nginx and Cloudflare. Hosts in a private network count as trusted proxies under the default, so a client in your LAN can set its own client IP: directly at wuFlow's port, and through a proxy that appends to the header. Keeping wuFlow's port reachable only for the proxy (bind it to `localhost` or a private interface, or use a firewall rule) closes only the direct path. To rule out both, narrow `WF_TRUSTED_PROXIES` to the proxy's address.

### Settings per setup

| Setup | `WF_REMOTE_IP_HEADER` | `WF_TRUSTED_PROXIES` | Proxy requirement |
|---|---|---|---|
| Proxy on the same host or in a Docker/private network | `X-Forwarded-For` | default | Nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` — Traefik: nothing |
| Proxy with a public IP | `X-Forwarded-For` | the proxy's IP | as above |
| Kubernetes ([Helm chart](../chart/README.md)) | set by the chart | default | A load balancer or CDN in front of the ingress controller must be trusted by it (Traefik: `forwardedHeaders.trustedIPs`) |
| Cloudflare proxy | `CF-Connecting-IP` | default | Only Cloudflare may reach the origin (firewall on [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) or Authenticated Origin Pulls). Otherwise anyone can set this header |

A proxy that doesn't trust the hop in front of it replaces the header, and all users share that hop's IP. Add only proxies or CDNs you know to a proxy's trusted IPs, never a whole network that internet clients may appear from.

### Compression
Like TLS, compression is left to the proxy. wuFlow itself sends its responses uncompressed. On slow connections, compression makes the first page load and the Backlog and Archive views considerably faster.
- **Traefik**: add the [`compress` middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/compress/) to the route that serves wuFlow. With the [Helm chart](../chart/README.md), set `ingress.compress: true`.
- **Nginx**: `gzip on;` with `gzip_types text/css text/javascript application/javascript application/json;` (HTML is always compressed when `gzip` is on).

### Caching
Caching needs no proxy configuration. wuFlow sets the cache headers itself, so don't let the proxy override them (see [Frontend](frontend.md#delivery)).
