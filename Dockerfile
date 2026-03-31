
#------- Build stage ---------------------------------------------------------
# Use Debian-based Go image to match the runtime and ensure libc compatibility for CGO
FROM docker.io/library/golang:1.25.8-bookworm AS builder

# Arguments for cross-compilation
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev

# Set working directory to separate build from GOPATH
WORKDIR /app

# Copy and load dependency files
COPY go.mod go.sum ./
RUN go mod download

# Copy relevant source code
COPY main.go ./
COPY backend ./backend
COPY static ./static

# Build static binary for the target architecture
# Enable CGO for sqlite3 support
RUN CGO_ENABLED=1 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -ldflags="-w -s -X main.Version=${VERSION}" -o wuflow ./main.go


#------- Package stage ---------------------------------------------------------

# Slim Debian Trixie image
FROM docker.io/library/debian:13.4-slim

# Create a non-login, non-root user and group
RUN groupadd -r appuser && \
    useradd -r -g appuser -s /usr/sbin/nologin appuser

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
