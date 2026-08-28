# Version 9 map bridge contract

The SSP application must depend on a small navigation-map contract rather than
on `osm2streets`, raw OSM ways, or renderer-specific geometry. This keeps the
roadway rewrite self-contained and preserves the existing scene-builder GUI.

## Boundary

```text
navigation map subsystem -> NavigationMapSnapshot -> SSP diagram overlay
```

The map subsystem owns source data, topology, geometry, structure, markings,
labels, and map coordinate conversion. The overlay owns incident objects,
training rules, communications, annotations, and portable scene state.

## Snapshot shape

The bridge should expose a versioned document equivalent to:

```json
{
  "version": 1,
  "source": {
    "dataset": "...",
    "attribution": "...",
    "provider": "osm2streets"
  },
  "coordinateSystem": {
    "units": "feet",
    "origin": "top-left",
    "trafficFlow": "bottom-to-top"
  },
  "roads": [],
  "intersections": [],
  "markings": [],
  "labels": [],
  "diagnostics": []
}
```

Each normalized road must include:

- stable local road ID
- source OSM way IDs and endpoint node IDs
- trimmed centerline
- one or more lane records with type, direction, width, and source evidence
- pavement polygon geometry
- bridge, tunnel, layer, and z-order metadata
- logical endpoint references

Each lane record should retain semantic values rather than only a total lane
count. Markings must include their semantic type and geometry, such as edge,
lane separator, continuity, or merge boundary.

Intersections must include:

- normalized polygon geometry
- source node IDs
- connected local road IDs
- structural classification
- whether the area is a merge/diverge surface or a grade-separated crossing

The artifact uses per-road-pair `relationships` records with `roadIds`,
`kind`, and `sourceNodeIds`. Values for `kind` are `connected-at-node`,
`grade-separated`, or `unresolved`. The singular `relationship` value remains
as a compatibility summary of the first pair. The topology worker derives
these values from typed crossing candidates; the adapter carries the result
without asking the frontend to reinterpret raw OSM geometry.

## Crossing invariant

For two roads whose 2D geometries cross, node connectivity is the primary
relationship signal:

```text
shared OSM node -> connected merge/diverge candidate
unshared nodes + different layer/bridge/tunnel -> grade-separated crossing
unshared nodes + same structural level -> unresolved diagnostic
```

The navigation subsystem must never create a merge/diverge intersection merely
because two lines cross in 2D. A shared node or an explicit topology-library
intersection is required. Conversely, an unshared crossing with structural
separation must remain two independent roads: no gore, no fog-line termination,
and no shared pavement polygon.

## Overlay-facing placement API

The SSP overlay should ask the map subsystem for:

- the selected local road ID
- a point and tangent at a requested distance along that road
- the lane center or edge reference for a selected lane
- the map-to-screen transform
- the source IDs used for diagnostics

The overlay should never calculate a gore, offset a raw OSM way, or infer a
bridge from line crossings. It places equipment against normalized road and
lane references supplied by the map subsystem.

## Invariants

- Map geometry is authoritative for visible pavement.
- Overlay geometry cannot replace or extend map pavement.
- Centerlines used for interaction may be invisible but must retain stable IDs.
- A bridge/tunnel crossing is not an intersection unless the topology snapshot
  explicitly classifies it as one.
- Missing or inferred values carry an uncertainty diagnostic.
- Snapshot coordinates are in feet before the overlay receives them.
- Version changes are required when IDs, coordinates, or geometry semantics
  change incompatibly.

## Migration rule

The current `RoadScene` document can remain the transport envelope during the
migration. The new navigation adapter should populate its map features from a
`NavigationMapSnapshot`; the SSP GUI should continue consuming the existing
equipment, scenario, audit, communication, and drawing APIs.

The Version 8 gore and ribbon code must not be reachable from a topology-backed
snapshot. It remains available only for legacy scenes until Exit 143 passes the
topology acceptance suite.