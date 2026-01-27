
#------- Build stage ---------------------------------------------------------
# Use Debian-based Go image to match the runtime and ensure libc compatibility for CGO
FROM golang:1.25-trixie AS builder

# Arguments for cross-compilation
ARG TARGETOS
ARG TARGETARCH

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
RUN CGO_ENABLED=1 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -ldflags="-w -s" -o wutrak ./main.go


#------- Package stage ---------------------------------------------------------

# Current slim Debian image
FROM docker.io/library/debian:13.3-slim

# Create a non-login, non-root user and group
RUN groupadd -r appuser && \
    useradd -r -g appuser -s /usr/sbin/nologin appuser

WORKDIR /app

# Copy the built binary
COPY --from=builder /app/wutrak /app/wutrak

# Currently copy web assets is not required because they are packaged into the binary
# maybe we change this later

# Create data directory and make appuser own the files
RUN mkdir -p /data && chown -R appuser:appuser /data

# Directory for data persistence
VOLUME ["/data"]

# Expose at port 8080
EXPOSE 8080

# Switch to appuser
USER appuser

# This is the executable that runs
ENTRYPOINT ["/app/wutrak"]

# Default arguments: Store DB in a volume-friendly path
CMD ["-port", "8080", "-db", "/data/wutrak.db"]
