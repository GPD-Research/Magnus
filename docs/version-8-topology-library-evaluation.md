# Version 8 topology library evaluation

## Recommendation

Use [`a-b-street/osm2streets`](https://github.com/a-b-street/osm2streets) at
revision `fc119c47dac567d030c6ce7c24a48896f58ed906` as the topology foundation
for Version 8. Do not continue expanding the hand-built gore formulas as the
primary roadway renderer.

The selected revision is an active public repository under the Apache License
2.0. It is the same topology foundation already selected in the Version 8
architecture document.

## What it solves

The upstream pipeline has the missing ownership model:

- `streets_reader` splits raw OSM ways into logical roads and intersections.
- `osm2streets` retains original OSM way and node IDs on normalized roads.
- `intersection_polygon` computes a shared pavement polygon instead of
  independently extending every centerline through a junction.
- Road trimming is calculated from the intersection geometry, not from a fixed
  distance or from whether two ways happen to share an OSM node.
- Bridge and tunnel z-order are represented separately from ordinary
  intersections, so a grade-separated crossing is not turned into a gore.
- Short-road and degenerate-intersection transformations are available for
  removing pseudo-nodes and fragmented roadway pieces.

This is a better fit for ramp merges, ramp diverges, and complex interchanges
than the current `overpass.rs` renderer, which still derives visible pavement
from each raw way and then adds gore corrections.

## PBF preparation tools

The proposed tools are useful before topology conversion, but they are not
replacements for the topology or geometry stage:

- **libosmium / osmium-tool** is the preferred high-performance C++ option for
  extracting, clipping, filtering, and merging OSM data while retaining nodes,
  ways, and relations. The existing Magnus preparation scripts already expect
  `osmium-tool` for the filtered Northern Virginia package.
- **PyOsmium** is appropriate for a repeatable Python analysis or QA script.
  It can isolate candidate motorway links, inspect tags, and produce a reduced
  PBF for the topology worker. It does not calculate intersection polygons or
  decide where pavement and fog lines should terminate.
- **Osmosis** can merge and filter PBF files, but it is an older Java runtime
  dependency and provides no advantage for the geometry problem here.

The recommended chain is therefore:

```text
libosmium/osmium-tool or PyOsmium
  -> preserve and filter the relevant OSM graph
  -> osm2streets + streets_reader
  -> logical roads, trimmed centerlines, intersection polygons
  -> Magnus RoadScene adapter
```

Filtering must not remove bridge, tunnel, or relation information before the
topology worker sees it. In particular, selecting only `highway=motorway_link`
ways would destroy the mainline context needed to distinguish a real merge
from a grade-separated crossing.

## Integration constraints

`osm2streets` is not currently published as a standalone crates.io package.
The pinned workspace requires:

- `osm2streets`
- `streets_reader`
- the upstream `geom` Git dependency
- A/B Street `abstutil`
- the upstream OSM reader and lane-processing dependencies used by
  `streets_reader`

Adding only `osm2streets` to `crates/spatial-core` would not be a complete or
reliable integration. The dependency should therefore be isolated behind a
feature or a separate topology worker while its dependency graph and output
contract are evaluated.

## Proposed production boundary

```text
prepared PBF / Overpass JSON
  -> topology worker using streets_reader + osm2streets
  -> normalized road/intersection DTOs
  -> Magnus topology adapter
  -> existing RoadScene IPC contract
  -> SVG renderer
```

The adapter should emit:

- one normalized road feature per logical road, with source way IDs
- one pavement polygon per normalized intersection
- trimmed road centerlines for SSP section selection and placement
- bridge/tunnel layer and z-order metadata
- source IDs and tags needed by labels and diagnostics

The SVG layer should render normalized pavement polygons and trimmed road
markings. It should not render the old raw ramp casing, raw ramp surface, or
hand-built `RampGore` geometry for topology-backed scenes.

## Migration gates

1. Add the pinned upstream crates in an isolated worker and compile a small
   synthetic fixture.
2. Add a golden fixture with a fragmented mainline, entrance ramp, exit ramp,
   grade-separated crossing, and disconnected road.
3. Assert that normalized roads terminate at logical intersections, the shared
   pavement polygon fills the V-shaped merge area, the overpass remains
   crossing-only, and the disconnected road is absent.
4. Convert the fixture to `RoadScene` without changing the frontend contract.
5. Compare the topology-backed scene with the current scene in a visual review.
6. Enable topology-backed rendering for prepared PBF first, then live Overpass
   resolution, with an explicit fallback status when topology conversion fails.
7. Remove the old gore/ribbon path only after both prepared and live acceptance
   fixtures pass.

## Decision

Do not delete the existing gore code yet. It is still the only live renderer,
and the external library has not been connected to Magnus's scene contract.
The next implementation task is now the live worker invocation and golden
fixture comparison, not another fog-line or gore-distance patch.

## Mixing Bowl baseline

On 2026-08-27, a live request for `I-95 / Northbound / Mile marker 170`
returned 936 features from the legacy Overpass compiler, including 58 ramp
ribbons, 13 gore polygons, and 116 ramp fog-line features. The longest ramp
fog-line feature measured approximately 5,396 feet. This is the acceptance
failure the topology-backed output must eliminate: ramp markings must terminate
at logical merge/diverge geometry rather than remain long independent lines.

The initial worker scaffold is now at `tools/topology-worker`. It pins the
upstream A/B Street conversion crate and the compatible `osm2streets` source.
The standalone worker lockfile records the resolved upstream revisions,
applies disconnected-road, short-road, and degenerate-intersection
transformations, and exports a compact `topology-scene` JSON artifact. It is
intentionally not part of the production workspace until its dependency build
and fixture output are accepted. Magnus now has a `compile_topology_scene`
adapter that converts the worker artifact into `RoadScene` features, including
trimmed logical roads and shared intersection surfaces.

Validate the worker with:

```bash
cargo check --manifest-path tools/topology-worker/Cargo.toml
```

The worker compiles successfully. Its output is not consumed by the live server
yet. The first direct attempt to consume `convert_osm` inside Magnus exposed
duplicate upstream `abstutil` and `osm2streets` package identities, so the
standalone boundary is required until a `RoadScene` adapter is implemented.

The synthetic fixture can be exercised with:

```bash
cargo run --manifest-path tools/topology-worker/Cargo.toml -- \
  tools/topology-worker/fixtures/mixing-bowl.osm /tmp/mixing-bowl-topology.json
```

The worker also accepts an optional GeoJSON polygon as its third argument.
Prepared statewide packages should be clipped before conversion:

```bash
cargo run --manifest-path tools/topology-worker/Cargo.toml -- \
  data/raw/virginia-latest.osm.pbf /tmp/mixing-bowl-topology.json \
  /path/to/mixing-bowl-clip.geojson
```

The current fixture produces a `topology-scene` version 1 artifact with eight normalized roads: two fragmented mainline
pieces, two merge/diverge links, one layer-1 bridge, two bridge approaches, and
no disconnected test road. It produces eight intersections. The bridge is
retained because its approaches connect it to the network, while its crossing
remains structurally separate from the layer-0 mainline.