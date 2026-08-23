#!/usr/bin/env bash
set -euo pipefail

MAGNUS_URL="${MAGNUS_URL:-http://127.0.0.1:8787}"
APPLICATIONS_DIRECTORY="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_THEME_DIRECTORY="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
ICON_FILE="$ICON_THEME_DIRECTORY/scalable/apps/magnus.svg"
DESKTOP_FILE="$APPLICATIONS_DIRECTORY/magnus.desktop"
STATE_DIRECTORY="${XDG_STATE_HOME:-$HOME/.local/state}/magnus"

# Stop a currently running Magnus so a stale build can't keep serving after uninstall.
curl --silent --fail -X POST "$MAGNUS_URL/api/exit" >/dev/null 2>&1 || true

rm -f "$DESKTOP_FILE" "$ICON_FILE"
rm -rf "$STATE_DIRECTORY"

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache --force "$ICON_THEME_DIRECTORY" >/dev/null 2>&1 || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIRECTORY" >/dev/null 2>&1 || true
fi

printf 'Removed the Magnus application drawer entry, icon, and launcher state.\n'
printf 'The project folder itself (source, node_modules, target/) is untouched — delete it manually for a full reinstall.\n'
