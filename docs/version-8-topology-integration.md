# Version 8 topology integration (legacy)

Version 8 will replace Magnus's hand-built OSM centerline cleanup and gore
construction with an intermediate topology produced by
[`osm2streets`](https://github.com/a-b-street/osm2streets).

## Objective

The current spatial core renders each OSM way independently and then tries to
reconstruct roadway boundaries, ramps, intersections, and gores from centerline
geometry. That approach leaves lines continuing past ramp beginnings and
endings, and it becomes unreliable when an interchange contains fragmented
mainlines, pseudo-nodes, short connector ways, or disconnected nearby roads.

Version 8 will make normalized roadway topology the source for visible roadway
geometry. Magnus should consume logical roads, lanes, and intersections rather
than treating every raw OSM way as an independent drawable surface.

## Proposed pipeline

```text
OSM PBF
  -> streets_reader
  -> osm2streets StreetNetwork
  -> topology transformations
  -> Magnus topology adapter
  -> RoadScene IPC contract
  -> SVG roadway renderer and SSP overlay
```

The initial upstream revision selected for evaluation is `fc119c47`.

## Production status

The first adapter slice is active in the spatial core. Prepared PBF compilation
now removes disconnected road subnetworks by retaining the largest connected
component, while preserving the source way IDs and metadata of retained ways.
The existing `RoadScene` output and gore compiler remain the compatibility path
until normalized road and intersection geometry are available.

The topology transformation sequence should evaluate:

- removal of disconnected roads
- collapse of short roads and pseudo-nodes
- collapse of degenerate intersections
- merging of dual carriageways where appropriate

The transformed network must retain source OSM way and node IDs so Magnus can
continue to provide attribution, labels, structural layering, diagnostics, and
section selection.

## Geometry ownership

The normalized road and intersection polygons should control visible pavement
extent. A raw ramp centerline may remain in the intermediate model as an
interaction and SSP-placement reference, but it must not determine how far the
visible ramp pavement extends through a mainline.

The adapter remains responsible for Magnus-specific concerns:

- conversion into local feet-based coordinates
- bridge, tunnel, and structural-layer metadata
- bounded scene extraction and clipping
- VDOT shoulder and auxiliary-lane presentation rules
- `RoadScene` feature IDs and source metadata
- SSP section-selection and equipment placement references

The existing gore formulas should be treated as a compatibility fallback during
the migration, not as the primary topology engine.

## Migration plan

1. Add `osm2streets` and `streets_reader` as pinned Rust dependencies.
2. Build a small adapter that reads the Mixing Bowl PBF fixture and exports the
   transformed network before changing the live scene path.
3. Add a golden topology fixture containing a fragmented mainline, an entrance
   ramp, an exit ramp, a grade-separated crossing, and a disconnected nearby
   road.
4. Verify that normalized roads stop at logical intersections and that
   disconnected geometry is excluded.
5. Convert normalized road and intersection geometry into `RoadScene` while
   preserving the existing frontend contract.
6. Compare the new scene with the current renderer and remove hand-built gore
   construction only after the new path passes the fixture and visual review.
7. Keep the current compiler available as a fallback while prepared PBF and
   live Overpass scenes are migrated.

## Decision boundary

`osm2streets` is the selected topology foundation for Version 8. `osm2lanes` is
not a separate foundation because its repository is archived and its lane logic
now ships as a crate inside the `osm2streets` workspace. OSMnx was left open
here as a possible offline analysis or validation aid; Version 9 closed that
question and excluded it outright. See the Topology engine decision in the
README.