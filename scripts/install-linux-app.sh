#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
LAUNCHER="${1:-$SCRIPT_DIRECTORY/launch-magnus.sh}"
APPLICATIONS_DIRECTORY="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICON_THEME_DIRECTORY="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
ICON_DIRECTORY="$ICON_THEME_DIRECTORY/scalable/apps"
DESKTOP_FILE="$APPLICATIONS_DIRECTORY/magnus.desktop"
ICON_FILE="$ICON_DIRECTORY/magnus.svg"

if [[ ! -f "$LAUNCHER" ]]; then
  printf 'Launcher not found: %s\n' "$LAUNCHER" >&2
  printf 'Usage: %s [/absolute/path/to/working-launcher.sh]\n' "$0" >&2
  exit 1
fi

LAUNCHER="$(cd -- "$(dirname -- "$LAUNCHER")" && pwd)/$(basename -- "$LAUNCHER")"
chmod +x "$LAUNCHER"
mkdir -p "$APPLICATIONS_DIRECTORY" "$ICON_DIRECTORY"
install -m 0644 "$PROJECT_DIRECTORY/public/favicon.svg" "$ICON_FILE"

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Magnus
GenericName=SSP Scene Builder
Comment=Build and review Safety Service Patrol roadway scenes
Exec=$LAUNCHER
Icon=magnus
Terminal=false
Categories=Utility;Education;
StartupNotify=false
EOF

chmod 0644 "$DESKTOP_FILE"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP_FILE"
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache --force "$ICON_THEME_DIRECTORY" >/dev/null 2>&1 || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIRECTORY" >/dev/null 2>&1 || true
fi

printf 'Magnus was added to your application drawer.\n'
printf 'Desktop entry: %s\n' "$DESKTOP_FILE"