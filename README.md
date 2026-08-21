# Magnus 3.0.0

Magnus is a visual incident-scene builder for Virginia Department of Transportation Safety Service Patrol training. Version 3.0.0 combines live or preview roadway geometry, SOP evaluation, multi-agency scene resources, hazard modeling, and reusable template authoring in one application.

## Version 3.0.0

This release includes:

- Responsive three-pane scene builder for desktop, tablet, and mobile
- Standard shoulder and single right-lane closure templates
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

## Development and validation

The development command starts both the Rust spatial API and Vite frontend. Use `npm run dev:web` only when a spatial API is already running separately. The left-pane service indicator reports whether live spatial resolution is connected; clearly labeled development-preview geometry remains available when it is not.

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

### Live location resolution

The **Roadway location** tool accepts a highway, travel direction, and either a mile marker or exit number. The Rust spatial service converts that request into an Overpass query against actual OpenStreetMap route, motorway-junction, milestone, bridge, tunnel, and layer tags. It returns a bounded feet-based `RoadScene` without maintaining a separate local catalog of locations.

Run both the API and Vite frontend together during development:

```bash
npm run dev
```

For separate process control, run `npm run dev:spatial` and `npm run dev:web` in different terminals.

Vite proxies `/api` requests to `127.0.0.1:8787`. Set `OVERPASS_URL` to use another compatible Overpass endpoint and `MAGNUS_SPATIAL_ADDR` to change the API listener. If live geometry is unavailable, Magnus displays an explicit development-preview status rather than representing fixture geometry as map data.

`I-95 / Northbound / Mile marker 170` is the complex-interchange acceptance case for the Springfield Interchange, commonly called the Mixing Bowl. When a scene contains multiple roadway surfaces, the right-pane **Select section** control lets the operator choose a rendered mainline, ramp, or flyover as the controlled sector. SSP equipment and cones are then aligned to that way's center tangent while retaining feet-based spacing.

The central vector pane supports 50–250% zoom through toolbar controls or the mouse wheel/trackpad. Zoom changes the SVG camera view box, keeping compiled roadway geometry and interactive SSP equipment in the same projected coordinate space. The percentage button and fit control restore the imported scene viewport.