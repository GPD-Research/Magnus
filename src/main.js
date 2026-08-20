/**
 * Magnus – TTC Scene Simulator
 * Main application entry point.
 *
 * Handles:
 *  - Mode switching (Gospel / Modified / Violate SOP)
 *  - Asset drag-and-drop onto the SVG canvas
 *  - Live taper / buffer distance calculations
 *  - SOP audit flag rendering
 *  - SVG export
 *  - Tauri IPC bridge for PBF map loading (desktop only)
 */

// ─── Tauri IPC shim ──────────────────────────────────────────────────────────
// `invoke` is available when running inside Tauri; in a web/PWA context it is
// replaced with a no-op stub so the UI remains functional without the backend.
// Tauri 2 exposes `window.__TAURI_INTERNALS__` once the webview is ready.
let invoke = async (_cmd, _args) => { return []; };

const isTauri = typeof window !== 'undefined' &&
  (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined);

if (isTauri) {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  invoke = tauriInvoke;
}

// ─── Application State ────────────────────────────────────────────────────────
const state = {
  mode: 'gospel',           // 'gospel' | 'modified' | 'violate'
  assets: [],               // { id, type, x, y, rotation }
  coneCount: 0,
  taperFt: 0,
  bufferFt: 0,
  approachSpeedMph: 65,
  nextAssetId: 1,
  segments: [],             // HighwaySegments from Rust backend
};

// ─── DOM References ───────────────────────────────────────────────────────────
const svg            = document.getElementById('highway-svg');
const layerGround    = document.getElementById('layer-ground');
const layerAssets    = document.getElementById('layer-assets');
const layerMeasure   = document.getElementById('layer-measurements');
const eventLog       = document.getElementById('event-log');
const triggeredScripts = document.getElementById('triggered-scripts');
const sopFlags       = document.getElementById('sop-audit-flags');
const sopClear       = document.getElementById('sop-clear');
const activeModeDisp = document.getElementById('active-mode-display');
const modeRationale  = document.getElementById('mode-rationale');
const metricTaper    = document.getElementById('metric-taper');
const metricBuffer   = document.getElementById('metric-buffer');
const metricCones    = document.getElementById('metric-cones');
const metricSpeed    = document.getElementById('metric-speed');

// ─── Mode Configuration ───────────────────────────────────────────────────────
const MODE_CONFIG = {
  gospel: {
    label:     '🟢 Gospel SOP',
    cssClass:  'gospel',
    rationale: 'Baseline textbook MUTCD setup. Hard snapping enforced. Taper gaps locked to 40 ft intervals. Minimum cone counts enforced.',
    minTaperGapFt: 40,
    snapEnabled: true,
  },
  modified: {
    label:     '🔵 Modified SOP',
    cssClass:  'modified',
    rationale: 'Proactive field expansion for geometric hazards. Minimum counts and spacing enforced (N ≥ Baseline, spacing ≥ 40 ft). Unlimited upstream additions permitted.',
    minTaperGapFt: 40,
    snapEnabled: true,
  },
  violate: {
    label:     '⚠️ Violate SOP',
    cssClass:  'violate',
    rationale: 'Training for severe physical footprint restrictions. All snapping and distance locks disabled. High-contrast warnings shown for each trade-off.',
    minTaperGapFt: 0,
    snapEnabled: false,
  },
};

// ─── Asset Definition Registry ────────────────────────────────────────────────
const ASSET_DEFS = {
  cone: {
    label: 'Traffic Cone',
    render: (id, x, y) => makeSvgElement('polygon', {
      id,
      points: `${x},${y - 18} ${x - 8},${y + 6} ${x + 8},${y + 6}`,
      fill: '#ff6600',
      stroke: '#fff',
      'stroke-width': '1',
      class: 'asset-cone',
    }),
  },
  flare: {
    label: 'Road Flare',
    render: (id, x, y) => makeSvgElement('circle', {
      id,
      cx: x, cy: y, r: 8,
      fill: '#ff2200',
      stroke: '#ffaaaa',
      'stroke-width': '2',
      class: 'asset-flare',
    }),
  },
  f350: {
    label: 'F350 SSP Truck',
    // 22 ft × 8 ft at ~4 px/ft scale → 88 × 32 px
    render: (id, x, y) => {
      const g = makeSvgElement('g', { id, class: 'asset-f350', transform: `translate(${x - 44},${y - 16})` });
      g.appendChild(makeSvgElement('rect', { x: 0, y: 0, width: 88, height: 32, fill: '#ffdd00', stroke: '#1a1a1a', 'stroke-width': '2', rx: 4 }));
      g.appendChild(makeSvgElement('text', { x: 44, y: 20, 'text-anchor': 'middle', fill: '#000', 'font-size': '10', 'font-weight': 'bold' })).textContent = 'SSP';
      return g;
    },
  },
  arrow_board: {
    label: 'Arrow Board',
    render: (id, x, y) => {
      const g = makeSvgElement('g', { id, class: 'asset-arrow-board', transform: `translate(${x - 30},${y - 20})` });
      g.appendChild(makeSvgElement('rect', { x: 0, y: 0, width: 60, height: 40, fill: '#ffaa00', stroke: '#888', 'stroke-width': '1', rx: 2 }));
      g.appendChild(makeSvgElement('text', { x: 30, y: 25, 'text-anchor': 'middle', fill: '#000', 'font-size': '18', 'font-weight': 'bold' })).textContent = '➡';
      return g;
    },
  },
  tma: {
    label: 'Truck-Mounted Attenuator',
    render: (id, x, y) => {
      const g = makeSvgElement('g', { id, class: 'asset-tma', transform: `translate(${x - 50},${y - 18})` });
      g.appendChild(makeSvgElement('rect', { x: 0, y: 0, width: 100, height: 36, fill: '#cc8800', stroke: '#1a1a1a', 'stroke-width': '2', rx: 4 }));
      g.appendChild(makeSvgElement('rect', { x: 100, y: 8, width: 24, height: 20, fill: '#ffaa00', stroke: '#888', 'stroke-width': '1' }));
      g.appendChild(makeSvgElement('text', { x: 50, y: 23, 'text-anchor': 'middle', fill: '#fff', 'font-size': '9', 'font-weight': 'bold' })).textContent = 'TMA';
      return g;
    },
  },
  sign_board: {
    label: 'Portable Sign Board',
    render: (id, x, y) => {
      const g = makeSvgElement('g', { id, class: 'asset-sign', transform: `translate(${x - 20},${y - 24})` });
      g.appendChild(makeSvgElement('rect', { x: 0, y: 0, width: 40, height: 32, fill: '#ffdd00', stroke: '#000', 'stroke-width': '2' }));
      g.appendChild(makeSvgElement('text', { x: 20, y: 20, 'text-anchor': 'middle', fill: '#000', 'font-size': '9', 'font-weight': 'bold' })).textContent = 'SLOW';
      return g;
    },
  },
  incident: {
    label: 'Incident / Disabled Vehicle',
    render: (id, x, y) => {
      const g = makeSvgElement('g', { id, class: 'asset-incident', transform: `translate(${x - 20},${y - 10})` });
      g.appendChild(makeSvgElement('rect', { x: 0, y: 0, width: 40, height: 20, fill: '#cc0000', stroke: '#ff6666', 'stroke-width': '2', rx: 3 }));
      g.appendChild(makeSvgElement('text', { x: 20, y: 14, 'text-anchor': 'middle', fill: '#fff', 'font-size': '9' })).textContent = '⚠ INCDT';
      return g;
    },
  },
};

// ─── SVG Helpers ──────────────────────────────────────────────────────────────
function makeSvgElement(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ─── Highway Canvas Rendering ─────────────────────────────────────────────────

/**
 * Draw a static highway base on the SVG (used as fallback / demo when no PBF data).
 * Pavement width: 3 lanes × ~36 px each = 108 px, centred in 1200 px viewBox.
 * Coordinates are in SVG-space (px), not real-world feet.
 */
function drawBaseHighway() {
  const svgW  = 1200;
  const roadW = 360;
  const roadX = (svgW - roadW) / 2;

  // Road casing (dark border)
  layerGround.appendChild(makeSvgElement('rect', {
    x: roadX - 8, y: 0,
    width: roadW + 16, height: 2400,
    fill: '#1a1a1a',
  }));

  // Asphalt fill
  layerGround.appendChild(makeSvgElement('rect', {
    x: roadX, y: 0,
    width: roadW, height: 2400,
    fill: '#333333',
  }));

  // Left solid yellow line
  layerGround.appendChild(makeSvgElement('line', {
    x1: roadX, y1: 0, x2: roadX, y2: 2400,
    stroke: '#ffdd00', 'stroke-width': '4',
  }));

  // Right solid white fog line
  layerGround.appendChild(makeSvgElement('line', {
    x1: roadX + roadW, y1: 0, x2: roadX + roadW, y2: 2400,
    stroke: '#ffffff', 'stroke-width': '4',
  }));

  // Center broken white skip lines (lane dividers)
  const laneW = roadW / 3;
  for (let lane = 1; lane < 3; lane++) {
    const lx = roadX + lane * laneW;
    for (let y = 0; y < 2400; y += 80) {
      layerGround.appendChild(makeSvgElement('line', {
        x1: lx, y1: y, x2: lx, y2: y + 40,
        stroke: '#ffffff', 'stroke-width': '2',
        'stroke-dasharray': 'none',
      }));
    }
  }

  // Direction of travel arrow (periodic)
  for (let y = 200; y < 2400; y += 400) {
    const arrow = makeSvgElement('text', {
      x: roadX + roadW / 2, y,
      'text-anchor': 'middle',
      fill: '#ffffff',
      'font-size': '28',
      opacity: '0.25',
    });
    arrow.textContent = '▼';
    layerGround.appendChild(arrow);
  }
}

/**
 * Render highway segments received from the Rust backend.
 * Segments are already sorted by layer (ground → top flyover).
 */
function renderSegments(segments) {
  const layerGroups = {
    '-2': document.getElementById('layer-ground'),
    '-1': document.getElementById('layer-ground'),
    '0':  document.getElementById('layer-ground'),
    '1':  document.getElementById('layer-flyover-1'),
    '2':  document.getElementById('layer-flyover-2'),
    '3':  document.getElementById('layer-flyover-3'),
  };

  for (const seg of segments) {
    if (seg.coordinates.length < 2) continue;

    const layerKey = String(Math.min(Math.max(seg.layer, -2), 3));
    const targetLayer = layerGroups[layerKey] ?? layerGroups['0'];

    // Map lon/lat to SVG coordinates (simple linear projection within bbox).
    const pts = seg.coordinates.map(([lon, lat]) => {
      const px = Math.round(((lon - (-77.55)) / 0.55) * 1200);
      const py = Math.round(((39.0 - lat)  / 0.40) * 2400);
      return `${px},${py}`;
    }).join(' ');

    const strokeW = Math.max(4, seg.lanes * 12);
    const strokeColor = seg.is_bridge ? '#5a5a7a' : '#404040';

    // Casing (outer border)
    targetLayer.appendChild(makeSvgElement('polyline', {
      points: pts,
      fill: 'none',
      stroke: '#1a1a1a',
      'stroke-width': strokeW + 6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }));

    // Road fill
    targetLayer.appendChild(makeSvgElement('polyline', {
      points: pts,
      fill: 'none',
      stroke: strokeColor,
      'stroke-width': strokeW,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }));
  }
}

// ─── Taper / Buffer Calculation ───────────────────────────────────────────────

/**
 * MUTCD taper length formula: L = W × S² / 60  (for speeds ≤ 45 mph)
 *                             L = W × S         (for speeds > 45 mph)
 * W = lane width (ft), S = approach speed (mph).
 */
function calcTaperFt(speedMph, laneWidthFt = 12) {
  if (speedMph <= 45) {
    return Math.round(laneWidthFt * speedMph * speedMph / 60);
  }
  return Math.round(laneWidthFt * speedMph);
}

/** Buffer length = 2/3 × taper length (MUTCD guideline). */
function calcBufferFt(taperFt) {
  return Math.round(taperFt * (2 / 3));
}

function updateMetrics() {
  state.taperFt  = calcTaperFt(state.approachSpeedMph);
  state.bufferFt = calcBufferFt(state.taperFt);

  metricTaper.textContent = `${state.taperFt} ft`;
  metricBuffer.textContent = `${state.bufferFt} ft`;
  metricCones.textContent  = `${state.coneCount} placed`;
  metricSpeed.textContent  = `${state.approachSpeedMph} mph`;
}

// ─── SOP Audit Engine ─────────────────────────────────────────────────────────
function runSopAudit() {
  const violations = [];
  const cfg = MODE_CONFIG[state.mode];
  const mutcdMinTaper = calcTaperFt(state.approachSpeedMph);

  if (state.mode !== 'violate') {
    // Estimate actual taper span from cone positions along Y axis.
    const conePositions = state.assets
      .filter(a => a.type === 'cone')
      .map(a => a.y)
      .sort((a, b) => a - b);

    const placedTaperFt = conePositions.length >= 2
      ? Math.round((conePositions[conePositions.length - 1] - conePositions[0]) / 4)
      : 0;

    if (conePositions.length >= 2 && placedTaperFt < mutcdMinTaper) {
      violations.push(`Taper span ${placedTaperFt} ft is below MUTCD minimum ${mutcdMinTaper} ft.`);
    }

    if (state.coneCount === 0 && state.assets.length > 0) {
      violations.push('No cones placed – clear-zone unprotected.');
    }

    if (state.mode === 'gospel') {
      for (let i = 1; i < conePositions.length; i++) {
        const gap = conePositions[i] - conePositions[i - 1];
        if (gap > cfg.minTaperGapFt * 4) { // scaled: 40 ft × 4 px/ft ≈ 160 px
          violations.push(`Cone gap ${Math.round(gap / 4)} ft exceeds 40 ft maximum.`);
        }
      }
    }
  }

  sopFlags.innerHTML = '';
  if (violations.length === 0) {
    sopClear.style.display = 'block';
  } else {
    sopClear.style.display = 'none';
    for (const msg of violations) {
      const li = document.createElement('li');
      li.className = 'sop-flag';
      li.textContent = msg;
      sopFlags.appendChild(li);
    }
  }
}

// ─── Mode Switching ───────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  const cfg = MODE_CONFIG[mode];

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  activeModeDisp.className = `mode-display ${cfg.cssClass}`;
  activeModeDisp.textContent = cfg.label;
  modeRationale.textContent = cfg.rationale;

  logEvent(`Mode changed to ${cfg.label}`);
  runSopAudit();
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

// ─── Event Logging ────────────────────────────────────────────────────────────
function logEvent(message) {
  const li = document.createElement('li');
  const now = new Date();
  li.dataset.time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
  li.textContent = message;
  eventLog.prepend(li);
}

function triggerScript(scriptText) {
  const li = document.createElement('li');
  li.textContent = scriptText;
  triggeredScripts.appendChild(li);
  logEvent(`Script: ${scriptText.substring(0, 40)}…`);
}

// ─── Asset Drag-and-Drop ──────────────────────────────────────────────────────
let draggingAssetType = null;

document.querySelectorAll('.asset-item').forEach(btn => {
  btn.addEventListener('dragstart', e => {
    draggingAssetType = btn.dataset.asset;
    e.dataTransfer.effectAllowed = 'copy';
  });
});

const canvasContainer = document.getElementById('canvas-container');

canvasContainer.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

canvasContainer.addEventListener('drop', e => {
  e.preventDefault();
  if (!draggingAssetType) return;

  const rect = svg.getBoundingClientRect();
  const svgW = svg.viewBox.baseVal.width;
  const svgH = svg.viewBox.baseVal.height;
  const scaleX = svgW / rect.width;
  const scaleY = svgH / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top)  * scaleY);

  placeAsset(draggingAssetType, x, y);
  draggingAssetType = null;
});

function placeAsset(type, x, y) {
  const cfg = MODE_CONFIG[state.mode];

  // Gospel/Modified: snap X to nearest lane centre.
  let snappedX = x;
  if (cfg.snapEnabled && (type === 'cone' || type === 'flare')) {
    const roadX = (1200 - 360) / 2;
    const laneW = 360 / 3;
    const relX = x - roadX;
    const laneIdx = Math.round(relX / laneW - 0.5);
    snappedX = roadX + laneIdx * laneW + laneW / 2;
  }

  const id = `asset-${state.nextAssetId++}`;
  const def = ASSET_DEFS[type];
  if (!def) return;

  const el = def.render(id, snappedX, y);
  makeDraggable(el, id, type, snappedX, y);
  layerAssets.appendChild(el);

  state.assets.push({ id, type, x: snappedX, y, rotation: 0 });
  if (type === 'cone') state.coneCount++;

  updateMetrics();
  runSopAudit();
  logEvent(`Placed ${def.label} at (${snappedX}, ${y})`);

  // Trigger comms script for certain asset types.
  if (type === 'f350') {
    triggerScript('DISPATCH SSP: Unit deployed upstream. Notify TOC – secondary unit on scene.');
  }
  if (type === 'tma') {
    triggerScript('DISPATCH TMA: Attenuator in position. Advise Field Supervisor of blocking configuration.');
  }
  if (type === 'incident') {
    triggerScript('911 ESCALATION: Incident confirmed on canvas. Initiate incident management protocol.');
  }
}

// ─── Asset Drag (on-canvas move) ─────────────────────────────────────────────
function makeDraggable(el, id, type, startX, startY) {
  let dragging = false;
  let startPt  = { x: 0, y: 0 };
  let origPos  = { x: startX, y: startY };

  el.style.cursor = 'grab';

  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    dragging = true;
    startPt = svgPoint(e.clientX, e.clientY);
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const pt = svgPoint(e.clientX, e.clientY);
    const dx = pt.x - startPt.x;
    const dy = pt.y - startPt.y;
    const nx = origPos.x + dx;
    const ny = origPos.y + dy;
    moveAssetElement(el, type, nx, ny);
  });

  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    const pt = svgPoint(e.clientX, e.clientY);
    const dx = pt.x - startPt.x;
    const dy = pt.y - startPt.y;
    origPos = { x: origPos.x + dx, y: origPos.y + dy };

    const asset = state.assets.find(a => a.id === id);
    if (asset) { asset.x = origPos.x; asset.y = origPos.y; }

    runSopAudit();
  });
}

function svgPoint(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (svg.viewBox.baseVal.width  / rect.width),
    y: (clientY - rect.top)  * (svg.viewBox.baseVal.height / rect.height),
  };
}

function moveAssetElement(el, type, x, y) {
  switch (type) {
    case 'cone':
      el.setAttribute('points', `${x},${y - 18} ${x - 8},${y + 6} ${x + 8},${y + 6}`);
      break;
    case 'flare':
      el.setAttribute('cx', x);
      el.setAttribute('cy', y);
      break;
    case 'f350':
      el.setAttribute('transform', `translate(${x - 44},${y - 16})`);
      break;
    case 'arrow_board':
      el.setAttribute('transform', `translate(${x - 30},${y - 20})`);
      break;
    case 'tma':
      el.setAttribute('transform', `translate(${x - 50},${y - 18})`);
      break;
    case 'sign_board':
      el.setAttribute('transform', `translate(${x - 20},${y - 24})`);
      break;
    case 'incident':
      el.setAttribute('transform', `translate(${x - 20},${y - 10})`);
      break;
  }
}

// ─── SVG Export ───────────────────────────────────────────────────────────────
document.getElementById('btn-export-svg').addEventListener('click', exportSvg);

async function exportSvg() {
  const svgEl  = document.getElementById('highway-svg');
  const serial = new XMLSerializer();
  const svgStr = serial.serializeToString(svgEl);
  const blob   = new Blob([svgStr], { type: 'image/svg+xml' });

  if (isTauri) {
    // Desktop: write to local filesystem via Tauri shell plugin.
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const filePath = await save({ filters: [{ name: 'SVG', extensions: ['svg'] }] });
    if (filePath) {
      await writeTextFile(filePath, svgStr);
      logEvent(`SVG exported to ${filePath}`);
    }
  } else {
    // Web/PWA: trigger browser download.
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `magnus-scene-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    logEvent('SVG exported (browser download)');
  }
}

// ─── Tauri PBF Map Loader ─────────────────────────────────────────────────────
async function loadMapFromBackend() {
  if (!isTauri) return;

  try {
    const segments = await invoke('load_pbf_bbox', {
      pbfPath:  'assets/nova_corridor.osm.pbf',
      minLon:   -77.55,
      minLat:   38.60,
      maxLon:   -77.00,
      maxLat:   39.00,
    });
    state.segments = segments;
    renderSegments(segments);
    logEvent(`Loaded ${segments.length} highway segments from PBF.`);
  } catch (err) {
    console.warn('PBF load failed (expected in web mode):', err);
  }
}

// ─── Asset Drawer Toggle ──────────────────────────────────────────────────────
document.querySelector('.drawer-handle').addEventListener('click', () => {
  const drawer = document.getElementById('asset-drawer');
  drawer.classList.toggle('collapsed');
});

// ─── Scenario Presets ─────────────────────────────────────────────────────────
document.getElementById('scenario-presets').addEventListener('change', e => {
  const scenario = e.target.value;
  if (!scenario) return;

  // Clear existing assets.
  layerAssets.innerHTML = '';
  layerMeasure.innerHTML = '';
  state.assets = [];
  state.coneCount = 0;

  const roadX = (1200 - 360) / 2;
  const laneW = 360 / 3;
  const mid   = roadX + laneW * 1.5; // centre lane x

  const placements = {
    shoulder_block: [
      { type: 'incident', x: roadX + 360 + 20, y: 1400 },
      { type: 'f350',     x: roadX + 360 + 20, y: 1200 },
      { type: 'cone',     x: roadX + 360 - 10, y: 1100 },
      { type: 'cone',     x: roadX + 360 - 20, y: 1050 },
      { type: 'cone',     x: roadX + 360 - 30, y: 1000 },
    ],
    lane_closure_1: [
      { type: 'tma',        x: mid + laneW, y: 1400 },
      { type: 'arrow_board',x: mid + laneW, y: 1200 },
      { type: 'cone',       x: mid + laneW, y: 1000 },
      { type: 'cone',       x: mid + laneW * 0.75, y: 960 },
      { type: 'cone',       x: mid + laneW * 0.5,  y: 920 },
      { type: 'cone',       x: mid + laneW * 0.25, y: 880 },
      { type: 'sign_board', x: mid, y: 700 },
    ],
  };

  const pl = placements[scenario];
  if (pl) {
    for (const { type, x, y } of pl) placeAsset(type, x, y);
  }

  logEvent(`Scenario loaded: ${scenario}`);
  e.target.value = '';
});

// ─── Initialise ───────────────────────────────────────────────────────────────
drawBaseHighway();
setMode('gospel');
updateMetrics();
loadMapFromBackend();
logEvent('Magnus TTC Simulator initialized.');
