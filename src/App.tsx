import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Layers3,
  MapPinned,
  Maximize2,
  Minus,
  Navigation,
  PencilRuler,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  TrafficCone,
  Truck,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import './App.css'
import { RoadwayLayer } from './components/RoadwayLayer'
import { SceneDesigner } from './components/SceneDesigner'
import { createDevelopmentRoadScene } from './domain/roadScene'
import {
  MAX_SCENE_ZOOM,
  MIN_SCENE_ZOOM,
  SCENE_ZOOM_STEP,
  centeredSceneViewBox,
  clampSceneZoom,
  clientToScenePoint,
} from './domain/sceneCamera'
import type { SceneTemplateDocument } from './domain/sceneTemplate'
import {
  RIGHT_LANE_STANDARD,
  auditScene,
  createScene,
  setDownstreamSpacing,
  setRightLaneTaperCount,
  type ComplianceMode,
  type ScenarioType,
  type ScenePoint,
} from './domain/sop'

const modes: { id: ComplianceMode; label: string; detail: string }[] = [
  { id: 'gospel', label: 'Standard SOP', detail: '5-cone taper' },
  { id: 'modified', label: 'Enhanced Safety', detail: 'Expanded' },
  { id: 'violate', label: 'SOP Violation', detail: 'Training' },
]

const scenarios: { id: ScenarioType; label: string }[] = [
  { id: 'shoulder', label: 'Shoulder closure' },
  { id: 'right-lane', label: 'Right lane closure' },
]

const roadScene = createDevelopmentRoadScene()

function App() {
  const [scenario, setScenario] = useState<ScenarioType>('right-lane')
  const [mode, setMode] = useState<ComplianceMode>('gospel')
  const [laneCount, setLaneCount] = useState(3)
  const [points, setPoints] = useState<ScenePoint[]>(() => createScene('right-lane'))
  const [dragging, setDragging] = useState<string | null>(null)
  const [sceneZoom, setSceneZoom] = useState(1)
  const [designerOpen, setDesignerOpen] = useState(false)
  const [radioEvents, setRadioEvents] = useState([
    { time: '14:32', text: 'Unit 214 on scene, right lane blocked', channel: 'TOC' },
  ])

  const audit = auditScene(scenario, mode, points)
  const upstreamCount = points.filter((point) => point.role !== 'perimeter').length
  const taperCount = points.filter((point) => point.role === 'taper').length
  const bufferCount = points.filter(
    (point) => point.role === 'anchor' || point.role === 'buffer',
  ).length
  const orderedDownstream = points
    .filter((point) => point.role === 'perimeter')
    .sort((first, second) => second.y - first.y)
  const downstreamSpacing = orderedDownstream[1]
    ? orderedDownstream[0].y - orderedDownstream[1].y
    : RIGHT_LANE_STANDARD.coneSpacing
  const taperLength = scenario === 'right-lane' ? taperCount * 40 : 120
  const sceneViewBox = centeredSceneViewBox(roadScene.viewport, sceneZoom)
  const sceneViewBoxValue = `${sceneViewBox.x} ${sceneViewBox.y} ${sceneViewBox.width} ${sceneViewBox.height}`

  function changeScenario(nextScenario: ScenarioType) {
    setScenario(nextScenario)
    setPoints(createScene(nextScenario))
  }

  function moveCone(event: React.PointerEvent<SVGSVGElement>) {
    if (!dragging || mode === 'gospel') return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scenePoint = clientToScenePoint(
      { x: event.clientX, y: event.clientY },
      bounds,
      sceneViewBox,
    )
    const x = Math.max(22, Math.min(roadScene.viewport.width - 22, scenePoint.x))
    const y = Math.max(30, Math.min(roadScene.viewport.height - 30, scenePoint.y))
    setPoints((current) =>
      current.map((point) => (point.id === dragging ? { ...point, x, y } : point)),
    )
  }

  function addRadioEvent() {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setRadioEvents((current) => [
      ...current,
      { time: now, text: 'Scene configuration updated', channel: 'TOC' },
    ])
  }

  function removeRearCone() {
    const lastTaper = points
      .filter((point) => point.role === 'taper')
      .sort((first, second) => second.y - first.y)[0]
    if (lastTaper) setPoints((current) => current.filter((point) => point.id !== lastTaper.id))
  }

  function saveTemplate(template: SceneTemplateDocument) {
    localStorage.setItem('magnus.scene-template', JSON.stringify(template))
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setRadioEvents((current) => [
      ...current,
      { time: now, text: `Template saved: ${template.name}`, channel: 'DESIGN' },
    ])
    setDesignerOpen(false)
  }

  function changeSceneZoom(change: number) {
    setSceneZoom((current) => clampSceneZoom(current + change))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><span>M</span></div>
        <div className="brand-copy"><strong>MAGNUS</strong><span>SSP Scene Builder</span></div>
        <div className="session-status"><span className="live-dot" />Training session <b>24-081</b></div>
        <button className="icon-button" type="button" title="Reset scene" onClick={() => setPoints(createScene(scenario))}><RotateCcw size={18} /></button>
        <button className="primary-button" type="button"><Check size={17} /> Save scenario</button>
      </header>

      <section className="workspace">
        <aside className="panel config-panel" aria-label="Scenario configuration">
          <div className="panel-heading"><span>01</span><div><p>Configuration</p><h2>Build the scene</h2></div></div>
          <div className="template-designer-launch">
            <button type="button" onClick={() => setDesignerOpen(true)}><PencilRuler size={16} /><span><b>Scene design tool</b><small>Author vector SOP templates</small></span></button>
          </div>
          <div className="control-group">
            <label htmlFor="corridor">Corridor</label>
            <div className="select-wrap"><MapPinned size={17} /><select id="corridor" defaultValue="I-95 Northbound"><option>I-95 Northbound</option><option>I-395 Northbound</option><option>I-495 Inner Loop</option></select><ChevronDown size={15} /></div>
            <p className="location-note">MM 169.2 · Fairfax County, VA</p>
          </div>
          <div className="control-group">
            <label>Closure type</label>
            <div className="scenario-options">
              {scenarios.map((item) => (
                <button className={scenario === item.id ? 'scenario-card active' : 'scenario-card'} key={item.id} type="button" onClick={() => changeScenario(item.id)}>
                  {item.id === 'shoulder' ? <Navigation size={18} /> : <TrafficCone size={18} />}<span>{item.label}</span><i>{scenario === item.id && <Check size={13} />}</i>
                </button>
              ))}
            </div>
          </div>
          {scenario === 'right-lane' && mode === 'modified' && (
            <div className="control-group mode-controls enhanced-controls">
              <label>Enhanced safety setup</label>
              <div className="mode-control-row">
                <span>Taper cones</span>
                <div className="stepper compact-stepper">
                  <button type="button" title="Remove taper cone" onClick={() => setPoints((current) => setRightLaneTaperCount(current, Math.max(5, taperCount - 1)))}><Minus size={14} /></button>
                  <strong>{taperCount}</strong>
                  <button type="button" title="Add taper cone" onClick={() => setPoints((current) => setRightLaneTaperCount(current, Math.min(8, taperCount + 1)))}><Plus size={14} /></button>
                </div>
              </div>
              <label className="mode-control-row" htmlFor="downstream-spacing">
                <span>Forward spacing</span>
                <select id="downstream-spacing" value={downstreamSpacing} onChange={(event) => setPoints((current) => setDownstreamSpacing(current, Number(event.target.value)))}><option value="40">40 ft</option><option value="60">60 ft</option><option value="80">80 ft</option></select>
              </label>
            </div>
          )}
          {scenario === 'right-lane' && mode === 'violate' && (
            <div className="control-group mode-controls violation-controls">
              <label>Violation training setup</label>
              <p>Drag rear cones closer than 40 ft or reduce rear protection below 8 cones.</p>
              <div className="violation-actions">
                <button type="button" onClick={removeRearCone}><Minus size={14} /> Remove rear cone</button>
                <button type="button" onClick={() => setPoints(createScene('right-lane'))}><RotateCcw size={14} /> Restore SOP</button>
              </div>
            </div>
          )}
          <div className="control-row">
            <div className="control-group compact"><label>Travel lanes</label><div className="stepper"><button type="button" title="Remove lane" onClick={() => setLaneCount((count) => Math.max(2, count - 1))}><Minus size={15} /></button><strong>{laneCount}</strong><button type="button" title="Add lane" onClick={() => setLaneCount((count) => Math.min(5, count + 1))}><Plus size={15} /></button></div></div>
            <div className="control-group compact"><label htmlFor="speed">Speed limit</label><div className="unit-input"><input id="speed" type="number" defaultValue="65" /><span>MPH</span></div></div>
          </div>
          <div className="control-group map-layers">
            <label>Map layers</label>
            <label className="toggle-row"><span><Layers3 size={16} /> Road geometry</span><input type="checkbox" defaultChecked /></label>
            <label className="toggle-row"><span><span className="barrier-symbol" /> Barriers</span><input type="checkbox" defaultChecked /></label>
            <label className="toggle-row"><span><span className="flow-symbol">→</span> Traffic flow</span><input type="checkbox" defaultChecked /></label>
          </div>
          <div className="asset-inventory"><div><span>Available assets</span><b>{points.length + 3}</b></div><div className="asset-icons"><span><Truck size={19} /> 1</span><span><TrafficCone size={19} /> {points.length}</span><span><Radio size={18} /> 2</span></div></div>
        </aside>

        <section className="canvas-panel" aria-label="Interactive scene canvas">
          <div className="canvas-toolbar">
            <div><span className="eyebrow">Vector scene · {roadScene.source.type.replaceAll('-', ' ')}</span><h1>{scenario === 'right-lane' ? 'Single right lane closure' : 'Standard shoulder closure'}</h1></div>
            <div className="canvas-tools">
              <div className="zoom-controls" role="group" aria-label="Highway graphic zoom">
                <button type="button" title="Zoom out" aria-label="Zoom out highway graphic" disabled={sceneZoom <= MIN_SCENE_ZOOM} onClick={() => changeSceneZoom(-SCENE_ZOOM_STEP)}><ZoomOut size={15} /></button>
                <button className="zoom-value" type="button" title="Reset zoom" aria-label={`Reset highway graphic zoom, currently ${Math.round(sceneZoom * 100)} percent`} onClick={() => setSceneZoom(1)}>{Math.round(sceneZoom * 100)}%</button>
                <button type="button" title="Zoom in" aria-label="Zoom in highway graphic" disabled={sceneZoom >= MAX_SCENE_ZOOM} onClick={() => changeSceneZoom(SCENE_ZOOM_STEP)}><ZoomIn size={15} /></button>
                <button type="button" title="Fit highway graphic" aria-label="Fit highway graphic" onClick={() => setSceneZoom(1)}><Maximize2 size={14} /></button>
              </div>
              <div className="scale-key"><span /> 40 FT</div>
            </div>
          </div>
          <div className="road-stage" onWheel={(event) => { event.preventDefault(); changeSceneZoom(event.deltaY < 0 ? SCENE_ZOOM_STEP : -SCENE_ZOOM_STEP) }}>
            <svg className="road-canvas" viewBox={sceneViewBoxValue} style={{ aspectRatio: `${roadScene.viewport.width} / ${roadScene.viewport.height}` }} role="img" aria-label="Top-down highway scene with SSP vehicle and traffic cones" data-zoom={sceneZoom} onPointerMove={moveCone} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
              <RoadwayLayer scene={roadScene} />
              <g className="ssp-truck" transform={`translate(${scenario === 'right-lane' ? RIGHT_LANE_STANDARD.truck.x : 435} ${RIGHT_LANE_STANDARD.truck.y})`}>
                <rect className="truck-body" x="-22" y="-34" width="44" height="68" />
                <path className="truck-panel-line" d="M -22 -2 H 22 M -22 -22 H 22 M -16 -22 V -2 M 16 -22 V -2" />
                <path className="truck-windshield" d="M -17 -8 H 17 L 14 -26 H -14 Z" />
                <path className="truck-hood-line" d="M -16 -29 H 16 M -12 -34 V -29 M 12 -34 V -29" />
                <rect className="truck-lightbar" x="-24" y="-2" width="48" height="5" />
                <rect className="strobe" x="-22" y="-31" width="3" height="3" />
                <rect className="strobe delayed" x="19" y="-31" width="3" height="3" />
                <rect className="signboard" x="-20" y="26" width="40" height="7" />
                <path className="signboard-symbol" d={scenario === 'right-lane' ? 'M 11 29.5 H -10 M -10 29.5 L -4 26 M -10 29.5 L -4 33' : 'M -14 27 L -8 32 L -2 27 M 3 27 L 9 32 L 15 27'} />
              </g>
              {points.map((point, index) => (
                <g className={`cone ${mode === 'gospel' ? 'locked' : ''}`} key={point.id} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => { if (mode === 'gospel') return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(point.id) }}>
                  <rect className="cone-hit-area" x="-12" y="-12" width="24" height="24" />
                  <path className="cone-body" d="M -4 5 L -2 -7 H 2 L 4 5 Z" />
                  <path className="cone-band" d="M -3 -1 H 3" />
                  <path className="cone-base" d="M -6 6 H 6" />
                  {point.role === 'anchor' && <g className="cone-label"><rect x="9" y="-9" width="43" height="14" /><text x="14" y="1">ANCHOR</text></g>}
                  {index === 1 && <g className="distance-label"><path d="M -18 18 V 54 M 18 18 V 54 M -18 47 H 18" /><text x="-13" y="43">40 FT</text></g>}
                </g>
              ))}
              <g className="north-arrow" transform="translate(55 695)"><path d="M 0 30 V 0 M 0 0 l -7 11 M 0 0 l 7 11" /><text x="-6" y="45">N</text></g>
            </svg>
            <div className="canvas-hint">{mode === 'gospel' ? <><ShieldCheck size={15} /> Positions locked to Standard SOP</> : <><Navigation size={15} /> Drag cones to adapt the scene</>}</div>
          </div>
        </section>

        <aside className="panel audit-panel" aria-label="Compliance and communications">
          <div className="panel-heading"><span>02</span><div><p>Operations</p><h2>Mode & audit</h2></div></div>
          <div className="mode-selector" role="tablist" aria-label="Compliance mode">
            {modes.map((item) => <button type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? `mode-${item.id} active` : `mode-${item.id}`} key={item.id} onClick={() => setMode(item.id)}><span>{item.id === 'violate' ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}{item.label}</span><small>{item.detail}</small></button>)}
          </div>
          <section className={`audit-card ${audit.status}`}><div className="audit-title">{audit.status === 'compliant' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}<div><span>Real-time audit</span><h3>{audit.title}</h3></div></div><ul>{audit.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></section>
          <section className="metrics-section"><div className="section-title"><span>Scene metrics</span><b>LIVE</b></div><div className="metric-grid"><div><span>Taper length</span><strong>{taperLength}<small> FT</small></strong><i className="metric-good">{mode === 'modified' ? 'Enhanced' : mode === 'violate' ? 'Training state' : 'Standard'}</i></div><div><span>Upstream cones</span><strong>{upstreamCount}<small> / {scenario === 'right-lane' ? '8 MIN' : 4}</small></strong><i className={upstreamCount >= 8 || scenario !== 'right-lane' ? 'metric-good' : 'metric-risk'}>{upstreamCount >= 8 || scenario !== 'right-lane' ? 'Minimum met' : 'Below SOP'}</i></div><div><span>Buffer zone</span><strong>{scenario === 'right-lane' ? `${bufferCount} / 3` : 'N/A'}</strong><i>Anchor + 2 cones</i></div><div><span>Taper cones</span><strong>{scenario === 'right-lane' ? `${taperCount} / 5 MIN` : '3 / 3'}</strong><i>{mode === 'modified' ? 'Additional allowed' : 'Standard count'}</i></div><div><span>Forward spacing</span><strong>{downstreamSpacing}<small> FT</small></strong><i>{mode === 'modified' ? 'Expanded allowed' : 'Standard 40 ft'}</i></div><div><span>Shoulder access</span><strong>{scenario === 'right-lane' ? 'CLEAR' : 'N/A'}</strong><i className="metric-good">Responder route</i></div></div></section>
          <section className="radio-section"><div className="section-title"><span>Communications</span><Radio size={15} /></div><div className="radio-log">{radioEvents.map((event, index) => <div className="radio-event" key={`${event.time}-${index}`}><Clock3 size={14} /><div><span>{event.time} · {event.channel}</span><p>{event.text}</p></div></div>)}</div><button className="secondary-button" type="button" onClick={addRadioEvent}><Plus size={16} /> Add radio event</button></section>
        </aside>
      </section>
      {designerOpen && <SceneDesigner onClose={() => setDesignerOpen(false)} onSave={saveTemplate} />}
    </main>
  )
}

export default App
