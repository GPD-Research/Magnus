# ARCHITECTURE_SPEC.md

## SYSTEM OVERVIEW

Interactive, cross-platform 2D vector simulator and training utility for highway incident scene management and Temporary Traffic Control (TTC) instruction.

* **Target Platforms:** Linux Desktop (AppImage/Native), Android Tablets (Touch/Stylus), Web Browsers (PWA)
* **Primary Architectural Goal:** Zero-token-drift deterministic visual canvas powered by a structured vector coordinate matrix and WebAssembly spatial engine.

---

## TECH STACK & ENGINE

| Layer | Technology |
|-------|-----------|
| Frontend Canvas | HTML5 / SVG DOM via Vite + Vanilla JS |
| Backend Engine | Rust compiled via Tauri 2 (native desktop) |
| Desktop Wrapper | Tauri 2 (Rust runtime, no code-signing paywall) |
| Input Pipeline | Unified Pointer Events API (`pointerdown`, `pointermove`, `pointerup`) |
| Map Data | OpenStreetMap `.pbf` (local, offline, Geofabrik extract) |
| Export | Native lossless SVG XML serialization |

---

## SPATIAL COORDINATE MATRIX & ASSET CONSTRAINTS

The highway canvas maps to a strict 2D Cartesian grid measured in real-world feet.

### Reference Frame

* **Flow Vector:** Unidirectional — Upstream `Y=0` → Downstream `Y=N`
* **Lateral Axis (X):** Measured from Right Shoulder Edge (`X=0`)
* **Primary Pavement Markings:** Left Solid Yellow Line, Center Broken White Skip Lines, Right Solid White Fog Line

### Asset Transformation Policies

| Asset Class | Translation | Rotation | Scaling |
|-------------|-------------|----------|---------|
| Highway Base Infrastructure | ❌ Locked | ❌ Locked | ❌ Locked |
| Fleet Vehicles (SSP F350 / TMA) | ✅ Enabled | Fixed-step: 0°/90°/180°/270° | ❌ Fixed 22 ft × 8 ft |
| Standard TTC Assets (Cones/Flares) | ✅ Single-point + snap-to-line | ❌ | ❌ |
| Incident/Hazard Objects | ✅ Off-grid | ✅ 360° freeform | ❌ |

---

## THREE-PANE APPLICATION LAYOUT

```
+---------------------------------------------------------------------------------------------+
|  [ Scenario Presets ▼ ]  |  [ 🟢 GOSPEL SOP ]  [ 🔵 MODIFIED SOP ]  [ ⚠️ VIOLATE SOP ]  |  [ Export SVG ] |
+---------------------------------------------------------------------------------------------+
| LEFT PANE               | CENTER PANE                                | RIGHT PANE           |
| Communications Log      | Interactive Highway Canvas (SVG)           | Decision Analytics   |
|                         |                                            |                      |
| - Triggered Scripts     | - Unidirectional Highway Grid              | - Active Mode State  |
| - Channel Targets       | - Dynamic Measure Rays (Feet)              | - Live Risk Profile  |
|   (TOC, Supv, 911)      | - Snap-to-Line Overlay                     | - SOP Compliance     |
| - Event Timestamping    | - Floating Bottom Asset Drawer (Drag-Drop) |   Audit Engine       |
+-------------------------+--------------------------------------------+----------------------+
```

### Pane 1: Communications & Protocol Log (Left)

* **Action-Triggered Radio/Phone Scripts:** Dynamically generates reporting text based on canvas events (e.g., placing secondary unit generates advanced warning call to TOC)
* **Target Routing:** Categorises communications across TOC Radio, Field Supervisor Phone/Radio, and direct 911 Escalations

### Pane 2: Interactive Highway Canvas & Drawer (Center)

* **Central Interactive Workspace:** Scalable 2D SVG vector canvas rendering lanes, shoulder boundaries, and placed assets
* **Floating Asset Toolkit:** Drag-and-drop drawer for traffic cones, flares, F350 units, sign boards, arrow arrays, and crashed/hazard vehicles
* **Live Transformations:** Touch-driven multi-axis drag, snapping, and single-touch/twist rotation handles

### Pane 3: 3-Mode Decision Model & Field Analytics (Right)

* **Mode Evaluation:** Displays active operational logic and rationale
* **Live Real-World Metrics:** Calculates total taper distance, buffer length, and remaining cone inventory using MUTCD formulae
* **SOP Audit Engine:** Flags deviations, compressed taper gaps, and shoulder clear-zone infractions in real time

---

## OPERATIONAL MODES (THE THREE-MODE THINKING MODEL)

### 1. 🟢 Gospel SOP (Strict Compliance Mode)

* **Purpose:** Baseline textbook MUTCD setup instruction
* **Enforcement:** Hard snapping locked; upstream taper gaps forced to 40 ft intervals; baseline cone counts locked to minimums; clear-zone rules strictly enforced

### 2. 🔵 Modified SOP (Expanded Protection Mode)

* **Purpose:** Proactive field expansion for geometric hazards (e.g., blind curves, hill crests, high-speed corridors)
* **Enforcement:** Minimum counts and spacing rules enforced (N ≥ Baseline, spacing ≥ 40 ft); allows unlimited addition of upstream advanced-warning assets and extended cone tapers

### 3. ⚠️ Violate SOP (Field Adaptation / Last Resort)

* **Purpose:** Training for severe physical footprint restrictions (e.g., bridge abutments, short acceleration ramps, tight urban structures)
* **Enforcement:** All snapping and distance locks disabled; unlocks condensed taper gaps (<40 ft); displays high-contrast amber/red callouts outlining specific safety trade-offs

---

## DATA PIPELINE ARCHITECTURE

```
[Local .pbf File (~80 MB NoVA)]
│
▼
[Rust Engine (Tauri Backend)]
├─ osmpbf (Zero-copy parsing)
├─ R-Tree Spatial Index (rstar crate)
├─ Topology & Layer Ordering (layer, bridge, lanes tags)
└─ Two-pass node resolution → way coordinate assembly
│
▼  (Tauri IPC – JSON serialized HighwaySegment[])
[HTML5 / SVG Canvas (Frontend)]
├─ Dynamic Layer Render (Ground=0 → Flyovers=1..3)
├─ Feature Casing (Visual Overlap Masking / 2.5D effect)
├─ Interactive Asset Layer (TMAs, Arrow Boards, Cones, Vehicles)
└─ Data-Driven Rotation / Transform Controls
```

---

## 1. DATA INGESTION & PIPELINE ENGINE

### 1.1 Local Source Data

* **Format:** OpenStreetMap Protocolbuffer Binary Format (`.pbf`)
* **Source:** Regional extract (`virginia-latest.osm.pbf` via Geofabrik)
* **BBOX Crop (NoVA Corridor):**
  ```bash
  osmium extract -b -77.55,38.60,-77.00,39.00 \
    virginia-latest.osm.pbf -o assets/nova_corridor.osm.pbf
  ```
* **Filter Schema:** Retain `highway=*` (motorway, trunk, primary, secondary, ramps), `bridge=*`, `tunnel=*`, `layer=*`, `lanes=*`, `turn:lanes=*`, `oneway=*`, `ref=*`, `name=*`

### 1.2 Rust Core Processing Pipeline (`src-tauri/src/map_engine.rs`)

* **Parsing Crate:** `osmpbf 0.3`
* **Spatial Indexing:** `rstar 0.11` — load ways into R-Tree for O(log n) bounding-box queries
* **Topological Sort:**
  1. Extract `layer` tag as `i8` (default `0`). Negative values for underpasses; positive (1..4) for flyover ramps.
  2. Parse `bridge=yes` to identify structural boundaries.
  3. Sort geometries ascending by `layer` before emission to the renderer.
* **Serialization Output:** `Vec<HighwaySegment>` serialized to JSON via `serde_json` over Tauri IPC

---

## 2. RENDERING & SYMBOLOGY PARADIGM

### 2.1 Multi-Tier Layer Ordering (e.g., Springfield "Mixing Bowl")

* **Drawing Order:** Base surface / Ground (`layer=0`) → Low Flyover (`layer=1`) → Mid Flyover (`layer=2`) → Top Tier (`layer=3`)
* **Visual Occlusion (Casing Algorithm):**
  * Outer road casing — stroke width = lane width + border, color = `#1a1a1a`
  * Inner road fill — stroke width = lane width, color = `#333333` / `#404040`
  * Higher-layer features paint on top of lower-layer casings, giving 2.5D visual separation

### 2.2 Lane & Markings Extraction

* Map `lanes=*` integer to visual stroke widths (4 px per lane minimum)
* Render dashed centre-line skip lines for multi-lane carriageways
* Yellow solid left edge, white solid right fog line, white broken interior skip lines

---

## 3. FRONTEND INTERACTIVE CANVAS (`src/`)

### 3.1 Tech Stack

* **UI Shell:** HTML5 / Vanilla JS bundled with Vite inside Tauri 2 Webview
* **Graphics Engine:** SVG DOM — all highway features and assets rendered as SVG elements

### 3.2 Dynamic Asset Layer

| Asset | SVG Representation | Transformation Policy |
|-------|-------------------|----------------------|
| Traffic Cone | `<polygon>` orange triangle | Snap-to-lane, no rotation |
| Road Flare | `<circle>` red | Snap-to-lane, no rotation |
| F350 SSP Truck | `<rect>` yellow 88×32 px | 0°/90°/180°/270° steps |
| Arrow Board | `<rect>` amber + arrow glyph | 0°/90°/180°/270° steps |
| TMA | `<rect>` compound orange | 0°/90°/180°/270° steps |
| Sign Board | `<rect>` yellow | Fixed orientation |
| Incident Vehicle | `<rect>` red | 360° freeform |

### 3.3 MUTCD Taper & Buffer Calculations

```
Speed ≤ 45 mph:  L = W × S² / 60
Speed > 45 mph:  L = W × S
Buffer:          B = L × 2/3

W = lane width (ft, default 12)
S = approach speed (mph)
L = taper length (ft)
B = buffer length (ft)
```

---

## 4. TAURI & RUST CODE ARCHITECTURE

### 4.1 Dependency Manifest (`src-tauri/Cargo.toml`)

```toml
[dependencies]
tauri             = { version = "2.0", features = ["protocol-asset"] }
tauri-plugin-shell = "2.0"
serde             = { version = "1.0", features = ["derive"] }
serde_json        = "1.0"
osmpbf            = "0.3"
rstar             = "0.11"
geo-types         = "0.7"
geo               = "0.28"
thiserror         = "1.0"
log               = "0.4"
```

### 4.2 Tauri IPC Interface (`src-tauri/src/main.rs`)

```rust
#[tauri::command]
fn load_pbf_bbox(
    pbf_path: String,
    min_lon: f64, min_lat: f64,
    max_lon: f64, max_lat: f64,
) -> Result<Vec<HighwaySegment>, String>
```

Returned `Vec<HighwaySegment>` is sorted ascending by `layer` tag so the frontend renders ground-plane roads before flyovers.

### 4.3 `HighwaySegment` Schema

```rust
pub struct HighwaySegment {
    pub id:            i64,
    pub layer:         i8,
    pub lanes:         u8,
    pub is_bridge:     bool,
    pub is_tunnel:     bool,
    pub oneway:        bool,
    pub highway_class: String,
    pub name:          Option<String>,
    pub reference:     Option<String>,
    pub coordinates:   Vec<(f64, f64)>,  // (lon, lat) pairs
}
```

---

## 5. CODESPACES IMPLEMENTATION CHECKLIST

### Environment Initialisation

```bash
# Rust toolchain
curl https://sh.rustup.rs -sSf | sh -s -- -y
source $HOME/.cargo/env

# Tauri system dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Node.js LTS
nvm install --lts
npm install
```

### Data Provisioning

```bash
# Download Virginia extract (~700 MB)
wget https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf

# Clip to NoVA corridor (~80 MB)
osmium extract -b -77.55,38.60,-77.00,39.00 \
  virginia-latest.osm.pbf -o assets/nova_corridor.osm.pbf

# Verify
osmium fileinfo assets/nova_corridor.osm.pbf
```

### Execution Pipeline

```bash
# Development (hot-reload)
npm run tauri dev

# Production build
npm run tauri build

# Verify offline operation
# Toggle webview offline mode in browser DevTools → Network tab
```

---

## 6. DIRECTORY STRUCTURE

```
Magnus/
├── index.html                    # App shell (three-pane layout)
├── vite.config.js                # Vite bundler config
├── package.json                  # Node dependencies + scripts
├── src/
│   ├── main.js                   # Application logic (canvas, drag-drop, SOP audit)
│   └── style.css                 # Dark-theme stylesheet
├── src-tauri/
│   ├── Cargo.toml                # Rust crate manifest
│   ├── build.rs                  # Tauri build script
│   ├── tauri.conf.json           # Tauri app configuration
│   └── src/
│       ├── main.rs               # Tauri entry point + IPC command
│       ├── lib.rs                # Library crate root
│       └── map_engine.rs         # PBF parsing + segment model
└── assets/
    └── nova_corridor.osm.pbf     # (not committed – provision locally)
```
