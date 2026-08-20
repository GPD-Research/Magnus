# Magnus – VDOT Safety Service Patrol Scene Management Simulator

Interactive, cross-platform 2D vector simulator and training utility for highway incident scene management and Temporary Traffic Control (TTC) instruction.

## Features

- **Three-pane layout:** Communications log, interactive SVG highway canvas, and live decision analytics
- **Three operational modes:** Gospel SOP, Modified SOP, and Violate SOP with live audit feedback
- **Drag-and-drop assets:** Traffic cones, flares, F350 SSP trucks, TMAs, arrow boards, sign boards, and incident vehicles
- **MUTCD taper/buffer math:** Automatic calculation of advance warning and taper distances
- **Scenario presets:** Pre-configured scene layouts for common incident types
- **SVG export:** Lossless vector export for lesson plan creation
- **Offline map engine:** Rust backend parses local OSM `.pbf` data (no internet required)

## Quick Start

### Prerequisites

```bash
# Rust toolchain
curl https://sh.rustup.rs -sSf | sh -s -- -y
source $HOME/.cargo/env

# Tauri system dependencies (Ubuntu/Debian/Codespaces)
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Node.js dependencies
npm install
```

### Data Provisioning (optional – desktop mode only)

```bash
wget https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf
osmium extract -b -77.55,38.60,-77.00,39.00 \
  virginia-latest.osm.pbf -o assets/nova_corridor.osm.pbf
```

### Development

```bash
# Web/PWA mode (no Rust backend required)
npm run dev

# Desktop mode (requires Tauri + Rust)
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

## Architecture

See [ARCHITECTURE_SPEC.md](./ARCHITECTURE_SPEC.md) for the full technical specification including:
- Spatial coordinate matrix and asset constraint policies
- Three-pane UI layout specification
- OSM PBF data pipeline (Rust → Tauri IPC → SVG canvas)
- MUTCD taper/buffer calculation formulae
- SOP audit engine design
- Codespaces implementation checklist
