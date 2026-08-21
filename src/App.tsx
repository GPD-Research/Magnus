import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Layers3,
  LoaderCircle,
  MapPinned,
  Minus,
  MousePointer2,
  Navigation,
  PencilRuler,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TrafficCone,
  Truck,
} from 'lucide-react'
import './App.css'
import { RoadwayLayer } from './components/RoadwayLayer'
import { SceneDesigner } from './components/SceneDesigner'
import { SceneEquipmentGlyph } from './components/SceneEquipmentGlyph'
import {
  EQUIPMENT_CATALOG,
  canDeploy,
  deployedCount,
  deploymentLimit,
  equipmentDefinition,
  sceneCounts,
  type DeployedEquipment,
  type ToolkitCategory,
} from './domain/equipmentCatalog'
import {
  createDevelopmentRoadScene,
  type RoadScene,
  type RoadLayerVisibility,
} from './domain/roadScene'
import {
  resolveRoadLocation,
  travelDirections,
  validateRoadLocation,
  type ResolvedRoadLocation,
  type RoadLocationRequest,
} from './domain/roadLocation'
import {
  roadSectionLabel,
  roadSectionTransform,
  selectableRoadSections,
} from './domain/roadSection'
import {
  MAX_SCENE_ZOOM,
  MIN_SCENE_ZOOM,
  SCENE_ZOOM_STEP,
  centeredSceneViewBox,
  clampSceneZoom,
  clientToScenePoint,
} from './domain/sceneCamera'
import {
  MAX_SSP_TRUCKS,
  SIGNBOARD_OPTIONS,
  addSspTruck,
  createSspTrucks,
  signboardLabel,
  updateTruckSignboard,
  type SignboardMessage,
} from './domain/signboard'
import type { SceneTemplateDocument } from './domain/sceneTemplate'
import {
  RIGHT_LANE_STANDARD,
  SCENARIO_CATALOG,
  auditScene,
  createScene,
  scenarioDefinition,
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

type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'
type SaveStatus = 'idle' | 'saved'

interface SavedScenario {
  version: 1
  scenario: ScenarioType
  sceneVisible?: boolean
  sceneOrigin?: { x: number; y: number }
  mode: ComplianceMode
  laneCount: number
  points: ScenePoint[]
  trucks: ReturnType<typeof createSspTrucks>
  deployedEquipment: DeployedEquipment[]
  radioEvents: { time: string; text: string; channel: string }[]
}

function loadSavedScenario(): SavedScenario | null {
  try {
    const stored = localStorage.getItem('magnus.scenario')
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1) return null
    const scenario = parsed as Partial<SavedScenario>
    return scenario.scenario && scenario.mode && typeof scenario.laneCount === 'number'
      && Array.isArray(scenario.points) && Array.isArray(scenario.trucks)
      && Array.isArray(scenario.deployedEquipment) && Array.isArray(scenario.radioEvents)
      ? scenario as SavedScenario
      : null
  } catch {
    return null
  }
}

async function probeSpatialService(): Promise<boolean> {
  try {
    const response = await fetch('/api/health')
    if (!response.ok) return false
    const health: unknown = await response.json()
    return Boolean(health && typeof health === 'object' && 'status' in health && health.status === 'ok')
  } catch {
    return false
  }
}

const signboardSymbolPaths: Partial<Record<SignboardMessage, string>> = {
  'left-arrow': 'M 22 0 H -22 M -22 0 L -10 -8 M -22 0 L -10 8',
  'right-arrow': 'M -22 0 H 22 M 22 0 L 10 -8 M 22 0 L 10 8',
  'split-arrow': 'M -22 0 H 22 M -22 0 L -10 -8 M -22 0 L -10 8 M 22 0 L 10 -8 M 22 0 L 10 8',
  'double-diamonds': 'M -25 0 L -16 -9 L -7 0 L -16 9 Z M 7 0 L 16 -9 L 25 0 L 16 9 Z',
}

const signboardCopy: Partial<Record<SignboardMessage, [string, string]>> = {
  'ramp-blocked': ['RAMP', 'BLOCKED'],
  'slow-roll-do-not-pass': ['SLOW ROLL', 'DO NOT PASS'],
  'incident-ahead': ['INCIDENT', 'AHEAD'],
  'high-water': ['HIGH', 'WATER'],
}

function SignboardGraphic({ message }: { message: SignboardMessage }) {
  const symbolPath = signboardSymbolPaths[message]
  const copy = signboardCopy[message]
  return (
    <>
      <rect className="signboard" x="-40" y="-12" width="80" height="24" />
      {symbolPath && <path className="signboard-symbol" d={symbolPath} />}
      {copy && <text className="signboard-copy" textAnchor="middle"><tspan x="0" y="-2">{copy[0]}</tspan><tspan x="0" y="8">{copy[1]}</tspan></text>}
    </>
  )
}

function App() {
  const [savedScenario] = useState(loadSavedScenario)
  const [roadScene, setRoadScene] = useState<RoadScene>(createDevelopmentRoadScene)
  const [locationRequest, setLocationRequest] = useState<RoadLocationRequest>({
    highway: 'I-95',
    direction: 'northbound',
    referenceType: 'exit',
    reference: '166',
  })
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedRoadLocation | null>(null)
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [locationLoading, setLocationLoading] = useState(false)
  const [sectionSelectionEnabled, setSectionSelectionEnabled] = useState(false)
  const [selectedRoadSectionId, setSelectedRoadSectionId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<ScenarioType>(savedScenario?.scenario ?? 'right-lane')
  const [sceneVisible, setSceneVisible] = useState(savedScenario?.sceneVisible ?? true)
  const [scenePlacementActive, setScenePlacementActive] = useState(false)
  const [sceneOrigin, setSceneOrigin] = useState(savedScenario?.sceneOrigin ?? { x: 0, y: 0 })
  const [mode, setMode] = useState<ComplianceMode>(savedScenario?.mode ?? 'gospel')
  const [laneCount, setLaneCount] = useState(savedScenario?.laneCount ?? 3)
  const [points, setPoints] = useState<ScenePoint[]>(() => savedScenario?.points ?? createScene('right-lane'))
  const [trucks, setTrucks] = useState(() => savedScenario?.trucks ?? createSspTrucks())
  const [selectedTruckId, setSelectedTruckId] = useState('ssp-truck-1')
  const [draggingTruckId, setDraggingTruckId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [deployedEquipment, setDeployedEquipment] = useState<DeployedEquipment[]>(savedScenario?.deployedEquipment ?? [])
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null)
  const [draggingEquipmentId, setDraggingEquipmentId] = useState<string | null>(null)
  const [activeToolkit, setActiveToolkit] = useState<ToolkitCategory>('asset')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [sceneZoom, setSceneZoom] = useState(1)
  const [sceneDisplaySize, setSceneDisplaySize] = useState({ width: 1, height: 1 })
  const [designerOpen, setDesignerOpen] = useState(false)
  const [spatialServiceStatus, setSpatialServiceStatus] = useState<SpatialServiceStatus>('checking')
  const roadStageRef = useRef<HTMLDivElement>(null)
  const pinchPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null)
  const [roadLayerVisibility, setRoadLayerVisibility] = useState<RoadLayerVisibility>({
    roadGeometry: true,
    barriers: true,
    trafficFlow: true,
  })
  const [radioEvents, setRadioEvents] = useState(savedScenario?.radioEvents ?? [])

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
  const sceneViewBox = centeredSceneViewBox(roadScene.viewport, 1, sceneDisplaySize)
  const sceneViewBoxValue = `${sceneViewBox.x} ${sceneViewBox.y} ${sceneViewBox.width} ${sceneViewBox.height}`
  const sceneCanvasSize = {
    width: Math.max(1, sceneDisplaySize.width - 36) * sceneZoom,
    height: Math.max(1, sceneDisplaySize.height - 36) * sceneZoom,
  }
  const roadSections = selectableRoadSections(roadScene)
  const selectedRoadSection = roadSections.find((feature) => feature.id === selectedRoadSectionId)
  const selectedSectionTransform = selectedRoadSection
    ? roadSectionTransform(selectedRoadSection)
    : null
  const equipmentTransform = selectedSectionTransform
    ? `translate(${selectedSectionTransform.x} ${selectedSectionTransform.y}) rotate(${selectedSectionTransform.rotation}) translate(${-RIGHT_LANE_STANDARD.truck.x} ${-RIGHT_LANE_STANDARD.truck.y})`
    : undefined
  const selectedTruck = trucks.find((truck) => truck.id === selectedTruckId) ?? trucks[0]
  const selectedEquipment = deployedEquipment.find((item) => item.id === selectedEquipmentId)
  const selectedEquipmentDefinition = selectedEquipment
    ? equipmentDefinition(selectedEquipment.definitionId)
    : null
  const deployedCounts = sceneCounts(
    sceneVisible ? deployedEquipment : [],
    sceneVisible ? trucks.length : 0,
    sceneVisible ? points.length : 0,
  )
  const catalogBaselineCounts = { cone: sceneVisible ? points.length : 0, 'ssp-truck': sceneVisible ? trucks.length : 0 }
  const selectedScenario = scenarioDefinition(scenario)
  const sceneTransform = `translate(${sceneOrigin.x} ${sceneOrigin.y})${equipmentTransform ? ` ${equipmentTransform}` : ''}`

  useEffect(() => {
    const stage = roadStageRef.current
    if (!stage) return

    const updateDisplaySize = () => {
      const { clientWidth: width, clientHeight: height } = stage
      if (width > 0 && height > 0) setSceneDisplaySize({ width, height })
    }
    const observer = new ResizeObserver(updateDisplaySize)
    observer.observe(stage)
    updateDisplaySize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const stage = roadStageRef.current
    if (!stage) return
    const frame = requestAnimationFrame(() => {
      stage.scrollTo({
        left: Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2),
        top: Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2),
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [roadScene, sceneZoom])

  useEffect(() => {
    let active = true
    void probeSpatialService().then((available) => {
      if (active) setSpatialServiceStatus(available ? 'connected' : 'unavailable')
    })
    return () => { active = false }
  }, [])

  async function retrySpatialService() {
    setSpatialServiceStatus('checking')
    const available = await probeSpatialService()
    setSpatialServiceStatus(available ? 'connected' : 'unavailable')
  }

  function changeScenario(nextScenario: ScenarioType) {
    setScenario(nextScenario)
  }

  function beginScenePlacement() {
    setSceneVisible(false)
    setScenePlacementActive(true)
    setSelectedRoadSectionId(null)
    setSectionSelectionEnabled(false)
  }

  function removeScene() {
    setSceneVisible(false)
    setScenePlacementActive(false)
    setSelectedEquipmentId(null)
    setSelectedTruckId('ssp-truck-1')
  }

  function placeScene(event: React.PointerEvent<SVGSVGElement>) {
    if (!scenePlacementActive) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const point = clientToScenePoint(
      { x: event.clientX, y: event.clientY },
      bounds,
      sceneViewBox,
    )
    setPoints(createScene(scenario))
    setTrucks(createSspTrucks())
    setDeployedEquipment([])
    setSceneOrigin({
      x: point.x - RIGHT_LANE_STANDARD.truck.x - selectedScenario.truckOffsetX,
      y: point.y - RIGHT_LANE_STANDARD.truck.y,
    })
    setSceneVisible(true)
    setScenePlacementActive(false)
  }

  function resetScenario() {
    setPoints(createScene(scenario))
    setTrucks(createSspTrucks())
    setSelectedTruckId('ssp-truck-1')
    setDeployedEquipment([])
    setSelectedEquipmentId(null)
    setRadioEvents([])
    setSceneVisible(true)
    setScenePlacementActive(false)
    setSceneOrigin({ x: 0, y: 0 })
    setSaveStatus('idle')
    localStorage.removeItem('magnus.scenario')
  }

  function saveScenario() {
    const saved: SavedScenario = {
      version: 1,
      scenario,
      sceneVisible,
      sceneOrigin,
      mode,
      laneCount,
      points,
      trucks,
      deployedEquipment,
      radioEvents,
    }
    localStorage.setItem('magnus.scenario', JSON.stringify(saved))
    setSaveStatus('saved')
  }

  function addTruck() {
    const nextTrucks = addSspTruck(trucks)
    setTrucks(nextTrucks)
    setSelectedTruckId(nextTrucks.at(-1)?.id ?? selectedTruckId)
  }

  function removeSelectedTruck() {
    if (trucks.length === 1) return
    const nextTrucks = trucks.filter((truck) => truck.id !== selectedTruckId)
    setTrucks(nextTrucks)
    setSelectedTruckId(nextTrucks[0].id)
  }

  function setSelectedTruckSignboard(signboard: SignboardMessage) {
    setTrucks((current) => updateTruckSignboard(current, selectedTruck.id, signboard))
  }

  function deployCatalogItem(definitionId: string) {
    if (definitionId === 'ssp-truck') {
      addTruck()
      return
    }
    if (!canDeploy(definitionId, deployedEquipment, trucks.length, catalogBaselineCounts)) return
    const sequence = deployedEquipment.length
    const definition = equipmentDefinition(definitionId)
    const equipment: DeployedEquipment = {
      id: `${definitionId}-${crypto.randomUUID()}`,
      definitionId,
      x: Math.max(definition.width / 2 + 2, Math.min(roadScene.viewport.width - definition.width / 2 - 2, 18 + (sequence % 4) * 14)),
      y: 330 + (sequence % 8) * 42,
      rotation: 0,
    }
    setDeployedEquipment((current) => [...current, equipment])
    setSelectedEquipmentId(equipment.id)
  }

  function updateDeployedEquipment(id: string, updates: Partial<DeployedEquipment>) {
    setDeployedEquipment((current) => current.map((item) => item.id === id ? { ...item, ...updates } : item))
  }

  function deleteSelectedEquipment() {
    if (!selectedEquipment) return
    setDeployedEquipment((current) => current.filter((item) => item.id !== selectedEquipment.id))
    setSelectedEquipmentId(null)
  }

  function moveCone(event: React.PointerEvent<SVGSVGElement>) {
    if ((!dragging || mode === 'gospel') && !draggingEquipmentId && !draggingTruckId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scenePoint = clientToScenePoint(
      { x: event.clientX, y: event.clientY },
      bounds,
      sceneViewBox,
    )
    if (dragging && mode !== 'gospel') {
      const x = Math.max(6, Math.min(roadScene.viewport.width - 6, scenePoint.x - sceneOrigin.x))
      const y = Math.max(30, Math.min(roadScene.viewport.height - 30, scenePoint.y - sceneOrigin.y))
      setPoints((current) => current.map((point) => (point.id === dragging ? { ...point, x, y } : point)))
    }
    if (draggingEquipmentId) {
      const item = deployedEquipment.find((equipment) => equipment.id === draggingEquipmentId)
      if (!item) return
      const definition = equipmentDefinition(item.definitionId)
      const x = Math.max(definition.width / 2, Math.min(roadScene.viewport.width - definition.width / 2, scenePoint.x - sceneOrigin.x))
      const y = Math.max(definition.length / 2, Math.min(roadScene.viewport.height - definition.length / 2, scenePoint.y - sceneOrigin.y))
      updateDeployedEquipment(item.id, { x, y })
    }
    if (draggingTruckId) {
      const x = Math.max(RIGHT_LANE_STANDARD.truck.width / 2, Math.min(roadScene.viewport.width - RIGHT_LANE_STANDARD.truck.width / 2, scenePoint.x - sceneOrigin.x))
      const y = Math.max(RIGHT_LANE_STANDARD.truck.halfLength, Math.min(roadScene.viewport.height - RIGHT_LANE_STANDARD.truck.halfLength, scenePoint.y - sceneOrigin.y))
      setTrucks((current) => current.map((truck) => truck.id === draggingTruckId ? { ...truck, x, y } : truck))
    }
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

  function scenePointerDistance() {
    const [first, second] = [...pinchPointersRef.current.values()]
    return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0
  }

  function startScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchPointersRef.current.size === 2) {
      setDragging(null)
      pinchStartRef.current = { distance: scenePointerDistance(), zoom: sceneZoom }
    }
  }

  function moveScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!pinchPointersRef.current.has(event.pointerId)) return
    pinchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pinchStart = pinchStartRef.current
    if (!pinchStart || pinchStart.distance === 0) return
    event.preventDefault()
    setSceneZoom(clampSceneZoom(pinchStart.zoom * scenePointerDistance() / pinchStart.distance))
  }

  function endScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    pinchPointersRef.current.delete(event.pointerId)
    if (pinchPointersRef.current.size < 2) pinchStartRef.current = null
  }

  function zoomSceneWithTrackpad(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return
    event.preventDefault()
    setSceneZoom((current) => clampSceneZoom(current * Math.exp(-event.deltaY * 0.01)))
  }

  async function loadRoadLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateRoadLocation(locationRequest)
    setLocationErrors(errors)
    if (errors.length > 0) return

    setLocationLoading(true)
    const resolved = await resolveRoadLocation(locationRequest)
    setRoadScene(resolved.scene)
    setResolvedLocation(resolved)
    setSelectedRoadSectionId(null)
    setSectionSelectionEnabled(false)
    setSceneZoom(1)
    setLocationLoading(false)
  }

  function setRoadLayerVisibilityValue(
    layer: keyof RoadLayerVisibility,
    visible: boolean,
  ) {
    setRoadLayerVisibility((current) => ({ ...current, [layer]: visible }))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-label={`Magnus version ${__APP_VERSION__}`}><span aria-hidden="true">M</span></div>
        <div className="brand-copy"><strong>MAGNUS</strong><span>SSP Scene Builder</span></div>
        <div className="session-status"><span className="live-dot" />Magnus <b>v{__APP_VERSION__}</b></div>
        <button className="icon-button" type="button" title="Reset scene" onClick={resetScenario}><RotateCcw size={18} /></button>
        <button className="primary-button" type="button" onClick={saveScenario}><Check size={17} /> {saveStatus === 'saved' ? 'Scenario saved' : 'Save scenario'}</button>
      </header>

      <section className="workspace">
        <aside className="panel config-panel" aria-label="Scenario configuration">
          <div className="panel-heading"><span>01</span><div><p>Configuration</p><h2>Build the scene</h2></div></div>
          <div className={`spatial-service-status ${spatialServiceStatus}`} role="status" aria-live="polite">
            <span className="service-indicator" aria-hidden="true" />
            <div><b>Spatial service</b><small>{spatialServiceStatus === 'connected' ? 'Connected' : spatialServiceStatus === 'checking' ? 'Checking connection' : 'Development preview available'}</small></div>
            {spatialServiceStatus === 'unavailable' && <button type="button" title="Retry spatial service connection" aria-label="Retry spatial service connection" onClick={() => { void retrySpatialService() }}><RefreshCw size={14} /></button>}
          </div>
          <div className="template-designer-launch">
            <button type="button" onClick={() => setDesignerOpen(true)}><PencilRuler size={16} /><span><b>Scene design tool</b><small>Author vector SOP templates</small></span></button>
          </div>
          <form className="location-tool" aria-label="Roadway location" onSubmit={(event) => { void loadRoadLocation(event) }}>
            <div className="location-tool-heading"><MapPinned size={16} /><div><label htmlFor="highway">Roadway location</label><span>Load scaled corridor geometry</span></div></div>
            <div className="location-fields">
              <label className="location-highway" htmlFor="highway">Highway<input id="highway" placeholder="I-95 or Route 28" value={locationRequest.highway} onChange={(event) => setLocationRequest((current) => ({ ...current, highway: event.target.value }))} /></label>
              <label htmlFor="direction">Direction<select id="direction" value={locationRequest.direction} onChange={(event) => setLocationRequest((current) => ({ ...current, direction: event.target.value as RoadLocationRequest['direction'] }))}>{travelDirections.map((direction) => <option value={direction.value} key={direction.value}>{direction.label}</option>)}</select></label>
              <label htmlFor="reference-type">Reference<select id="reference-type" value={locationRequest.referenceType} onChange={(event) => setLocationRequest((current) => ({ ...current, referenceType: event.target.value as RoadLocationRequest['referenceType'] }))}><option value="mile-marker">Mile marker</option><option value="exit">Exit number</option></select></label>
              <label htmlFor="reference">{locationRequest.referenceType === 'exit' ? 'Exit' : 'Mile marker'}<input id="reference" inputMode="decimal" placeholder={locationRequest.referenceType === 'exit' ? '166' : '168.0'} value={locationRequest.reference} onChange={(event) => setLocationRequest((current) => ({ ...current, reference: event.target.value }))} /></label>
            </div>
            {locationErrors.map((error) => <p className="location-error" role="alert" key={error}>{error}</p>)}
            <button className="location-load" type="submit" disabled={locationLoading}>{locationLoading ? <LoaderCircle className="location-spinner" size={15} /> : <MapPinned size={15} />}<span>{locationLoading ? 'Resolving location' : 'Render location'}</span></button>
            {resolvedLocation && <div className={`location-result ${resolvedLocation.source}`} role="status"><strong>{resolvedLocation.request.highway} · {resolvedLocation.request.direction.replace('bound', 'bound ')}</strong><span>{resolvedLocation.message}</span></div>}
          </form>
          <div className="control-group">
            <label>Scene type</label>
            <div className="scenario-options">
              {SCENARIO_CATALOG.map((item) => (
                <button className={scenario === item.id ? 'scenario-card active' : 'scenario-card'} disabled={sceneVisible || scenePlacementActive} key={item.id} type="button" onClick={() => changeScenario(item.id)}>
                  {item.id === 'shoulder' || item.id === 'lane-shift' ? <Navigation size={18} /> : <TrafficCone size={18} />}<span>{item.label}<small>{item.mutcdApplication}</small></span><i>{scenario === item.id && <Check size={13} />}</i>
                </button>
              ))}
            </div>
            <div className="scene-placement-actions">
              {sceneVisible ? (
                <button className="remove-scene-button" type="button" onClick={removeScene}><Minus size={15} /> Remove scene</button>
              ) : (
                <button className={scenePlacementActive ? 'add-scene-button active' : 'add-scene-button'} type="button" aria-pressed={scenePlacementActive} onClick={beginScenePlacement}><MousePointer2 size={15} /> {scenePlacementActive ? 'Tap roadway to place' : 'Add scene'}</button>
              )}
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
            <label className="toggle-row"><span><Layers3 size={16} /> Road geometry</span><input type="checkbox" checked={roadLayerVisibility.roadGeometry} onChange={(event) => setRoadLayerVisibilityValue('roadGeometry', event.target.checked)} /></label>
            <label className="toggle-row"><span><span className="barrier-symbol" /> Barriers</span><input type="checkbox" checked={roadLayerVisibility.barriers} onChange={(event) => setRoadLayerVisibilityValue('barriers', event.target.checked)} /></label>
            <label className="toggle-row"><span><span className="flow-symbol">→</span> Traffic flow</span><input type="checkbox" checked={roadLayerVisibility.trafficFlow} onChange={(event) => setRoadLayerVisibilityValue('trafficFlow', event.target.checked)} /></label>
          </div>
          {sceneVisible && <section className="scene-toolkit" aria-label="Scene equipment toolkit">
            <div className="toolkit-tabs" role="tablist" aria-label="Equipment toolkit">
              <button type="button" role="tab" aria-selected={activeToolkit === 'asset'} onClick={() => setActiveToolkit('asset')}>Assets</button>
              <button type="button" role="tab" aria-selected={activeToolkit === 'hazard'} onClick={() => setActiveToolkit('hazard')}>Hazards</button>
            </div>
            <div className="toolkit-list">{EQUIPMENT_CATALOG.filter((definition) => definition.category === activeToolkit).map((definition) => {
              const currentCount = deployedCount(definition.id, deployedEquipment, catalogBaselineCounts)
              const limit = definition.id === 'ssp-truck' ? MAX_SSP_TRUCKS : deploymentLimit(definition, deployedEquipment, trucks.length)
              const available = definition.id === 'ssp-truck' ? trucks.length < MAX_SSP_TRUCKS : canDeploy(definition.id, deployedEquipment, trucks.length, catalogBaselineCounts)
              return <button type="button" key={definition.id} disabled={!available} onClick={() => deployCatalogItem(definition.id)}><span className="toolkit-swatch" style={{ background: definition.color }} /><span>{definition.label}</span><small>{currentCount}{Number.isFinite(limit) ? ` / ${limit}` : ''}</small><Plus size={13} /></button>
            })}</div>
          </section>}
          <div className="asset-inventory"><div><span>Available assets</span><b>{sceneVisible ? points.length + trucks.length + 2 : 0}</b></div><div className="asset-icons"><span><Truck size={19} /> {sceneVisible ? trucks.length : 0}</span><span><TrafficCone size={19} /> {sceneVisible ? points.length : 0}</span><span><Radio size={18} /> {sceneVisible ? 2 : 0}</span></div></div>
        </aside>

        <section className="canvas-panel" aria-label="Interactive scene canvas">
          <div className="canvas-toolbar">
            <div><span className="eyebrow">Vector scene · {roadScene.source.type.replaceAll('-', ' ')}</span><h1>{sceneVisible ? selectedScenario.heading : scenePlacementActive ? `Place ${selectedScenario.label.toLowerCase()}` : 'Roadway only'}</h1><small className="scene-dataset">{roadScene.source.dataset}</small></div>
            <div className="canvas-tools">
              <div className="scale-key"><span /> 40 FT</div>
            </div>
          </div>
          <div className="road-stage" ref={roadStageRef} data-zoom={sceneZoom} onPointerDown={startScenePointer} onPointerMove={moveScenePointer} onPointerUp={endScenePointer} onPointerCancel={endScenePointer} onWheel={zoomSceneWithTrackpad}>
            <div className="road-canvas-surface" style={sceneCanvasSize}>
            <svg className={`road-canvas${scenePlacementActive ? ' placing-scene' : ''}`} viewBox={sceneViewBoxValue} role="img" aria-label="Top-down highway scene with SSP vehicle and traffic cones" data-zoom={sceneZoom} onPointerDown={placeScene} onPointerMove={moveCone} onPointerUp={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null) }} onPointerLeave={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null) }}>
              <RoadwayLayer
                scene={roadScene}
                visibility={roadLayerVisibility}
                selectionEnabled={sectionSelectionEnabled}
                selectedFeatureId={selectedRoadSectionId}
                onSelectFeature={(feature) => {
                  setSelectedRoadSectionId(feature.id)
                  setSectionSelectionEnabled(false)
                }}
              />
              {sceneVisible && <g className={`scene-equipment${sectionSelectionEnabled ? ' selection-paused' : ''}`} transform={sceneTransform}>
              {trucks.map((truck) => <g
                aria-label={`${truck.label}, signboard ${signboardLabel(truck.signboard)}`}
                className={`ssp-truck${truck.id === selectedTruck.id ? ' selected' : ''}`}
                data-length-feet={RIGHT_LANE_STANDARD.truck.length}
                data-signboard={truck.signboard}
                data-truck-id={truck.id}
                data-width-feet={RIGHT_LANE_STANDARD.truck.width}
                key={truck.id}
                onClick={(event) => { event.stopPropagation(); setSelectedTruckId(truck.id) }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedTruckId(truck.id) }}
                onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedTruckId(truck.id); setDraggingTruckId(truck.id) }}
                role="button"
                tabIndex={0}
                transform={`translate(${truck.x + selectedScenario.truckOffsetX} ${truck.y})`}
              >
                <rect className="truck-body" x="-4.25" y="-12" width="8.5" height="24" />
                <path className="truck-panel-line" d="M -4.25 -1 H 4.25 M -4.25 -7 H 4.25 M -3 -7 V -1 M 3 -7 V -1" />
                <path className="truck-windshield" d="M -3.4 -3 H 3.4 L 2.8 -8 H -2.8 Z" />
                <path className="truck-hood-line" d="M -3.2 -10 H 3.2 M -2.5 -12 V -10 M 2.5 -12 V -10" />
                <rect className="truck-lightbar" x="-4.5" y="-1" width="9" height="1.4" />
                <rect className="strobe" x="-4" y="-11" width="0.8" height="0.8" />
                <rect className="strobe delayed" x="3.2" y="-11" width="0.8" height="0.8" />
                <g transform="translate(0 10) scale(.1)"><SignboardGraphic message={truck.signboard} /></g>
              </g>)}
              {points.map((point) => (
                <g className={`cone ${mode === 'gospel' ? 'locked' : ''}`} key={point.id} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => { if (mode === 'gospel') return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(point.id) }}>
                  <rect className="cone-hit-area" x="-4" y="-4" width="8" height="8" />
                  <path className="cone-body" d="M -.7 .8 L -.3 -1.3 H .3 L .7 .8 Z" />
                  <path className="cone-band" d="M -.5 -.2 H .5" />
                  <path className="cone-base" d="M -1 1 H 1" />
                </g>
              ))}
              {deployedEquipment.map((item) => {
                const definition = equipmentDefinition(item.definitionId)
                return <g
                  aria-label={definition.label}
                  className={`deployed-equipment${item.id === selectedEquipmentId ? ' selected' : ''}`}
                  data-definition-id={definition.id}
                  key={item.id}
                  onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedEquipmentId(item.id); setSelectedTruckId(''); setDraggingEquipmentId(item.id) }}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
                >
                  <SceneEquipmentGlyph definition={definition} />
                  <rect className="deployed-selection" x={-definition.width / 2 - 2} y={-definition.length / 2 - 2} width={definition.width + 4} height={definition.length + 4} />
                </g>
              })}
              </g>}
              <g className="north-arrow" transform="translate(10 695)"><path d="M 0 20 V 0 M 0 0 l -3 6 M 0 0 l 3 6" /></g>
            </svg>
            </div>
            <div className={`canvas-hint${scenePlacementActive ? ' placement-active' : ''}`}>{scenePlacementActive ? <><MousePointer2 size={15} /> Tap roadway to place {selectedScenario.label.toLowerCase()}</> : !sceneVisible ? <><Navigation size={15} /> Roadway only</> : sectionSelectionEnabled ? <><MousePointer2 size={15} /> Select a roadway section</> : mode === 'gospel' ? <><ShieldCheck size={15} /> Positions locked to Standard SOP</> : <><Navigation size={15} /> Drag cones to adapt the scene</>}</div>
          </div>
        </section>

        <aside className="panel audit-panel" aria-label="Compliance and communications">
          <div className="panel-heading"><span>02</span><div><p>Operations</p><h2>Mode & audit</h2></div></div>
          <section className="scene-resource-counts" aria-label="Scene resource counts"><div><span>Vehicles</span><b>{deployedCounts.vehicles}</b></div><div><span>Cones</span><b>{deployedCounts.cones}</b></div><div><span>Personnel</span><b>{deployedCounts.personnel}</b></div><div><span>Hazards</span><b>{deployedCounts.hazards}</b></div></section>
          {selectedEquipment && selectedEquipmentDefinition && <section className="equipment-inspector" aria-label="Selected scene item"><div><span>Selected item</span><b>{selectedEquipmentDefinition.label}</b></div><div className="equipment-position"><label>X (ft)<input type="number" value={Math.round(selectedEquipment.x)} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { x: Number(event.target.value) })} /></label><label>Y (ft)<input type="number" value={Math.round(selectedEquipment.y)} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { y: Number(event.target.value) })} /></label><label>Rotation<select value={selectedEquipment.rotation} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { rotation: Number(event.target.value) })}><option value="0">0°</option><option value="45">45°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label></div><button type="button" onClick={deleteSelectedEquipment}>Delete selected item</button></section>}
          <section className="signboard-control" aria-label="SSP truck signboard">
            <div className="signboard-control-heading"><div><span>SSP truck signboard</span><b>{selectedTruck.label}</b></div><small>{trucks.length} / {MAX_SSP_TRUCKS}</small></div>
            {trucks.length > 1 && <div className="truck-selector" role="tablist" aria-label="SSP trucks">{trucks.map((truck, index) => <button type="button" role="tab" aria-selected={truck.id === selectedTruck.id} key={truck.id} onClick={() => setSelectedTruckId(truck.id)}>{index + 1}</button>)}</div>}
            <svg className="signboard-output" viewBox="-44 -16 88 32" role="img" aria-label={`${selectedTruck.label} signboard: ${signboardLabel(selectedTruck.signboard)}`}><SignboardGraphic message={selectedTruck.signboard} /></svg>
            <label htmlFor="signboard-message">Displayed message<select id="signboard-message" aria-label={`Signboard message for ${selectedTruck.label}`} value={selectedTruck.signboard} onChange={(event) => setSelectedTruckSignboard(event.target.value as SignboardMessage)}>{SIGNBOARD_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <div className="truck-actions"><button type="button" title="Remove selected SSP truck" disabled={trucks.length === 1} onClick={removeSelectedTruck}><Minus size={14} /> Remove</button><button type="button" title="Add SSP truck" disabled={trucks.length >= MAX_SSP_TRUCKS} onClick={addTruck}><Plus size={14} /> Add truck</button></div>
          </section>
          <section className="scene-zoom-control" aria-label="Scene view controls">
            <span>Scene zoom</span>
            <div className="zoom-controls" role="group" aria-label="Scene zoom">
              <button type="button" title="Zoom out" aria-label="Zoom out highway graphic" disabled={sceneZoom <= MIN_SCENE_ZOOM} onClick={() => changeSceneZoom(-SCENE_ZOOM_STEP)}><Minus size={17} /></button>
              <button className="zoom-value" type="button" title="Reset zoom" aria-label={`Reset highway graphic zoom, currently ${Math.round(sceneZoom * 100)} percent`} onClick={() => setSceneZoom(1)}>{Math.round(sceneZoom * 100)}%</button>
              <button type="button" title="Zoom in" aria-label="Zoom in highway graphic" disabled={sceneZoom >= MAX_SCENE_ZOOM} onClick={() => changeSceneZoom(SCENE_ZOOM_STEP)}><Plus size={17} /></button>
            </div>
          </section>
          {roadSections.length > 1 && (
            <section className={`section-control${sectionSelectionEnabled ? ' selecting' : ''}`} aria-label="Controlled roadway section">
              <div><span>Controlled sector</span><b>{selectedRoadSection ? roadSectionLabel(selectedRoadSection) : 'No section selected'}</b></div>
              <button type="button" onClick={() => setSectionSelectionEnabled((enabled) => !enabled)}><MousePointer2 size={15} />{sectionSelectionEnabled ? 'Cancel selection' : 'Select section'}</button>
            </section>
          )}
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
