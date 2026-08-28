#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${OUTPUT_DIR:-${TMPDIR:-/tmp}/magnus-exit-143}"
SOURCE_OSM="${SOURCE_OSM:-$OUTPUT_DIR/exit-143.osm}"
TOPOLOGY_JSON="${TOPOLOGY_JSON:-$OUTPUT_DIR/exit-143-topology.json}"
OVERPASS_URL="${OVERPASS_URL:-https://overpass-api.de/api/interpreter}"
USER_AGENT="Magnus-development/9.0"
QUERY='[out:xml][timeout:60];(way[highway~"^(motorway|motorway_link|trunk|trunk_link)$"](38.460,-77.430,38.485,-77.395);node(w););out body;'

mkdir -p "$OUTPUT_DIR"
if [[ ! -s "$SOURCE_OSM" ]]; then
  printf 'Downloading bounded Exit 143 OSM extract...\n'
  curl --fail --location --max-time 90 --silent --show-error \
    --get "$OVERPASS_URL" \
    --data-urlencode "data=$QUERY" \
    --user-agent "$USER_AGENT" \
    --output "$SOURCE_OSM"
fi

printf 'Normalizing Exit 143 topology...\n'
cargo run --manifest-path tools/topology-worker/Cargo.toml -- \
  "$SOURCE_OSM" "$TOPOLOGY_JSON"

printf 'Checking Exit 143 topology acceptance...\n'
node tools/topology-worker/check-exit-143.mjs "$TOPOLOGY_JSON"
