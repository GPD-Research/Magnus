#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
BRANCH="magnus-supreme-v1.0.0"
WEB_PORT="${MAGNUS_WEB_PORT:-5173}"
SPATIAL_PORT="${MAGNUS_SPATIAL_PORT:-8787}"
LOG_FILE="$PROJECT_DIRECTORY/target/magnus-dev.log"

stop_listener() {
  local port="$1"
  local process_ids
  process_ids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$process_ids" ]]; then
    printf 'Stopping existing listener on port %s...\n' "$port"
    kill $process_ids
  fi
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  else
    printf 'Open %s in your browser.\n' "$url"
  fi
}

cd "$PROJECT_DIRECTORY"

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf 'Refusing to overwrite uncommitted work in %s. Commit or stash it first.\n' "$PROJECT_DIRECTORY" >&2
  exit 1
fi

git fetch origin
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"

stop_listener "$WEB_PORT"
stop_listener "$SPATIAL_PORT"
rm -rf target/magnus-road-cache
mkdir -p target

printf 'Starting fresh topology development services. Logs: %s\n' "$LOG_FILE"
nohup npm run dev >"$LOG_FILE" 2>&1 &

for _ in {1..120}; do
  if curl --silent --fail "http://127.0.0.1:${SPATIAL_PORT}/api/health" >/dev/null; then
    fresh_url="http://127.0.0.1:${WEB_PORT}/?fresh=1"
    printf 'Magnus is ready at %s\n' "$fresh_url"
    open_browser "$fresh_url"
    exit 0
  fi
  sleep 1
done

printf 'Magnus did not become ready. Review %s.\n' "$LOG_FILE" >&2
exit 1