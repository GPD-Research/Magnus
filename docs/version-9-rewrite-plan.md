# Version 9 navigation foundation rewrite

Version 8 is preserved as the legacy Magnus scene-builder release. It proves
that the SSP training workflow, equipment placement, communications, portable
scenes, and diagram overlay are valuable, but its roadway renderer is not a
navigation-quality foundation.

## Goal

Version 9 will rebuild roadway representation around a navigation-oriented OSM
pipeline. Magnus will render a local major-artery area selected by mile marker
or exit number. It does not need start/destination routing or turn-by-turn
navigation.

The vector incident diagram is an overlay on top of the normalized map. SSP
trucks, cones, responders, hazards, annotations, communications, and training
controls remain Magnus-owned features.

Version 9 is a navigation-map rewrite, not a rewrite of the SSP application.
The map subsystem must be independently replaceable behind the bridge contract;
the existing diagram GUI should remain a consumer of normalized road and lane
references.

## Data pipeline

```text
OSM PBF/XML
  -> osmium-tool or PyOsmium preparation
  -> clipped local OSM extract with nodes, ways, relations, and structure tags
  -> streets_reader
  -> osm2streets StreetNetwork
  -> topology transformations
  -> normalized road/lane/intersection artifact
  -> Magnus navigation-map adapter
  -> map renderer
  -> incident diagram overlay
```

The rewrite should preserve as much OSM information as the source provides:

- source way, node, and relation IDs
- route references and destinations
- lane specifications and directions
- shoulder tags and widths
- bridge, tunnel, and layer metadata
- turn and lane-change tags
- logical road endpoints and trim distances
- normalized intersection polygons
- semantic lane markings

The controlling topology invariant is shared-node connectivity. A 2D crossing
without shared node connectivity is never promoted to a merge or diverge. Layer,
bridge, and tunnel metadata distinguish grade-separated crossings; an
unshared same-level crossing is retained as an unresolved diagnostic until the
source or topology engine supplies stronger evidence.

Magnus should infer only when the source or topology library cannot provide a
value. Inferred values must be marked as such in diagnostics and must never be
silently presented as surveyed roadway truth.

## Rendering ownership

The navigation map owns:

- normalized road surface polygons
- intersection polygons
- bridge and tunnel z-order
- trimmed logical road centerlines
- lane-level surfaces and semantic markings
- map labels and source attribution

The incident diagram owns:

- SSP vehicles and signboards
- cones and closure patterns
- responders, personnel, hazards, and incidentals
- annotations and communications
- training-mode audits and scene persistence

The old per-way gore, ribbon, and fog-line formulas are not part of the Version
9 foundational path. They remain only as Version 8 compatibility code until the
new path passes acceptance.

## First acceptance case

Use `I-95 / Northbound / Exit 143`, a simple cloverleaf, as the first real
acceptance case. It should prove:

- ramps terminate at logical merge/diverge geometry
- mainline and ramp pavement do not form X-shaped overlaps
- yellow left and white right edge markings stop at the correct boundaries
- acceleration and deceleration lanes are represented when supported by OSM
  tags and normalized lane data
- lane-count transitions are gradual or explicitly bounded by topology events
- bridge crossings remain crossings and are not classified as merges
- disconnected nearby roads are excluded without removing connected approaches
- source IDs remain available for diagnostics and SSP section selection

The Mixing Bowl remains a later stress case. It may retain known ambiguities if
the simpler cloverleaf behavior is correct and the structural distinctions are
visible.

## Milestones

1. Freeze Version 8 legacy and branch Version 9.
2. Keep the standalone topology worker and lock its upstream revisions.
3. Extend the worker artifact with complete lane specifications, semantic
   markings, shoulder evidence, structural metadata, and uncertainty flags.
4. Add the Exit 143 golden fixture and compare normalized output against
   explicit topology assertions, including shared versus unshared crossings.
   The initial bridge fixture now covers a connected ramp, a layer-separated
   overpass, semantic marking provenance, and exclusion of a disconnected way.
   The worker now emits typed relationship classifications for normalized
   intersections through the shared topology API.
5. Replace the current RoadScene adapter with a navigation-map adapter that
   consumes polygons and semantic markings without reconstructing gores in the
   frontend.
6. Preserve lane-level and marking-level semantics through the stable map bridge
   instead of reducing roads to a width and lane count.
7. Use the stable map bridge in `docs/version-9-map-bridge-contract.md` so the
   incident diagram overlay remains unchanged while map rendering migrates.
8. Enable the new map path for Exit 143 first, then expand to other VDOT
   major-artery mile-marker and exit scenes.
9. Retire Version 8 gore compatibility code only after the acceptance suite and
   visual review pass.

## Budget rule

Do not add PostGIS, Mapbox, QGIS, CartoCSS, or a routing engine unless a later
acceptance requirement needs it. The initial Version 9 foundation should use
local OSM preparation plus `streets_reader` and `osm2streets`, with a stable
JSON boundary into Magnus. This keeps infrastructure small while replacing the
fragile roadway geometry ownership model.

The SSP diagram system is deliberately out of scope for the roadway rewrite
except for its placement bridge. It should continue to receive a selected
logical road, lane reference, point/tangent queries, source IDs, and a shared
map transform rather than raw OSM ways or handcrafted gore geometry.
