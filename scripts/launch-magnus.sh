#!/usr/bin/env bash
set -euo pipefail

# Desktop launchers (unlike an interactive terminal) don't source
# ~/.bashrc or ~/.profile, so per-user tool installs like rustup or nvm are
# often missing from PATH here even though `cargo`/`npm` work fine in a shell.
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
fi

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
MAGNUS_URL="${MAGNUS_URL:-http://127.0.0.1:8787}"
MAGNUS_PORT=8787
[[ "$MAGNUS_URL" =~ :([0-9]+)$ ]] && MAGNUS_PORT="${BASH_REMATCH[1]}"
STATE_DIRECTORY="${XDG_STATE_HOME:-$HOME/.local/state}/magnus"
LOG_FILE="$STATE_DIRECTORY/magnus.log"

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

# Ask the running server which commit it was actually built from. A locally
# written marker file can't detect a stuck old process that never exited, but
# the server's own report of its build commit can't lie about that.
running_commit() {
  curl --silent --fail "$MAGNUS_URL/api/health" 2>/dev/null \
    | grep -o '"commit":"[^"]*"' \
    | cut -d'"' -f4 \
    || true
}

# A graceful /api/exit only works if the currently-running server is new
# enough to have that route. If it's stuck (old binary, or ignored the
# request), forcefully clear the port so the new server can actually bind to
# it instead of silently leaving the stale one to keep answering requests.
force_clear_port() {
  local pids
  pids="$(lsof -ti "tcp:$MAGNUS_PORT" 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  kill $pids 2>/dev/null || true
  for _ in {1..5}; do
    is_healthy || return 0
    sleep 1
  done
  pids="$(lsof -ti "tcp:$MAGNUS_PORT" 2>/dev/null || true)"
  [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
}

# A desktop-icon click after `git pull` must not silently reopen a stale server
# left running from before the pull.
current_commit="$(git -C "$PROJECT_DIRECTORY" rev-parse HEAD 2>/dev/null || true)"

if is_healthy; then
  if [[ -z "$current_commit" || "$(running_commit)" == "$current_commit" ]]; then
    open_magnus
    exit 0
  fi
  printf 'Restarting Magnus to pick up newly pulled commits...\n' >&2
  curl --silent --fail -X POST "$MAGNUS_URL/api/exit" >/dev/null 2>&1 || true
  for _ in {1..30}; do
    is_healthy || break
    sleep 1
  done
  is_healthy && force_clear_port
fi

mkdir -p "$STATE_DIRECTORY"
cd "$PROJECT_DIRECTORY"

if ! command -v cargo >/dev/null 2>&1; then
  printf 'cargo (Rust) is not on PATH. Install it from https://rustup.rs and try again.\n' >&2
  exit 1
fi

# A fresh clone has no node_modules yet; `npm start`'s build step would fail
# immediately without this.
if [[ ! -d node_modules ]]; then
  printf 'Installing npm dependencies (first run after a fresh clone)...\n' >&2
  if ! npm install >>"$LOG_FILE" 2>&1; then
    printf 'npm install failed. Review %s for details.\n' "$LOG_FILE" >&2
    exit 1
  fi
fi

MAGNUS_BUILD_COMMIT="$current_commit" nohup npm start >>"$LOG_FILE" 2>&1 &
npm_pid=$!

printf 'Building and starting Magnus...\n' >&2

# A cold Rust build compiles the entire dependency graph from scratch, which
# can take far longer than a routine restart — give it generous room instead
# of giving up while a legitimate first-time build is still in progress. Watch
# the npm process itself so a build failure is reported immediately instead of
# waiting out the full timeout.
for i in {1..900}; do
  if is_healthy && { [[ -z "$current_commit" ]] || [[ "$(running_commit)" == "$current_commit" ]]; }; then
    open_magnus
    exit 0
  fi
  if ! kill -0 "$npm_pid" 2>/dev/null; then
    printf 'Magnus exited during startup. Review %s for details.\n' "$LOG_FILE" >&2
    exit 1
  fi
  (( i % 30 == 0 )) && printf 'Still building/starting Magnus (this can take a while on a fresh clone)...\n' >&2
  sleep 1
done

printf 'Magnus did not start with the expected build within the timeout. Review %s for details.\n' "$LOG_FILE" >&2
exit 1