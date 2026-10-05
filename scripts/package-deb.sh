#!/usr/bin/env bash
# Build a Debian package containing the release spatial server, the topology
# worker, the built web app, and a desktop launcher. Output: dist-deb/*.deb
set -euo pipefail

PROJECT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIRECTORY"

VERSION="$(node -p "require('./package.json').version")"
DEB_VERSION="${VERSION/-/\~}"
ARCH="$(dpkg --print-architecture)"
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
# GitHub rewrites "~" in release asset names, so the file name uses the npm version.
PACKAGE="magnus_${VERSION}_${ARCH}"
STAGE="$PROJECT_DIRECTORY/dist-deb/$PACKAGE"

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  npm run build:release
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/DEBIAN" "$STAGE/opt/magnus/bin" "$STAGE/opt/magnus/web" \
  "$STAGE/usr/bin" "$STAGE/usr/share/applications" \
  "$STAGE/usr/share/icons/hicolor/scalable/apps"

install -m 0755 target/release/spatial_server "$STAGE/opt/magnus/bin/"
install -m 0755 tools/topology-worker/target/release/magnus-topology-worker "$STAGE/opt/magnus/bin/"
cp -r dist/. "$STAGE/opt/magnus/web/"
printf '%s\n' "$COMMIT" >"$STAGE/opt/magnus/BUILD_COMMIT"
install -m 0755 packaging/debian/magnus "$STAGE/usr/bin/magnus"
install -m 0644 packaging/debian/magnus.desktop "$STAGE/usr/share/applications/"
install -m 0644 public/favicon.svg "$STAGE/usr/share/icons/hicolor/scalable/apps/magnus.svg"

INSTALLED_SIZE="$(du -sk "$STAGE" --exclude=DEBIAN | cut -f1)"
cat >"$STAGE/DEBIAN/control" <<CONTROL
Package: magnus
Version: $DEB_VERSION
Section: education
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_SIZE
Depends: curl, xdg-utils, libc6 (>= 2.34)
Maintainer: GPD Research <gregorydearth@gmail.com>
Homepage: https://gpd-research.com/magnus.html
Description: Highway incident-scene builder for Safety Service Patrol training
 Magnus draws roadway templates from OpenStreetMap and lets instructors lay
 out trucks, cones, responders and hazards to scale. This package bundles the
 local spatial server, topology worker and web application; run "magnus" or
 use the application-drawer entry.
CONTROL

dpkg-deb --root-owner-group --build "$STAGE" "dist-deb/$PACKAGE.deb"
printf 'Built dist-deb/%s.deb\n' "$PACKAGE"
