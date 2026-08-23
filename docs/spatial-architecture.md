# Spatial architecture

## Scene equipment catalog

Assets and hazards are defined centrally in `src/domain/equipmentCatalog.ts`. Both the map scene and grid designer derive their toolkit groups, labels, dimensions, colors, limits, capacity rules, and scene counters from that catalog. A deployed object stores only its catalog identifier and scene transform, keeping scene documents compact and allowing catalog presentation to evolve independently.

To add an item that uses an existing glyph, add one `EquipmentDefinition` record. To introduce a new silhouette, add the catalog record and one case to `SceneEquipmentGlyph`. Do not add item-specific conditions to `App` or `SceneDesigner`; those surfaces should remain consumers of catalog metadata.

Capacity rules are declared with `limit` for fixed incident caps or `capacity` for inventory supplied by another vehicle class. Extend the capacity source union and the `sourceCounts` map only when introducing a genuinely new supplier relationship.

## Authority and ownership

The locally stored Northern Virginia `.osm.pbf` is the runtime roadway source of truth. QGIS is an authoring and validation environment; it does not replace OSM identifiers or silently mutate the PBF. Supplemental geometry must retain its source and revision metadata.

The pipeline is:

1. Download the public Virginia extract from Geofabrik.
2. Use Osmium to crop Northern Virginia and retain `highway=*` ways plus referenced nodes.
3. Optionally create an EPSG:2283 GeoPackage for QGIS inspection and supplemental authoring.
4. Stream the PBF through `magnus-spatial-core`.
5. Extract directional highway topology and OSM tags including `layer`, `bridge`, `tunnel`, `lanes`, and `oneway`.
6. Index compiled features with `rstar`.
7. Send bounded, IPC-safe `RoadScene` JSON to the HTML5/SVG renderer.

The frontend sends highway, direction, and mile-marker/exit parameters to the stateless Rust spatial API. The API generates an escaped Overpass query, locates the requested junction or milestone against matching OSM route refs, and converts only nearby returned ways into `RoadScene`. It does not maintain a second database of named locations. A failed map query produces a visibly labeled scale reference that never masquerades as OSM geometry.

## Data preparation

The large source files are intentionally ignored by Git.

```bash
scripts/prepare-nova-data.sh
scripts/build-qgis-geopackage.sh
```

Required command-line tools are `osmium-tool` and GDAL (`ogr2ogr`). QGIS can open `data/qgis/nova-highways.gpkg` directly.

Compile the PBF contract output with:

```bash
source "$HOME/.cargo/env"
cargo run -p magnus-spatial-core --bin compile_scene -- \
  data/processed/nova-highways.osm.pbf \
  data/processed/nova-road-scene.json \
  nova-highways \
  38.80 \
  -77.20
```

The compiler projects WGS84 coordinates into a local east-north-up plane measured in feet around the requested center. Prepared-map scans are bounded to 4,000 feet, keeping distortion negligible for the rendered corridor while preserving a simple, explicit `LOCAL_ENU_FT_FROM_EPSG:4326` scene contract.

## Rendering contract

`RoadScene` is shared conceptually by Rust and TypeScript. Features are sorted by ascending structural `layer`. Road casings render before surfaces at each level, allowing upper bridge and flyover casings to occlude lower roads. SSP assets and SOP templates remain a separate overlay and placement domain.

Each OSM road surface retains its way ID, highway class, structural layer, and bridge/tunnel metadata. In complex scenes, the renderer can arm section-selection mode and use a selected way's center tangent as the transform origin for the SSP equipment overlay. The `I-95 Northbound / MM 170` Mixing Bowl request is the acceptance case for layered flyover selection.

When map-derived geometry is unavailable, the UI uses a `reference-layout` with standard highway dimensions so scene-building can continue at an accurate scale. It is explicitly identified as not map-derived and suppresses highway labels. Map scenes carry `source.type = osm-api` or `osm-pbf` and OpenStreetMap attribution.

## Public data licenses

- OpenStreetMap data: Open Database License (ODbL), attribution required.
- Geofabrik extracts: redistribution of OpenStreetMap data under ODbL.
- FHWA MUTCD: public federal reference; verify current edition and errata.
- VDOT supplements and SOPs: retain agency source, revision, and approval metadata.