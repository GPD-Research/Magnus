# Spatial architecture

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

The frontend sends highway, direction, and mile-marker/exit parameters to the stateless Rust spatial API. The API generates an escaped Overpass query, locates the requested junction or milestone against matching OSM route refs, and converts only nearby returned ways into `RoadScene`. It does not maintain a second database of named locations. A failed live query produces a visibly labeled development preview; it must never silently masquerade as OSM geometry.

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

The initial compiler uses a local tangent-plane approximation in feet around the requested center. Before production interchange rendering, replace that approximation with a verified EPSG:2283 projection implementation and record the transformation parameters in the scene metadata.

## Rendering contract

`RoadScene` is shared conceptually by Rust and TypeScript. Features are sorted by ascending structural `layer`. Road casings render before surfaces at each level, allowing upper bridge and flyover casings to occlude lower roads. SSP assets and SOP templates remain a separate overlay and placement domain.

Each OSM road surface retains its way ID, highway class, structural layer, and bridge/tunnel metadata. In complex scenes, the renderer can arm section-selection mode and use a selected way's center tangent as the transform origin for the SSP equipment overlay. The `I-95 Northbound / MM 170` Mixing Bowl request is the acceptance case for layered flyover selection.

The current UI fixture is explicitly marked `development-fixture`. It exists only to exercise the contract and must not be presented as actual Northern Virginia geometry. Production scenes must carry `source.type = osm-api` or `osm-pbf` and OpenStreetMap attribution.

## Public data licenses

- OpenStreetMap data: Open Database License (ODbL), attribution required.
- Geofabrik extracts: redistribution of OpenStreetMap data under ODbL.
- FHWA MUTCD: public federal reference; verify current edition and errata.
- VDOT supplements and SOPs: retain agency source, revision, and approval metadata.