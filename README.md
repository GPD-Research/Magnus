# Magnus 9.0.0

<img src="public/favicon.svg" alt="Magnus arrow-M logo" width="96" height="96">

Magnus is a visual incident-scene builder for Virginia Department of Transportation Safety Service Patrol training. Version 9.0.0 is the navigation-foundation rewrite branch.

The completed Version 6.0 release scope is recorded in [docs/version-6-delivery.md](docs/version-6-delivery.md). A full version-by-version development timeline reconstructed from git history is in [docs/development-history.md](docs/development-history.md).

The Version 8 topology integration direction is recorded in [docs/version-8-topology-integration.md](docs/version-8-topology-integration.md).

Version 8 is the legacy scene-builder baseline. The Version 9 navigation
foundation rewrite plan is recorded in [docs/version-9-rewrite-plan.md](docs/version-9-rewrite-plan.md).

## Version 9.0 navigation foundation rewrite

The spatial core now begins topology normalization by retaining the largest
connected road component when compiling prepared PBF data. Source way IDs and
metadata remain unchanged so the normalized output can continue through the
existing `RoadScene` contract while intersection and pavement geometry move
into the topology adapter.

Version 9 moves roadway representation to a navigation-oriented OSM topology
pipeline. The SSP scene and diagram system remains the overlay. Exit 143 on
I-95 is the first acceptance case; the Mixing Bowl remains a later stress case.

Version 9 treats Magnus as a local navigation-map application with an SSP
training overlay. It does not need start/destination routing or turn-by-turn
navigation. The map subsystem resolves a local area on a VDOT-maintained
major artery by mile marker or exit number, then supplies normalized roads,
lanes, intersections, markings, labels, and structural layers to the existing
scene-builder interface.

The map and overlay communicate through a versioned bridge contract described
in [docs/version-9-map-bridge-contract.md](docs/version-9-map-bridge-contract.md).
The roadway subsystem owns visible pavement and map semantics. The SSP
subsystem owns cones, vehicles, responders, hazards, annotations,
communications, audits, and scene persistence. This separation allows the
roadway renderer to be rewritten without replacing the working SSP GUI.

The normalization engine is `osm2streets`/`osm2lanes`, used natively rather
through Magnus-invented adapters. See
[Topology engine decision](#topology-engine-decision).

## Version 9 roadway truth model

The rewrite uses a 2.5D roadway model rather than full elevation. A 2D
geometric crossing is not by itself a merge:

```text
shared OSM node
	-> connected merge/diverge candidate

unshared nodes plus different layer/bridge/tunnel structure
	-> grade-separated crossing

unshared nodes at the same structural level
	-> unresolved diagnostic, never an automatic gore
```

This relationship is the controlling feature for pavement polygons, fog-line
termination, gore creation, and lane transitions. Overpasses remain crossings
without shared pavement or marking termination. Same-level connected roads are
processed as logical intersections by the navigation topology subsystem.

Magnus preserves source way, node, relation, lane, shoulder, bridge, tunnel,
layer, destination, and marking evidence wherever OSM provides it. Inferred
values are diagnostics, not silently presented as surveyed roadway truth.

## Version 7.0 release

This release includes:

- Named saved-scene library: **SAVE SCENE** now takes an editable file name, and a new **SAVED SCENES** menu lists every locally saved scene with load, download, and delete actions
- In-place scenario conversion that swaps the deployed SSP closure setup for another template while preserving unrelated scene equipment and roadway placement
- Tolerance-based SOP audit engine using percentage-derived cone-spacing checks instead of fixed-distance tolerances, with the active compliance mode persisted in the portable scene file
- Downstream cone protection requires at least one lead cone in front of the SSP truck, reported as a violation when absent
- "Enhanced Safety" training mode renamed to **Extended Safety**
- Distinct reset controls: **Reset SSP objects** and **Reset whole scene**, the latter now using a trash icon for clarity
- Ramp gore-aware lane markings: fog lines, skip lines, and shoulder edges are trimmed near ramp gore points instead of drawing through them, with gore length capped to the available way geometry

## Version 6.0 release

This release includes:

- Keyboard deletion for selected cones, SSP trucks, responder assets, and hazards
- Accurate 40 ft map scale derived from the current SVG viewport and zoom
- Center-toolbar traffic-flow bearing and map compass instruments
- Whole-center-view rotation in 45-degree steps with north-up reset and inverse pointer mapping
- Toggleable highway, ramp, and exit labels carried from OpenStreetMap references
- Collapsible Scene Type controls
- High-visibility **SAVE SCENE** and **LOAD SCENE** workflows
- PNG, JPG, and vector SVG output with a companion rebuildable `.magnus.json` scene file
- Portable scene recall including roadway geometry, location, layers, zoom, equipment, and communications
- Persistent and timed freehand SVG annotations sampled in map coordinates, with color, 1–10 ft width, undo, and layer visibility controls
- Dirty-scene exit confirmation and clean single-process application shutdown from the top-right X
- Fractional mile-marker route fallback when OpenStreetMap does not contain an exact tagged milestone

- Independently collapsible configuration and operations panes on desktop and tablet
- Persistent presentation layout with accessible 44 px edge restore grips
- Keyboard focus transfer from a collapsed pane to its restore control
- Expanded roadway workspace without changing scene zoom or stored object coordinates
- Versioned settings migration that keeps existing Version 4 preferences compatible
- High-visibility orange arrow-M identity shared by the app header, browser icon, and Linux launcher
- Unified Magnus wordmark with a package-derived short release label
- Online, LAN, and Offline map modes selected from the top bar or Settings
- Cache-only local resolution in LAN and Offline modes, with no public provider attempt
- Persistent roadway scene cache with provider failover in Online mode
- In-app preparation and storage status for Northern Virginia and statewide Virginia OSM packages
- Original light and default dark themes plus three locally saved color-derived custom themes
- Fixed moss-green roadway field across every theme
- Settings and connectivity preferences persisted on the local device
- Improved interchange, ramp, bridge, lane-marking, and half-mile corridor rendering
- Road-aligned scene placement, traffic-flow bearing, and four-way map compass
- Vehicle fire and hazmat tanker hazards
- Responsive three-pane scene builder for desktop, tablet, and mobile
- Eight shoulder, lane, and ramp management templates
- Standard SOP, Enhanced Safety, and SOP Violation training modes
- Draggable cones, SSP trucks, responder assets, personnel, hazards, and incidentals
- Per-truck signboard controls with eight arrow and message states
- Diagonal SSP Assets, External Assets, Hazards, and Incidentals tabs shared by the map view and 10 ft grid designer
- Vehicle-supplied equipment limits and live vehicle, cone, personnel, and hazard counts
- Selection, rotation, movement, and explicit deletion for deployed scene objects
- Local and portable scenario persistence, with complete scene reset support
- Live SOP audit, scene metrics, and timestamped communications log
- Highway, direction, and mile-marker/exit location requests in the configuration pane
- Single-process production launch serving the UI and spatial API from Rust

Center-view rotation now applies one shared map transform to roadway geometry, labels, and scene equipment. Placement and dragging use the inverse transform, the compass follows the selected orientation, and portable scene files retain the rotation value.

Prepared PBF packages are downloaded and inventoried by the app. Offline highway/reference lookup first uses compiled PBF geometry and then a previously cached `RoadScene`; a miss is reported explicitly and never falls through to an internet provider in LAN or Offline mode.

## Brand identity

The Magnus mark uses a black M with downward arrow terminals on a high-visibility orange field. In the application header, the mark serves as the first letter of the `M`agnus wordmark and is followed by `AGNUS` and the current short release label. The label is derived from the package version, so Version 7.0.0 displays as `v7`.

The same vector asset at `public/favicon.svg` is used for the application header, browser favicon, and installed Linux application icon.

## Launch

Requires Node.js 20 or newer and a current Rust toolchain.

Install dependencies once:

```bash
npm install
```

For active development with Vite hot reload:

```bash
npm run dev
```

For a production-style local launch from one process:

```bash
npm start
```

Open `http://127.0.0.1:8787`. In VS Code, `Ctrl+Shift+B` exposes equivalent development and production launch tasks.

### Linux application drawer

To add Magnus to the current user's Linux application drawer, run:

```bash
scripts/install-linux-app.sh
```

The entry uses the Magnus icon, launches without a terminal window, and opens the app in the default browser. To register an existing launcher instead, pass its path:

```bash
scripts/install-linux-app.sh /absolute/path/to/your/launcher.sh
```

The desktop entry is installed at `~/.local/share/applications/magnus.desktop`. Remove that file to remove Magnus from the application drawer.

## Single right-lane closure rules

Traffic flows from upstream to downstream. The SSP truck faces downstream in the right lane with its rear signboard showing a left arrow.

Standard SOP uses one anchor cone 10 ft behind the truck on the center/right skip line, two more buffer cones at 40 ft intervals, and five taper cones at 40 ft intervals terminating at the right fog line. This provides eight upstream cones total. The downstream lead cone is 10 ft ahead of the truck on the skip line, followed by cones every 40 ft in a straight line.

Extended Safety preserves the three-cone buffer and all minimum clearances, allows more than five taper cones, and permits forward downstream spacing wider than 40 ft.

SOP Violation training reports either condition as a violation:

- Fewer than eight cones in the rear upstream area
- Rear taper cone separation below 40 ft

## Scene template designer

Open **Scene design tool** from the left configuration pane to author MUTCD/VDOT setups on a 10 ft grid. The designer supports:

- Left/right fog lines, shoulder edges, and dashed skip lines defined as vector point sequences
- Snapped circles, squares, rectangles, SSP trucks, and traffic cones
- Drag positioning, dimensions, color, and rotation through affine 3x3 transforms
- Left arrow, split arrow, right arrow, and double-diamond signboard patterns
- JSON export and local template persistence
- Source metadata for standards review and revision control

Template coordinates use feet, an upper-left origin, and a bottom-to-top traffic vector so upstream appears at the bottom of every diagram. The seeded single right-lane template records the FHWA MUTCD as a public reference and marks the VDOT SSP procedure as an agency-controlled source requiring revision verification before approval.

## Connectivity and offline preparation

Use the top-bar selector to choose how Magnus obtains roadway geometry:

- **Online** reads local cached scenes first, then uses the configured Overpass provider pool when needed.
- **LAN** reads only geometry already available to the Magnus spatial service on the local network.
- **Offline** reads only geometry cached on the current Magnus device.

Open **Settings** in the top bar to inspect local scene-cache storage or prepare a Northern Virginia highway package or Virginia statewide source package. Preparation requires an internet connection. The Northern Virginia filtered package also requires `osmium-tool` on the device running the spatial service. Packages are stored under `data/`, remain outside Git, and can be refreshed from the same panel.

For dependable field use, prepare the required region before disconnecting, then select Offline mode and resolve the location again. If neither prepared nor cached map geometry contains that location, Magnus displays a clearly labeled, scale-accurate reference layout without map-derived labels.

## Development and validation

The development command starts the topology-backed Rust spatial API and Vite frontend. It builds the standalone topology worker and sets `MAGNUS_TOPOLOGY_WORKER` automatically, so visual inspection exercises normalized roadway data. Use `npm run dev:spatial` for the legacy Overpass-compatible API or `npm run dev:web` only when a spatial API is already running separately. The left-pane service indicator reports whether spatial resolution is connected; a clearly labeled scale reference remains available when it is not.

To produce the optimized server binary and frontend assets without launching them, run `npm run build:release`. Keep the generated `dist/` directory beside the repository when running `target/release/spatial_server`, or set `MAGNUS_WEB_DIR` to its location.

Quality checks:

```bash
npm run lint
npm test
npm run build
cargo test --workspace
```

### Browser tests

Install Chromium and its Linux system dependencies once:

```bash
npm run test:e2e:install
```

The system dependency step may request administrator privileges. Then run the desktop and mobile Chromium suites with:

```bash
npm run test:e2e
```

Use `npm run test:e2e:ui` for Playwright's interactive test runner. Failure traces, screenshots, and videos are written to the ignored `test-results` and `playwright-report` directories.

ESLint uses TypeScript's project service with type-aware recommended and stylistic rules across application, configuration, unit-test, and E2E files.

## Architecture

The frontend now renders roadway features through an IPC-safe `RoadScene` vector contract rather than generating pavement directly in React. The standalone Rust spatial core streams OSM PBF data, extracts roadway tags and structural layers, serializes matching DTOs, and indexes features with `rstar`. See [docs/spatial-architecture.md](docs/spatial-architecture.md) for the NoVA PBF and QGIS workflow.

Fallback roadway geometry is explicitly identified as a development fixture. It must not be treated as actual roadway geometry.

### Road location resolution

The **Roadway location** tool accepts a highway, travel direction, and either a mile marker or exit number. In Online mode, the Rust spatial service converts that request into an Overpass query against actual OpenStreetMap route, motorway-junction, milestone, bridge, tunnel, and layer tags. Successful responses are compiled into bounded feet-based `RoadScene` documents and persisted under `target/magnus-road-cache`. LAN and Offline modes use those local documents only.

Run both the API and Vite frontend together during development:

```bash
npm run dev
```

For separate process control, run `npm run dev:spatial` and `npm run dev:web` in different terminals.

Vite proxies `/api` requests to `127.0.0.1:8787`. Set `OVERPASS_URLS` to a comma-separated compatible provider pool, `OVERPASS_URL` to one provider, `MAGNUS_SPATIAL_ADDR` to change the API listener, or `MAGNUS_ROAD_CACHE_DIR` to relocate cached scenes. If requested geometry is unavailable under the selected connectivity policy, Magnus displays an explicit development-preview status rather than representing fixture geometry as map data.

`I-95 / Northbound / Mile marker 170` is the complex-interchange acceptance case for the Springfield Interchange, commonly called the Mixing Bowl. When a scene contains multiple roadway surfaces, the right-pane **Select section** control lets the operator choose a rendered mainline, ramp, or flyover as the controlled sector. SSP equipment and cones are then aligned to that way's center tangent while retaining feet-based spacing.

The central vector pane opens at a centered 500-foot view with equal scroll travel in every direction and supports a 40-foot close view through toolbar controls or a control-wheel/pinch gesture. Ordinary trackpad wheel output pans the scene, and a three-finger direct-touch drag pans on tablets. Zoom keeps compiled roadway geometry and interactive SSP equipment in the same projected coordinate space.

Further Work needs to be done to smooth the complex interchanges as there are still overlapping lines, failures in gore rendering, etc. 

### Roadway rendering status (2026-09-05)

Roughly three quarters of the original misalignment is resolved. Straight
highways and simple interchanges render acceptably; a complex multi-ramp
interchange is workable but still imperfect. What changed:

- All hand-rolled geometry was removed from the topology worker and the
  `RoadScene` adapter in favour of the native `geom` primitives. The previous
  per-point normal offset had no miter compensation, so every fog line and lane
  separator drifted on curves; measured against a real interchange the corrected
  offsets move individual lines by 10–35 ft.
- Edge line colour is now traffic-relative rather than lane-order-relative.
  Yellow marks a driver's left, white a driver's right, and an undivided two-way
  road is white on **both** outer edges. This corrected 26 of 26 two-way roads
  that were previously given a yellow outer edge.
- The merge/auxiliary lane is placed from the connected ramp's actual position
  rather than from OSM tags, which put it on the wrong side almost half the
  time. Measured on Exit 143: 20 of 20 auxiliary lanes now sit on the same side
  as their ramp.
- Gore points are derived and rendered from topology rather than hand-built.
- The bridge now carries a `navigationMap` snapshot in the same scene feet as
  the rendered features, with stable `topologyRoadId` values joining roads,
  intersections and markings. It replaces a raw upstream dump that was in an
  untranslatable coordinate frame and had no consumer.

Known remaining problems:

- **Fragment alignment.** `osm2streets` centres every road fragment on its own
  full width, so where lanes are added the whole cross-section shifts sideways
  by **half the added width**, away from the side the new lanes appear on. This
  is measurable and exact: a one-lane widening displaces the through lanes half
  a lane, two lanes displaces them a full lane, four lanes displaces them two.
  Four heuristics were tried and measured; all were worse than leaving the
  geometry alone, because chaining corrections along a corridor accumulates into
  multi-lane displacement. The geometry is currently left exactly as
  `osm2streets` produces it. The real fix is to place the cross-section from
  `reference_line` and `Placement`/`left_edge_offset_of` the way `osm2streets`
  intends, anchoring the edge that does not change, rather than any pairwise
  heuristic. Upstream leaves `Placement::Transition` unimplemented, so this has
  to be solved here.
- The effect is **local, not a systematic drift across the scene**. On the Exit
  143 acceptance case, northbound segments step laterally at fragment
  boundaries: the upstream segment typically sits to the *left* of the segment
  downstream of it in the direction of travel. The usual step is about half a
  lane, rising to roughly 1.5 lanes wherever an access, acceleration or
  deceleration lane is added — half of a one-lane and half of a three-lane
  widening respectively, matching the displacement law above. Segments away from
  a lane-count change are correct.
- **Not an x-axis effect.** The two carriageways occupy essentially the same
  horizontal span — mean x differs by about 3 ft, with ranges of 4808–8090 ft
  northbound and 4185–8239 ft southbound — so "further right" cannot separate
  them and nothing in the pipeline scales or shifts with x. The difference is
  the lane profile: northbound reaches a five-lane fragment while southbound
  never exceeds four, so northbound steps up to 1.5 lanes where southbound steps
  only half a lane. Southbound is very likely stepping too, just by 4.9 ft on a
  narrower road rather than 14.8 ft. Roads that read as perfect are the surface
  streets, which do not gain and drop lanes the way the interstate does.
- Correcting this cannot disturb the parts that already render well. The needed
  shift is half the width delta between adjoining fragments, so where the lane
  count does not change the correction is exactly zero by construction rather
  than by tuning.
- Skip lines are not yet at DOT scale — see the dash cycle note below.
- The coordinate reference system still needs to move to EPSG:2283/2284.

### Coordinate reference system

Source data from Overpass is always EPSG:4326, so a reprojection is required
regardless of target. Magnus is standardising on **EPSG:2283/2284 (Virginia
State Plane, US survey feet)**: it is conformal, holds scale error to about
1:10,000, and its native unit already matches the feet-based domain model.

EPSG:3857 was considered and rejected for the measurement path. Web Mercator
inflates scale by `1/cos(latitude)` — a factor of 1.2742 at 38.3°N — so a 12 ft
lane would measure 15.29 ft. That is unacceptable for a tool that audits cone
spacing in feet. If a tile basemap is ever required, the view layer should
reproject to 3857 while the authoritative geometry stays in State Plane.

Until that work lands, geometry passes through `geom`'s local equirectangular
fit to the extract bounding box, which scales x by the width of the southern
edge only. On the Exit 143 extract that is a 0.0965% shear — about 9.6 ft across
the scene, or 0.38 ft per 1,000 ft of northing. It applies uniformly to every
feature, so it does not pull connected roads apart.

### Topology engine decision

Topology cleaning — resolving intersections, dropping isolated sub-networks, and
collapsing pseudo-nodes where a road needlessly breaks into separate IDs — is
done with `osm2streets` and `osm2lanes`. Python's OSMnx is deliberately **not**
used. OSMnx models a general routing graph rather than lane-level roadway
geometry, so it over-generalizes exactly the lane specifications, widths,
shoulder evidence, and marking semantics Magnus depends on. OSMnx must not be
introduced anywhere it would conflict with or over-generalize what
`osm2streets`/`osm2lanes` already provide.

The corollary is that Magnus invents as few adapters as possible. Where the
upstream libraries already answer a question, Magnus uses their native output
instead of recomputing it:

- geometry uses the native `geom` primitives — `PolyLine::shift_from_center`,
  `shift_left`/`shift_right`, `make_polygons`, `exact_slice` — rather than
  hand-rolled point offsets, which lose miter compensation on curves
- roads, lanes, intersections, and markings come from `StreetNetwork` and its
  `to_lane_polygons_geojson`, `to_lane_markings_geojson`, and
  `to_intersection_markings_geojson` outputs
- lane specifications come from `lane_specs_ltr`, the left-to-right lane list
  `osm2lanes` infers from OSM tags

Magnus synthesizes a value only when the gap is confirmed by reading upstream
source. The pavement edge (fog line) is the current documented example:
`osm2streets` has no fog-line concept in `to_lane_markings_geojson` at all, so
the topology worker derives it from the imported shoulder widths.
