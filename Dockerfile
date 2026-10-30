
#------- Frontend build stage ------------------------------------------------
# Builds the frontend with Vite. The output is plain HTML/JS/CSS and does not
# depend on the target architecture, so this stage runs on the build platform
# only, even in multi-arch builds.
FROM --platform=$BUILDPLATFORM docker.io/library/node:24.22.2-alpine3.24 AS frontend

WORKDIR /app/static/js

# Install the exact versions from package-lock.json first (cached layer).
# --ignore-scripts: no package install scripts are needed for the build.
COPY static/js/package.json static/js/package-lock.json ./
RUN npm ci --ignore-scripts

COPY static /app/static
RUN npm run build


#------- Build stage ---------------------------------------------------------
# Use Alpine-based Go image to match the runtime and ensure musl libc compatibility for CGO
FROM docker.io/library/golang:1.27.3-alpine3.24 AS builder

# Arguments for cross-compilation
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev

# CGO needs a C toolchain and musl libc headers to compile mattn/go-sqlite3
RUN apk add --no-cache gcc musl-dev

# Set working directory to separate build from GOPATH
WORKDIR /app

# Copy and load dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy relevant source code and the frontend build output
COPY main.go ./
COPY backend ./backend
COPY --from=frontend /app/static/dist ./static/dist

# Build static binary for the target architecture
# Enable CGO for sqlite3 support
RUN CGO_ENABLED=1 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -ldflags="-w -s -X main.Version=${VERSION}" -o wuflow ./main.go


#------- Package stage ---------------------------------------------------------

# Slim Alpine image
FROM docker.io/library/alpine:3.24.3

# Create a non-login, non-root user and group
# Pinned to uid/gid 999 to match the previous Debian-based image, so existing
# /data volumes (owned by uid/gid 999 on the host) remain writable after upgrading.
# gid 999 is reserved by Alpine's built-in "ping" group (unprivileged ICMP), which
# this image doesn't use, so it's removed to free the gid for appuser.
RUN delgroup ping && \
    addgroup -S -g 999 appuser && \
    adduser -S -u 999 -G appuser -s /sbin/nologin appuser

WORKDIR /app

# Copy the built binary
COPY --from=builder /app/wuflow /app/wuflow

# Currently copy web assets is not required because they are packaged into the binary
# maybe we change this later

# Create data directory and make appuser own the files
RUN mkdir -p /data && chown -R appuser:appuser /data

# Directory for data persistence
VOLUME ["/data"]

# Expose at port 8080 as default, can be overridden by the "port" argument
EXPOSE 8080

# Set container image compatible default values
ENV WF_DBPATH=/data/wuflow.db
ENV WF_PORT=8080

# Placeholder for the external injection of the initial admin password for first run
ENV WF_INITIAL_ADMIN_PASSWORD=

# Switch to appuser
USER appuser

# This is the executable that runs
ENTRYPOINT ["/app/wuflow"]
