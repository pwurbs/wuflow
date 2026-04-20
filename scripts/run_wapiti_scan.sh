#!/bin/bash
# Tailored Wapiti vulnerability scan for wuFlow (Automated)
# This script starts the app, runs an unauthenticated scan, then authenticates and runs an authenticated scan.

# Project root
PROJECT_ROOT=$(pwd)
TEMP_DB="/tmp/wuflow_scan_$(date +%s).db"
TEMP_BIN="/tmp/wuflow_scan_bin_$(date +%s)"
APP_PORT="8088"
ADMIN_EMAIL="admin@local"
# Use hex to avoid characters like + or / that might cause escaping issues
ADMIN_PW=$(openssl rand -hex 16 | tr -d '\n\r')
REPORT_DIR="./test-results/wapiti"
REPORT_UNAUTH="$REPORT_DIR/report-unauth.html"
REPORT_AUTH="$REPORT_DIR/report-auth.html"
LOG_FILE="$REPORT_DIR/scan_console_output.log"

# Ensure output directory exists and is clean
rm -rf "$REPORT_DIR"
mkdir -p "$REPORT_DIR"

# Redirect all output to log file and console
exec > >(tee -a "$LOG_FILE") 2>&1

# Cleanup function
cleanup() {
  echo ""
  if [[ -n "$APP_PID" ]]; then
    echo "[*] Stopping wuFlow app (PID: $APP_PID)..."
    kill "$APP_PID" 2>/dev/null
    wait "$APP_PID" 2>/dev/null
  fi
  echo "[*] Removing temporary files..."
  rm -f "$TEMP_DB" "$TEMP_BIN"
  echo "[*] Done."
  return 0
}

# Set trap for cleanup
trap cleanup EXIT

# Kill any stale process on the target port
STALE_PID=$(lsof -t -i :$APP_PORT)
if [[ -n "$STALE_PID" ]]; then
  echo "[*] Killing stale process on port $APP_PORT (PID: $STALE_PID)..."
  kill -9 "$STALE_PID" 2>/dev/null
  sleep 1
fi

echo "[*] Building temporary binary..."
go build -o "$TEMP_BIN" main.go
if [[ $? -ne 0 ]]; then
  echo "[!] Build failed."
  exit 1
fi

echo "[*] Starting wuFlow app on port $APP_PORT..."
"$TEMP_BIN" \
  -port "$APP_PORT" \
  -dbpath "$TEMP_DB" \
  -initial-admin-password "$ADMIN_PW" \
  -api-rate-limit false \
  -log-level warn &
APP_PID=$!

# Brief sleep to see if it crashes immediately
sleep 1
if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "[!] Server process died immediately after start."
  exit 1
fi

# Wait for the app to be ready
echo "[*] Waiting for server to start..."
MAX_RETRIES=30
RETRY_COUNT=0
until curl -s "http://localhost:$APP_PORT/api/version" > /dev/null || [[ $RETRY_COUNT -eq $MAX_RETRIES ]]; do
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [[ $RETRY_COUNT -eq $MAX_RETRIES ]]; then
  echo "[!] Server failed to start in time."
  exit 1
fi

# Activate the virtual environment for Wapiti
source ~/python_wapiti_env/bin/activate

# Tailored module list
MODULES="backup,brute_login_form,buster,cookieflags,crlf,csrf,csp,http_headers,htp,inconsistent_redirection,permanentxss,redirect,sql,timesql,xss"

# --- PHASE 1: Authenticated Scan (crawls and discovers all endpoints) ---
echo "[*] Phase 1: Authenticating to perform Authenticated Scan..."

# Get the JWT token
AUTH_RESP_FILE="/tmp/auth_response_$(date +%s).txt"
curl -s -i -X POST "http://localhost:$APP_PORT/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\", \"password\":\"$ADMIN_PW\"}" > "$AUTH_RESP_FILE"

JWT_TOKEN=$(grep -o 'wf_access_token=[^;]*' "$AUTH_RESP_FILE" | cut -d'=' -f2)

if [[ -z "$JWT_TOKEN" ]]; then
  echo "[!] Failed to retrieve JWT token for authenticated scan."
  echo "Response from server:"
  cat "$AUTH_RESP_FILE"
  rm -f "$AUTH_RESP_FILE"
  exit 1
fi

rm -f "$AUTH_RESP_FILE"
echo "[*] Authentication successful. Running Authenticated Wapiti scan..."

wapiti -u "http://localhost:$APP_PORT/" \
  -m "$MODULES" \
  --swagger docs/swagger.json \
  -C "wf_access_token=${JWT_TOKEN}" \
  -f html \
  -o "$REPORT_DIR" \
  --flush-session \
  --color \
  -v 1

# Rename the authenticated report
mv "$REPORT_DIR"/localhost_*.html "$REPORT_AUTH" 2>/dev/null
echo "[*] Authenticated scan complete. Report: $REPORT_AUTH"

# --- PHASE 2: Unauthenticated Scan (reuses discovered URLs, no credentials) ---
echo "[*] Phase 2: Running Unauthenticated Wapiti scan (reusing crawl session)..."
wapiti -u "http://localhost:$APP_PORT/" \
  -m "$MODULES" \
  --swagger docs/swagger.json \
  -f html \
  -o "$REPORT_DIR" \
  --color \
  -v 1

# Rename the unauthenticated report
mv "$REPORT_DIR"/localhost_*.html "$REPORT_UNAUTH" 2>/dev/null
echo "[*] Unauthenticated scan complete. Report: $REPORT_UNAUTH"

# Deactivate venv
deactivate 2>/dev/null || true

echo "[*] All scans complete. You can find both reports in $REPORT_DIR"

# Open both reports in the browser automatically (Mac script)
open "$REPORT_AUTH"
open "$REPORT_UNAUTH"
# The trap 'cleanup' will run automatically now
