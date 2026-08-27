# Magnus 8.0.0

<img src="public/favicon.svg" alt="Magnus arrow-M logo" width="96" height="96">

Magnus is a visual incident-scene builder for Virginia Department of Transportation Safety Service Patrol training. Version 8.0.0 is now in production development.

The completed Version 6.0 release scope is recorded in [docs/version-6-delivery.md](docs/version-6-delivery.md). A full version-by-version development timeline reconstructed from git history is in [docs/development-history.md](docs/development-history.md).

The Version 8 topology integration direction is recorded in [docs/version-8-topology-integration.md](docs/version-8-topology-integration.md).

## Version 8.0 production development

The spatial core now begins topology normalization by retaining the largest
connected road component when compiling prepared PBF data. Source way IDs and
metadata remain unchanged so the normalized output can continue through the
existing `RoadScene` contract while intersection and pavement geometry move
into the topology adapter.

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

The development command starts both the Rust spatial API and Vite frontend. Use `npm run dev:web` only when a spatial API is already running separately. The left-pane service indicator reports whether spatial resolution is connected; a clearly labeled scale reference remains available when it is not.

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

How to Clean Topologies: I intend to use specialized libraries like Python's OSMnx or osm2streets / osm2lanes to resolve intersections, drop isolated sub-networks, and smooth pseudo-nodes where roads needlessly break into separate IDs. I may end branching the project to do a complete rebuild of the backend since this issue has defied correction despite many hours spent attempting to rectify such rendering issues. 
