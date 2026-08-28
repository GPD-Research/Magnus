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
   A real bounded Exit 143 OSM extract passes the repeatable checker at
   `node tools/topology-worker/check-exit-143.mjs <topology.json>`, or through
   `tools/topology-worker/run-exit-143-acceptance.sh` from source download to
   normalized artifact. The checker also requires motorway-ramp retention,
   complete pairwise relationship records for multi-road junctions, and source
   node evidence on each relationship.
5. Replace the current RoadScene adapter with a navigation-map adapter that
   consumes polygons and semantic markings without reconstructing gores in the
   frontend.
   The first rebuild checkpoint now transports the complete normalized
   `StreetNetwork` document in `normalizedTopology`; the derived RoadScene
   features remain a compatibility projection while the renderer migrates.
6. Preserve lane-level and marking-level semantics through the stable map bridge
   instead of reducing roads to a width and lane count.
7. Use the stable map bridge in `docs/version-9-map-bridge-contract.md` so the
   incident diagram overlay remains unchanged while map rendering migrates.
8. Enable the new map path for Exit 143 first, then expand to other VDOT
   major-artery mile-marker and exit scenes.
9. Retire Version 8 gore compatibility code only after the acceptance suite and
   visual review pass.

The current line-only boundary policy deliberately suppresses `ramp-gore`
polygon rendering. Ramp fog and available shoulder-edge markings terminate at
the mainline shoulder boundary; the remaining pavement and line overlap is
tracked as an acceptance defect rather than hidden with a misplaced fill.

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

## Status as of 2026-08-28 (resume notes)

Topology rendering is the default `npm run dev` path (`MAGNUS_TOPOLOGY_WORKER`
is set automatically). Recent work, in order:

- Real per-side shoulder width is derived from `lane_specs_ltr` (the
  left-to-right ordered OSM lane list osm2streets already exposes), replacing
  a hardcoded stopgap constant in `topology_adapter.rs`.
- `osm2streets` has no concept of a pavement edge/fog line at all (confirmed
  by reading its `to_lane_markings_geojson`) — fog lines are now synthesized
  in `tools/topology-worker/src/main.rs` (`fog_line_markings_for_road`) from
  lane widths, and correctly surfaced as `LeftFogLine`/`RightFogLine` features
  in `topology_adapter.rs` (previously all markings were collapsed into one
  generic per-layer polygon blob, discarding the real marking type).
- Fog lines now break near any ramp/acceleration/deceleration lane connection
  instead of drawing through the gore (`gore_fog_line_breaks` in
  `tools/topology-worker/src/main.rs`), per explicit design requirement.
- Fixed a startup bug in `src/App.tsx`: the app used to skip re-resolving the
  roadway from the live spatial API entirely whenever a saved scenario existed
  in browser `localStorage`, silently replaying old cached roadway geometry
  from before any of the above fixes. The startup effect now always calls
  `resolveRoadLocation`; only the initial SSP scene placement is still
  restored from the saved scenario. **If a rendering fix looks like it "isn't
  there" during manual testing, suspect a stale browser tab (or that specific
  browser's `localStorage['magnus.scenario']`) before suspecting the repo.**

All Rust workspace tests (`cargo test --workspace`) and frontend tests/build
(`npm run lint`, `npm test -- --run`, `npm run build`) pass as of this commit.

Next candidates: extend fog-line/gore-break handling to intersections that
aren't simple two-road connections (multi-way junctions), and audit whether
`shoulder edge` and `skip line` markings need the same per-type treatment fog
lines just received instead of remaining in the generic grouped polygon path.
