#!/usr/bin/env bash
set -euo pipefail

NOVA_PBF="${NOVA_PBF:-data/processed/nova-highways.osm.pbf}"
QGIS_GPKG="${QGIS_GPKG:-data/qgis/nova-highways.gpkg}"

if ! command -v ogr2ogr >/dev/null; then
  printf 'GDAL ogr2ogr is required to create the QGIS authoring GeoPackage.\n' >&2
  exit 1
fi
if [[ ! -f "$NOVA_PBF" ]]; then
  printf 'Missing %s. Run scripts/prepare-nova-data.sh first.\n' "$NOVA_PBF" >&2
  exit 1
fi

mkdir -p "$(dirname "$QGIS_GPKG")"
rm -f "$QGIS_GPKG"
ogr2ogr -f GPKG "$QGIS_GPKG" "$NOVA_PBF" lines \
  -where "highway IS NOT NULL" \
  -nln osm_highways \
  -t_srs EPSG:2283

printf 'Created QGIS authoring layer %s in Virginia South State Plane feet.\n' "$QGIS_GPKG"