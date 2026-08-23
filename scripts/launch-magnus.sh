#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
MAGNUS_URL="${MAGNUS_URL:-http://127.0.0.1:8787}"
STATE_DIRECTORY="${XDG_STATE_HOME:-$HOME/.local/state}/magnus"
LOG_FILE="$STATE_DIRECTORY/magnus.log"
COMMIT_MARKER_FILE="$STATE_DIRECTORY/launched-commit"

open_magnus() {
  # A failed/absent opener (no display, no default browser) must not take the
  # whole launcher down with it under `set -e` — Magnus is already running.
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$MAGNUS_URL" >/dev/null 2>&1 || true
  elif command -v gio >/dev/null 2>&1; then
    gio open "$MAGNUS_URL" >/dev/null 2>&1 || true
  else
    printf 'Magnus is available at %s\n' "$MAGNUS_URL" >&2
  fi
}

is_healthy() {
  curl --silent --fail "$MAGNUS_URL/api/health" >/dev/null 2>&1
}

# A desktop-icon click after `git pull` must not silently reopen a stale server
# left running from before the pull. The app version in package.json doesn't
# change on every commit, so track the exact commit that was last launched
# instead and restart whenever the checked-out repo has moved past it.
current_commit="$(git -C "$PROJECT_DIRECTORY" rev-parse HEAD 2>/dev/null || true)"
launched_commit="$(cat "$COMMIT_MARKER_FILE" 2>/dev/null || true)"

if is_healthy; then
  if [[ -z "$current_commit" || "$current_commit" == "$launched_commit" ]]; then
    open_magnus
    exit 0
  fi
  printf 'Restarting Magnus to pick up newly pulled commits...\n' >&2
  curl --silent --fail -X POST "$MAGNUS_URL/api/exit" >/dev/null 2>&1 || true
  for _ in {1..30}; do
    is_healthy || break
    sleep 1
  done
fi

mkdir -p "$STATE_DIRECTORY"
cd "$PROJECT_DIRECTORY"
nohup npm start >>"$LOG_FILE" 2>&1 &

for _ in {1..120}; do
  if is_healthy; then
    [[ -n "$current_commit" ]] && printf '%s' "$current_commit" > "$COMMIT_MARKER_FILE"
    open_magnus
    exit 0
  fi
  sleep 1
done

printf 'Magnus did not start. Review %s for details.\n' "$LOG_FILE" >&2
exit 1