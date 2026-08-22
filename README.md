# Magnus 4.5.0

Magnus is a visual incident-scene builder for Virginia Department of Transportation Safety Service Patrol training. Version 4.5.0 is a release candidate that stabilizes the Version 4 offline foundation and adds an expandable roadway workspace for classroom and presentation use.

Version 5 planning is tracked in [docs/version-5-roadmap.md](docs/version-5-roadmap.md).

## Version 4.5

This release includes:

- Independently collapsible configuration and operations panes on desktop and tablet
- Persistent presentation layout with accessible 44 px edge restore grips
- Keyboard focus transfer from a collapsed pane to its restore control
- Expanded roadway workspace without changing scene zoom or stored object coordinates
- Versioned settings migration that keeps existing Version 4 preferences compatible
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
- Draggable cones, SSP trucks, responder assets, personnel, and hazards
- Per-truck signboard controls with eight arrow and message states
- Expandable Assets and Hazards catalogs shared by the map view and 10 ft grid designer
- Vehicle-supplied equipment limits and live vehicle, cone, personnel, and hazard counts
- Selection, rotation, movement, and explicit deletion for deployed scene objects
- Local scenario persistence through **Save scenario**, with complete scene reset support
- Live SOP audit, scene metrics, and timestamped communications log
- Highway, direction, and mile-marker/exit location requests in the configuration pane
- Single-process production launch serving the UI and spatial API from Rust

Roadway rotation is intentionally deferred beyond Version 4.5 because it requires a shared forward and inverse map-transform pipeline across placement, dragging, drawing, panning, zooming, and export.

Prepared PBF packages are downloaded and inventoried by the app, while arbitrary offline highway/reference lookup still depends on a previously cached `RoadScene`. A cache miss is reported explicitly and never falls through to an internet provider in LAN or Offline mode.

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

Enhanced Safety preserves the three-cone buffer and all minimum clearances, allows more than five taper cones, and permits forward downstream spacing wider than 40 ft.

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

For dependable field use, open each required corridor in Online mode before disconnecting and confirm its scene appears in the prepared-scene count. Then select Offline mode and resolve the location again. A location not yet cached produces a clearly labeled development preview rather than unverified roadway geometry.

## Development and validation

The development command starts both the Rust spatial API and Vite frontend. Use `npm run dev:web` only when a spatial API is already running separately. The left-pane service indicator reports whether spatial resolution is connected; clearly labeled development-preview geometry remains available when it is not.

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

The central vector pane supports a 320-foot default view down to a 40-foot close view through toolbar controls or a control-wheel/pinch gesture. Ordinary trackpad wheel output pans the scene, and a three-finger direct-touch drag pans on tablets. Zoom keeps compiled roadway geometry and interactive SSP equipment in the same projected coordinate space.