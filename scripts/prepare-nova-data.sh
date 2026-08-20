#!/usr/bin/env bash
set -euo pipefail

VIRGINIA_URL="${VIRGINIA_URL:-https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf}"
RAW_PBF="${RAW_PBF:-data/raw/virginia-latest.osm.pbf}"
NOVA_PBF="${NOVA_PBF:-data/processed/nova-highways.osm.pbf}"
NOVA_BBOX="${NOVA_BBOX:--77.55,38.55,-76.95,39.15}"

if ! command -v osmium >/dev/null; then
  printf 'osmium-tool is required. Install it before preparing the NoVA extract.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$RAW_PBF")" "$(dirname "$NOVA_PBF")"

if [[ ! -f "$RAW_PBF" ]]; then
  printf 'Downloading public Virginia OSM extract from Geofabrik...\n'
  curl --fail --location --continue-at - --output "$RAW_PBF" "$VIRGINIA_URL"
fi

TEMP_EXTRACT="${NOVA_PBF%.osm.pbf}-all.osm.pbf"
printf 'Extracting Northern Virginia bbox %s...\n' "$NOVA_BBOX"
osmium extract --bbox "$NOVA_BBOX" --strategy complete_ways --overwrite \
  --output "$TEMP_EXTRACT" "$RAW_PBF"

printf 'Filtering highway ways while retaining referenced nodes...\n'
osmium tags-filter --overwrite --output "$NOVA_PBF" "$TEMP_EXTRACT" w/highway
rm -f "$TEMP_EXTRACT"

printf 'Prepared %s\n' "$NOVA_PBF"