#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
MAGNUS_URL="${MAGNUS_URL:-http://127.0.0.1:8787}"
STATE_DIRECTORY="${XDG_STATE_HOME:-$HOME/.local/state}/magnus"
LOG_FILE="$STATE_DIRECTORY/magnus.log"

open_magnus() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$MAGNUS_URL" >/dev/null 2>&1
  elif command -v gio >/dev/null 2>&1; then
    gio open "$MAGNUS_URL" >/dev/null 2>&1
  else
    printf 'Magnus is available at %s\n' "$MAGNUS_URL" >&2
  fi
}

if curl --silent --fail "$MAGNUS_URL/api/health" >/dev/null 2>&1; then
  open_magnus
  exit 0
fi

mkdir -p "$STATE_DIRECTORY"
cd "$PROJECT_DIRECTORY"
nohup npm start >>"$LOG_FILE" 2>&1 &

for _ in {1..120}; do
  if curl --silent --fail "$MAGNUS_URL/api/health" >/dev/null 2>&1; then
    open_magnus
    exit 0
  fi
  sleep 1
done

printf 'Magnus did not start. Review %s for details.\n' "$LOG_FILE" >&2
exit 1