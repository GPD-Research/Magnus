# COMPREHENSIVE SPECIFICATION: VDOT SAFETY SERVICE PATROL (SSP) VISUAL SOP SIMULATOR & SCENE BUILDER

## 1. PROJECT OVERVIEW & PRIMARY PURPOSE
* [cite_start]**Target Application:** An interactive, desktop, tablet, and touch-screen visual scene builder, training simulator, and protocol tool[cite: 1242, 1273, 1274].
* [cite_start]**Primary User & Deployment:** Designed for instructors to build, demonstrate, test, and evaluate top-down scene setups for Virginia Department of Transportation (VDOT) Safety Service Patrol (SSP) operations[cite: 1240, 1241, 1242]. [cite_start]Optimized for large-screen projections, touchscreen laptops, standalone Linux executables (`.AppImage`), and mobile field tablets[cite: 1240, 1242, 1545].
* [cite_start]**Core Paradigm:** Bypasses raster image manipulation and satellite photographic cleanup by leveraging offline spatial vector datasets (OpenStreetMap `.pbf`) combined with programmatic topological rendering and strict VDOT Standard Operating Procedures (SOPs)[cite: 2961, 2968, 2988].

---

## 2. HIGHWAY GEOMETRY & MAP IMPORT PARADIGM

### 2.1 Vector Map Data Foundation
* [cite_start]**Data Source:** OpenStreetMap (OSM) vector data stored locally as a Protocolbuffer Binary Format (`.pbf`) file[cite: 351, 376, 503].
* [cite_start]**Regional Dataset Size:** Full state of Virginia is ~426 MB[cite: 400, 481]. [cite_start]Cropped Northern Virginia (NoVA) highway extract (covering I-95, I-395, and I-495) is ~80 MB[cite: 401, 492].
* [cite_start]**Filtered Asset Size:** Isolating `highway=*` features drops the storage footprint down to ~15 MB[cite: 404, 406].
* [cite_start]**Offline Execution:** 100% offline-first execution with local spatial querying (via `rstar` R-Tree indexing) and optional differential patching (`.osc` change files)[cite: 333, 351, 376, 762, 767].

### 2.2 Unidirectional Flow & 2.5D Multi-Tier Interchange Rendering
* [cite_start]**Strict Unidirectional Constraint:** Canvas forces directional vector filtering to render only a single direction of travel (one side of a divided highway)[cite: 426, 808]. [cite_start]Left boundary = solid yellow fog line; right boundary = solid white fog line; internal lanes = broken/dashed white skip lines[cite: 426, 808, 1294]. [cite_start]All traffic flow vectors move strictly upstream $\rightarrow$ downstream[cite: 808, 1259].
* **Multi-Level Topology (e.g., Springfield Interchange / "Mixing Bowl"):**
  * [cite_start]Reads OSM structural tags: `bridge=yes`, `tunnel=yes`, and `layer=*` (-1 for underpasses, 0 for surface mainlines, 1–4 for flyover ramps)[cite: 2991, 2992, 2993, 2994, 2995, 2996].
  * [cite_start]**Layer Rendering & Casing (Visual Occlusion):** Polylines render sorted ascending by `layer` attribute[cite: 208, 642]. [cite_start]Outer road casings mask lower-layer paths natively, providing 2.5D visual elevation separation without requiring full 3D rendering engines[cite: 215, 566].

---

## 3. VDOT SAFETY SERVICE PATROL (SSP) OPERATIONAL SOPS

### 3.1 Primary SSP Vehicle Profile (Ford F-350)
* [cite_start]**Platform:** Ford F-350 pickup chassis with a white full-length utility cab covering the bed for secure, weatherproof asset storage[cite: 1274, 1279].
* [cite_start]**Lighting Array:** 360° all-yellow emergency strobe array (roof bar, four corner lights, side modules, high-intensity rear cluster)[cite: 1276, 1277, 1282, 1283, 1284].
* **Roof-Mounted Foldable Message Sign Board:**
  * [cite_start]**Shoulder Mode:** Displays alternating left/right oscillating "Dancing Diamonds" / "Double Diamond" pattern[cite: 1264, 1275, 1280].
  * [cite_start]**Lane Closure Mode:** Displays Directional Arrow (Left or Right) to divert approaching traffic[cite: 1275, 1281, 1291].
* [cite_start]**Universal Deployment SOP:** On arrival at any scene, 360° yellow strobes activate immediately, and the sign board is raised with the appropriate pattern prior to setup[cite: 1278, 1285, 1286, 1287].

### 3.2 SOP 1: Standard Shoulder Closure
* [cite_start]**Traffic Vector:** Upstream $\rightarrow$ Downstream[cite: 1259, 1265].
* [cite_start]**SSP Positioning:** Primary rearmost vehicle positioned upstream of the incident on the shoulder[cite: 1263, 1265]. [cite_start]Sign board set to "Dancing Diamonds"[cite: 1264, 1278, 1287].
* **Upstream Cone Taper (Rear of Vehicle):**
  * [cite_start]*Cone 1 (Initial Anchor):* Placed 10 ft directly behind the rear bumper on the fog line[cite: 1260, 1267].
  * [cite_start]*Cones 2–4 (Taper):* 3 additional cones spaced strictly 40 ft apart, tapering diagonally away from the fog line out to the hard barrier (jersey wall or guardrail)[cite: 1261, 1268].
* **Downstream Scene Enclosure (Front of Vehicle):**
  * [cite_start]*Lead Safety Cone:* Placed 10 ft off the front bumper on the fog line[cite: 1262, 1269].
  * [cite_start]*Perimeter Cones:* Variable count extending downstream along the fog line to fully enclose all involved units, hazards, and personnel[cite: 1263, 1270].

### 3.3 SOP 2: Single Right Lane Closure
* [cite_start]**SSP Positioning:** Primary rearmost vehicle parked stationary in the right travel lane upstream of the incident[cite: 1290, 1291]. [cite_start]Sign board displaying Left Directional Arrow[cite: 1291].
* **Upstream Cone Setup (Strict Spacing Rules):**
  * [cite_start]*Anchor Cone:* Placed 10 ft directly behind the rear-left corner on the skip line[cite: 1293, 1295].
  * [cite_start]*Linear Buffer Zone:* 2 cones placed 40 ft apart in a straight line along the skip line (80 ft buffer zone)[cite: 1296].
  * [cite_start]*Merge Taper:* 5 cones placed 40 ft apart tapering diagonally from the skip line back to the right shoulder fog line (200 ft taper)[cite: 1297].
  * [cite_start]*Shoulder Clear Zone:* Right shoulder remains **100% clear of cones** to maintain emergency vehicle access[cite: 1298].
* **Downstream Scene Enclosure (Flexible Spacing):**
  * *Lead Safety Cone:* Placed 10 ft off the front-left bumper on the skip line.
  * *Downstream Perimeter:* Cones placed along skip line/lane edge. [cite_start]Spacing options: **Standard = 40 ft**, **Optimal Compromise = 60 ft**, **Maximum Stretch = 80 ft** (allows stretching cone inventory)[cite: 373, 374].
* **Advanced Warning SSP Vehicle (Secondary Unit - Optional):**
  * [cite_start]Parked on the right shoulder at the mouth of the taper[cite: 1299].
  * [cite_start]Blocks shoulder bypass attempts by public drivers and provides early warning on blind curves or crests[cite: 1299, 1300].
  * [cite_start]*Mandatory Yield Protocol:* Must yield position and temporarily move off the shoulder to let incoming primary responders (Police, Fire, EMS) pass through, then reposition[cite: 1298, 1299, 1300].

---

## 4. APPLICATION INTERFACE, COMMUNICATIONS & THREE-MODE DECISION MODEL

### 4.1 Interface Layout & Navigation
* [cite_start]**Pane 1: Scenario & Map Configuration (Left Panel):** Route selection, lane counts, corridor speed settings, and map layer controls[cite: 1243].
* [cite_start]**Pane 2: Interactive SVG Vector Canvas (Center):** Unidirectional roadway grid with multi-axis asset drag-and-drop, line snapping, and rotational handles ($0^\circ–360^\circ$) for fending-off angles ($15^\circ–45^\circ$)[cite: 808, 931, 1244].
* [cite_start]**Pane 3: Mode Selector, Communications & Audit Panel (Right Panel):** Active mode selector, real-time metrics (taper lengths, cone inventory), radio/phone log templates, and real-time SOP compliance audit[cite: 805, 809, 1084].

### 4.2 Integrated Scene Communications & Radio Logging Module
* [cite_start]**Structured Handover & Dispatch Logs:** Pre-formatted radio log templates for scene arrival, lane block confirmations, resource requests, scene modifications, and scene departure[cite: 1084, 1236].
* [cite_start]**Channel Target Mapping:** Logs designated dispatch channels (TOC/TMC, VSP, Local Fire/EMS) attached directly to timestamped scenario debrief exports[cite: 1232, 1234, 1236].

### 4.3 Three-Mode Decision Model (Operational Rules)
* **1. 🟢 Gospel SOP (Strict Compliance Mode):**
  * [cite_start]*Purpose:* Textbook MUTCD / VDOT setup instruction[cite: 885].
  * [cite_start]*Enforcement:* Hard snapping locked; upstream taper gaps forced strictly to 40 ft intervals; clear-zone rules strictly enforced[cite: 885].
* **2. 🔵 Modified SOP (Expanded Protection Mode):**
  * [cite_start]*Purpose:* Proactive field expansion for hazardous road geometry (blind curves, crests, high speeds)[cite: 887].
  * [cite_start]*Enforcement:* Minimum counts and baseline spacing enforced ($N \ge \text{Baseline}$, spacing $\ge 40\text{ ft}$); permits adding extra upstream advance warning units and extended tapers[cite: 888].
* **3. ⚠️ Violate SOP (Field Adaptation / Last Resort):**
  * [cite_start]*Purpose:* Training for severe physical footprint restrictions (e.g., bridge abutments, short acceleration ramps, tight urban structures)[cite: 890].
  * [cite_start]*Enforcement:* All snapping and distance locks disabled; permits condensed taper gaps (<40 ft); displays high-contrast amber/red UI warnings with real-time risk audit callouts outlining specific safety trade-offs[cite: 890].

---

## 5. TECHNICAL ARCHITECTURE & DEVELOPMENT MANIFESTO

### 5.1 Technology Stack
* [cite_start]**Desktop & Mobile Shell:** Tauri v2[cite: 701, 820].
* [cite_start]**Backend Systems Engine:** Rust (`osmpbf`, `rstar`, `geo-types`, `serde`) for zero-copy `.pbf` parsing, spatial indexing, and topological layer sorting[cite: 463, 703].
* [cite_start]**Frontend Webview Canvas:** HTML5 / WebGL / SVG Canvas (e.g., Svelte/React with Konva.js or custom Canvas renderer)[cite: 462, 467].

### 5.2 Rust Backend Dependencies (`Cargo.toml`)
```toml
[dependencies]
tauri = { version = "2.0", features = ["protocol-asset"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
osmpbf = "0.3"
rstar = "0.11"
geo-types = "0.7"
geo = "0.28"