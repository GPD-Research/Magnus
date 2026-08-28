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

`RoadScene` is shared conceptually by Rust and TypeScript. Features are sorted by ascending structural `layer`. Road casings render before surfaces at each level, allowing upper bridge and flyover casings to occlude lower roads. SSP assets and SOP templates remain a separate overlay and placement domain. Bridges and tunnels that omit an explicit OSM `layer` tag are inferred to `1`/`-1` respectively, so grade-separated crossings still stack correctly instead of tying at the default `0`.

Each OSM road surface retains its way ID, highway class, structural layer, and bridge/tunnel metadata. In complex scenes, the renderer can arm section-selection mode and use a selected way's center tangent as the transform origin for the SSP equipment overlay. The `I-95 Northbound / MM 170` Mixing Bowl request is the acceptance case for layered flyover selection.

OSM/Overpass only exposes ramp centerlines and tags — it has no pavement-marking or gore-polygon geometry, so Magnus must construct the merge visually. A `motorway_link`/`*_link` way's `road-surface`/`road-casing` features stay as their original centerline `LineString`, kept invisible (`renderWidthFeet: 0`) so section-selection and SSP placement keep working against that centerline unchanged. The actual visible pavement is a separate `ramp-surface-ribbon`/`ramp-casing-ribbon` polygon pair that tapers to a point wherever the ramp meets a `motorway`/`trunk` node.

A shared OSM junction node sits on the mainline's *centerline*, not on any of its marked lines, so every gore-related distance is derived from an actual line-line intersection instead of a fixed distance from that node (`compute_gore_geometry`/`gore_geometry_for_end` in overpass.rs, using the ramp's own tangent and lane/shoulder widths together with the mainline's `MainlineAnchor`). Two intersection points matter:

- **`tip`** — where the ramp's own fog line would cross the mainline's fog line. This is the theoretical gore nose: the ramp's own near-side fog line/lane markings stop exactly here (`ramp_trim_to_tip`), and it's the apex of the `ramp-gore` stripe polygon.
- **`base`** — where the ramp's own (near-side) shoulder edge would cross the mainline's shoulder edge, i.e. where the two roadways' pavement fully separates. The ribbon taper (`ramp_trim_to_base`) and the ramp's own near-side shoulder-edge trim both use this distance, and it's also where the `ramp-gore` stripe polygon widens out to (using the ramp's and mainline's fog lines evaluated at that same distance, `ramp_fog_at_base`/`mainline_fog_at_base`) — the depth MUTCD/VDOT gore hatching covers.

Only the ramp's *near* side (the side actually facing the mainline, `near_side_sign`, derived from the ramp's and mainline's relative tangents) is trimmed at all; the far side keeps its full length since nothing adjoins it there.

Where a ramp merges in or diverges out, the mainline's own edge markings change too, matching VDOT/MUTCD auxiliary-lane practice: the mainline's fog line on the ramp's side becomes a dotted lane line (3 ft dash / 9 ft gap, `AUXILIARY_DASH_LENGTH_FEET`/`AUXILIARY_GAP_LENGTH_FEET`, rendered as explicit `auxiliary-lane-line` segments) and its shoulder edge is omitted, over an arc-length "zone" computed per mainline way (`build_mainline_profiles`, `build_ramp_noses`, `compute_marking_zones`, `ZoneReference`). The fog-line zone boundary follows the precise `tip` crossing; the shoulder-edge zone boundary follows the precise `base` crossing — they are not the same point. An isolated on-ramp/off-ramp falls back to the standard 70 ft (`RAMP_GORE_LENGTH_FEET`) taper distance from its own nose; when an entrance ramp is followed by an exit ramp on the same side, the whole stretch between the two noses reads as one continuous auxiliary lane (dashed/gapped the entire way) instead of two short, separate zones — matching how closely-spaced interchanges are actually marked. This zone computation currently assumes the mainline fits in a single rendered fragment (true for the scene's typical ~2,640 ft radius); a mainline clipped into multiple disjoint fragments falls back to its normal unzoned treatment.

The topology path follows the same visual contract. `lane_specs_ltr` preserves
left-to-right lane widths and roles, so ordinary separators are derived only
between adjacent, same-direction `driving` lanes and follow the imported
centerline's full curve. Its first acceptance artifact is
`magnus-gore-sketch-combined.svg`: at I-95 northbound Exit 143, a three-lane
mainline becomes four lanes through a right-side merge-lane interval bounded
by two gore tips, then returns to three lanes. The solid right fog line ends
at each tip; the ramp fog lines meet the tips; the merge-lane boundary is a
dense white `auxiliary-lane-line`; and the ordinary lane separators continue
through the interval. The topology overlay must construct all of those paths
from the same paired gore positions and mainline arc-length interval, rather
than independently offsetting each road fragment.

When map-derived geometry is unavailable, the UI uses a `reference-layout` with standard highway dimensions so scene-building can continue at an accurate scale. It is explicitly identified as not map-derived and suppresses highway labels. Map scenes carry `source.type = osm-api` or `osm-pbf` and OpenStreetMap attribution.

## Public data licenses

- OpenStreetMap data: Open Database License (ODbL), attribution required.
- Geofabrik extracts: redistribution of OpenStreetMap data under ODbL.
- FHWA MUTCD: public federal reference; verify current edition and errata.
- VDOT supplements and SOPs: retain agency source, revision, and approval metadata.