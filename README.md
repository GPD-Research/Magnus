# Magnus

Magnus is a visual scene builder for Virginia Department of Transportation Safety Service Patrol training. It combines open highway geometry with an interactive canvas for teaching and evaluating safe incident setups.

## Current milestone

The first development slice includes:

- Responsive three-pane scene builder for desktop, tablet, and mobile
- Standard shoulder and single right-lane closure templates
- Standard SOP, Enhanced Safety, and SOP Violation training modes
- Draggable cone placement outside strict Gospel mode
- Live SOP audit, scene metrics, and timestamped communications log
- Unit-tested rules for cone placement, spacing, and shoulder access
- Highway, direction, and mile-marker/exit location requests in the configuration pane

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

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

The development command starts both the Rust spatial API and the Vite frontend. Use `npm run dev:web` only when a spatial API is already running separately.

Quality checks:

```bash
npm run lint
npm test
npm run build
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

The current on-screen roadway is explicitly identified as a development fixture until a local NoVA extract is prepared. It must not be treated as actual roadway geometry.

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