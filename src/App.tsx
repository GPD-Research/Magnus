import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  HardDrive,
  Layers3,
  LoaderCircle,
  MapPinned,
    Network,
    Palette,
  Minus,
  MousePointer2,
  Navigation,
  PencilRuler,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  TrafficCone,
  Truck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { ArrowUp } from 'lucide-react'
import './App.css'
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  themeTokens,
  type ConnectivityMode,
  type ThemeId,
} from './domain/appSettings'
import { RoadwayLayer } from './components/RoadwayLayer'
import { SceneDesigner } from './components/SceneDesigner'
import { SceneEquipmentGlyph } from './components/SceneEquipmentGlyph'
import {
  EQUIPMENT_CATALOG,
  canDeploy,
  deployedCount,
  deploymentLimit,
  equipmentDefinition,
  isEquipmentRotatable,
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
  formatStorageSize,
  loadOfflineStatus,
  prepareOfflineRegion,
  type OfflineRegionStatus,
  type OfflineStatus,
} from './domain/offlinePackages'
import {
  nearestRoadPlacement,
  roadSectionLabel,
  roadSectionTransform,
  selectableRoadSections,
} from './domain/roadSection'
import {
  DEFAULT_VISIBLE_SCENE_WIDTH_FEET,
  MIN_VISIBLE_SCENE_WIDTH_FEET,
  MIN_SCENE_ZOOM,
  SCENE_ZOOM_FACTOR,
  centeredSceneViewBox,
  clampSceneZoom,
  clientToScenePoint,
  sceneZoomForVisibleWidth,
  scenePointToLocal,
  visibleSceneWidth,
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
  scenarioLateralOffset,
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

const connectivityModes: { id: ConnectivityMode; label: string; icon: typeof Wifi }[] = [
  { id: 'online', label: 'Online', icon: Wifi },
  { id: 'lan', label: 'LAN', icon: Network },
  { id: 'offline', label: 'Offline', icon: WifiOff },
]

const themeIds: ThemeId[] = ['dark', 'light', 'custom-1', 'custom-2', 'custom-3']

type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'
type SaveStatus = 'idle' | 'saved'

const DEFAULT_LOCATION_REQUEST: RoadLocationRequest = {
  highway: 'I-95',
  direction: 'northbound',
  referenceType: 'mile-marker',
  reference: '170',
}

interface SavedScenario {
  version: 1
  scenario: ScenarioType
  sceneVisible?: boolean
  sceneOrigin?: { x: number; y: number }
  sceneRotation?: number
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

function MapCompass({ rotation }: { rotation: number }) {
  return (
    <div className="map-compass" role="img" aria-label={`Map compass, north rotated ${rotation} degrees`}>
      <svg viewBox="0 0 64 64" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
        <path className="compass-axis" d="M 32 10 V 54 M 10 32 H 54" />
        <path className="compass-north" d="M 32 5 L 27 17 L 32 14 L 37 17 Z" />
        <path className="compass-arrow" d="M 32 59 L 27 47 L 32 50 L 37 47 Z M 5 32 L 17 27 L 14 32 L 17 37 Z M 59 32 L 47 27 L 50 32 L 47 37 Z" />
        <text x="32" y="9" textAnchor="middle">N</text>
        <text x="32" y="63" textAnchor="middle">S</text>
        <text x="61" y="35" textAnchor="middle">E</text>
        <text x="3" y="35" textAnchor="middle">W</text>
      </svg>
    </div>
  )
}

function createScenarioTrucks(scenario: ScenarioType) {
  const signboard = scenarioDefinition(scenario).signboard
  return createSspTrucks().map((truck) => ({ ...truck, signboard }))
}

function centeredRoadPlacement(scene: RoadScene) {
  return nearestRoadPlacement(scene, {
    x: scene.viewport.width / 2,
    y: scene.viewport.height / 2,
  })
}

function laterallyAlignedPlacement(
  placement: ReturnType<typeof nearestRoadPlacement>,
  scenario: ScenarioType,
) {
  if (!placement) return null
  const offset = scenarioLateralOffset(scenario, placement.lanes)
  const radians = placement.rotation * Math.PI / 180
  return {
    ...placement,
    x: placement.x + Math.cos(radians) * offset,
    y: placement.y + Math.sin(radians) * offset,
  }
}

function App() {
  const [savedScenario] = useState(loadSavedScenario)
  const [appSettings, setAppSettings] = useState(() => loadAppSettings(localStorage))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus | null>(null)
  const [offlineStatusMessage, setOfflineStatusMessage] = useState('')
  const [offlinePreparing, setOfflinePreparing] = useState<OfflineRegionStatus['id'] | null>(null)
  const [roadScene, setRoadScene] = useState<RoadScene>(createDevelopmentRoadScene)
  const [locationRequest, setLocationRequest] = useState<RoadLocationRequest>(DEFAULT_LOCATION_REQUEST)
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedRoadLocation | null>(null)
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [locationLoading, setLocationLoading] = useState(true)
  const [sectionSelectionEnabled, setSectionSelectionEnabled] = useState(false)
  const [selectedRoadSectionId, setSelectedRoadSectionId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<ScenarioType>(savedScenario?.scenario ?? 'right-lane')
  const [sceneVisible, setSceneVisible] = useState(savedScenario?.sceneVisible ?? true)
  const [scenePlacementActive, setScenePlacementActive] = useState(false)
  const [sceneOrigin, setSceneOrigin] = useState(savedScenario?.sceneOrigin ?? { x: 0, y: 0 })
  const [sceneRotation, setSceneRotation] = useState(savedScenario?.sceneRotation ?? 0)
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
  const rotatingEquipmentRef = useRef<{ id: string; startAngle: number; startRotation: number } | null>(null)
  const [activeToolkit, setActiveToolkit] = useState<ToolkitCategory>('asset')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [sceneZoom, setSceneZoom] = useState(1)
  const [sceneDisplaySize, setSceneDisplaySize] = useState({ width: 1, height: 1 })
  const [designerOpen, setDesignerOpen] = useState(false)
  const [spatialServiceStatus, setSpatialServiceStatus] = useState<SpatialServiceStatus>('checking')
  const roadStageRef = useRef<HTMLDivElement>(null)
  const locationResolutionRef = useRef(0)
  const panPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureFrameRef = useRef<number | null>(null)
  const threeFingerPanStartRef = useRef<{
    center: { x: number; y: number }
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const initializedZoomSceneRef = useRef<RoadScene | null>(null)
  const pendingZoomCenterRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
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
  const taperLength = [
    'right-lane',
    'left-lane',
    'center-lane',
    'two-right-lanes',
    'two-left-lanes',
  ].includes(scenario) ? taperCount * RIGHT_LANE_STANDARD.coneSpacing : 120
  const sceneViewBox = centeredSceneViewBox(roadScene.viewport, 1, sceneDisplaySize)
  const sceneViewBoxValue = `${sceneViewBox.x} ${sceneViewBox.y} ${sceneViewBox.width} ${sceneViewBox.height}`
  const defaultSceneZoom = sceneZoomForVisibleWidth(
    roadScene.viewport,
    sceneDisplaySize,
    DEFAULT_VISIBLE_SCENE_WIDTH_FEET,
  )
  const maximumSceneZoom = sceneZoomForVisibleWidth(
    roadScene.viewport,
    sceneDisplaySize,
    MIN_VISIBLE_SCENE_WIDTH_FEET,
  )
  const sceneVisibleWidth = visibleSceneWidth(roadScene.viewport, sceneDisplaySize, sceneZoom)
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
    ? `translate(${selectedSectionTransform.x} ${selectedSectionTransform.y}) rotate(${selectedSectionTransform.rotation}) translate(${scenarioLateralOffset(scenario, selectedRoadSection?.properties.lanes)} ${0}) translate(${-RIGHT_LANE_STANDARD.roadCenterX} ${-RIGHT_LANE_STANDARD.truck.y})`
    : undefined
  const selectedTruck = trucks.find((truck) => truck.id === selectedTruckId) ?? trucks[0]
  const selectedEquipment = deployedEquipment.find((item) => item.id === selectedEquipmentId)
  const selectedEquipmentDefinition = selectedEquipment
    ? equipmentDefinition(selectedEquipment.definitionId)
    : null
  const setupConeDefinition = equipmentDefinition('cone')
  const deployedCounts = sceneCounts(
    sceneVisible ? deployedEquipment : [],
    sceneVisible ? trucks.length : 0,
    sceneVisible ? points.length : 0,
  )
  const catalogBaselineCounts = { cone: sceneVisible ? points.length : 0, 'ssp-truck': sceneVisible ? trucks.length : 0 }
  const selectedScenario = scenarioDefinition(scenario)
    const mapRotation = 0
  const sceneAnchorX = RIGHT_LANE_STANDARD.roadCenterX
  const sceneAnchorY = RIGHT_LANE_STANDARD.truck.y
  const sceneFocusX = selectedSectionTransform?.x ?? sceneOrigin.x + sceneAnchorX
  const sceneFocusY = selectedSectionTransform?.y ?? sceneOrigin.y + sceneAnchorY
  const sceneTransform = equipmentTransform ?? [
    `translate(${sceneOrigin.x + sceneAnchorX} ${sceneOrigin.y + sceneAnchorY})`,
    `rotate(${sceneRotation})`,
    `translate(${-sceneAnchorX} ${-sceneAnchorY})`,
  ].join(' ')
  const effectiveSceneRotation = selectedSectionTransform?.rotation ?? sceneRotation
  const mapTransform = `rotate(${mapRotation} ${roadScene.viewport.width / 2} ${roadScene.viewport.height / 2})`

  useEffect(() => {
    saveAppSettings(localStorage, appSettings)
    const tokens = themeTokens(appSettings.theme, appSettings.customThemes)
    document.documentElement.dataset.theme = tokens.scheme
    document.documentElement.style.setProperty('--theme-accent', tokens.accent)
  }, [appSettings])

  useEffect(() => {
    if (!settingsOpen) return
    let active = true
    void loadOfflineStatus()
      .then((status) => {
        if (!active) return
        setOfflineStatus(status)
        setOfflineStatusMessage('')
      })
      .catch((error: unknown) => {
        if (active) setOfflineStatusMessage(error instanceof Error ? error.message : 'Offline package status is unavailable.')
      })
    return () => { active = false }
  }, [settingsOpen])

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
    if (sceneDisplaySize.width <= 1 || sceneDisplaySize.height <= 1) return
    if (initializedZoomSceneRef.current === roadScene) return
    initializedZoomSceneRef.current = roadScene
    pendingZoomCenterRef.current = {
      x: Math.max(0, Math.min(1, (sceneFocusX - sceneViewBox.x) / sceneViewBox.width)),
      y: Math.max(0, Math.min(1, (sceneFocusY - sceneViewBox.y) / sceneViewBox.height)),
      zoom: defaultSceneZoom,
    }
    setSceneZoom(defaultSceneZoom)
  }, [defaultSceneZoom, roadScene, sceneDisplaySize, sceneViewBox.x, sceneViewBox.y, sceneViewBox.width, sceneViewBox.height, sceneFocusX, sceneFocusY])

  useEffect(() => {
    const stage = roadStageRef.current
    const pendingCenter = pendingZoomCenterRef.current
    if (!stage || pendingCenter?.zoom !== sceneZoom) return
    const frame = requestAnimationFrame(() => {
      stage.scrollTo({
        left: Math.max(0, pendingCenter.x * stage.scrollWidth - stage.clientWidth / 2),
        top: Math.max(0, pendingCenter.y * stage.scrollHeight - stage.clientHeight / 2),
      })
      pendingZoomCenterRef.current = null
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

  useEffect(() => {
    let active = true
    const resolution = ++locationResolutionRef.current
    void resolveRoadLocation(DEFAULT_LOCATION_REQUEST, undefined, appSettings.connectivityMode).then((resolved) => {
      if (!active || resolution !== locationResolutionRef.current) return
      setRoadScene(resolved.scene)
      const initialScenario = savedScenario?.scenario ?? 'right-lane'
      const placement = laterallyAlignedPlacement(
        centeredRoadPlacement(resolved.scene),
        initialScenario,
      )
      if (!savedScenario && placement) {
        setSceneOrigin({ x: placement.x - sceneAnchorX, y: placement.y - sceneAnchorY })
        setSceneRotation(placement.rotation)
      }
      setResolvedLocation(resolved)
      setLocationLoading(false)
    })
    return () => { active = false }
  }, [appSettings.connectivityMode, savedScenario, sceneAnchorX, sceneAnchorY])

  async function prepareRegion(region: OfflineRegionStatus['id']) {
    setOfflinePreparing(region)
    setOfflineStatusMessage('Preparing local map package...')
    try {
      setOfflineStatus(await prepareOfflineRegion(region))
      setOfflineStatusMessage('Local map package is ready.')
    } catch (error) {
      setOfflineStatusMessage(error instanceof Error ? error.message : 'Offline preparation failed.')
    } finally {
      setOfflinePreparing(null)
    }
  }

  function selectConnectivityMode(connectivityMode: ConnectivityMode) {
    setAppSettings((current) => ({ ...current, connectivityMode }))
  }

  function selectTheme(theme: ThemeId) {
    setAppSettings((current) => ({ ...current, theme }))
  }

  function updateCustomTheme(id: keyof typeof DEFAULT_APP_SETTINGS.customThemes, updates: { name?: string; color?: string }) {
    setAppSettings((current) => ({
      ...current,
      theme: id,
      customThemes: {
        ...current.customThemes,
        [id]: { ...current.customThemes[id], ...updates },
      },
    }))
  }

  async function retrySpatialService() {
    setSpatialServiceStatus('checking')
    const available = await probeSpatialService()
    setSpatialServiceStatus(available ? 'connected' : 'unavailable')
  }

  function changeScenario(nextScenario: ScenarioType) {
    setScenario(nextScenario)
    setPoints(createScene(nextScenario))
    setTrucks(createScenarioTrucks(nextScenario))
    setSelectedTruckId('ssp-truck-1')
    setDeployedEquipment([])
    setSelectedEquipmentId(null)
    setSaveStatus('idle')
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
    const placement = laterallyAlignedPlacement(nearestRoadPlacement(roadScene, point), scenario)
    const anchor = placement ?? { ...point, rotation: 0 }
    setPoints(createScene(scenario))
    setTrucks(createScenarioTrucks(scenario))
    setDeployedEquipment([])
    setSceneOrigin({
      x: anchor.x - sceneAnchorX,
      y: anchor.y - sceneAnchorY,
    })
    setSceneRotation(anchor.rotation)
    setSceneVisible(true)
    setScenePlacementActive(false)
  }

  function resetScenario() {
    setPoints(createScene(scenario))
    setTrucks(createScenarioTrucks(scenario))
    setSelectedTruckId('ssp-truck-1')
    setDeployedEquipment([])
    setSelectedEquipmentId(null)
    setRadioEvents([])
    setSceneVisible(true)
    setScenePlacementActive(false)
    setSceneOrigin({ x: 0, y: 0 })
    setSceneRotation(0)
    setSaveStatus('idle')
    localStorage.removeItem('magnus.scenario')
  }

  function saveScenario() {
    const saved: SavedScenario = {
      version: 1,
      scenario,
      sceneVisible,
      sceneOrigin,
      sceneRotation,
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
    const stage = roadStageRef.current
    const canvas = stage?.querySelector<SVGSVGElement>('.road-canvas')
    const activeTransform = selectedSectionTransform ?? {
      x: sceneOrigin.x + sceneAnchorX,
      y: sceneOrigin.y + sceneAnchorY,
      rotation: sceneRotation,
    }
    const stageBounds = stage?.getBoundingClientRect()
    const visibleCenter = stage && stageBounds && canvas
      ? clientToScenePoint(
          {
            x: stageBounds.left + stage.clientWidth / 2,
            y: stageBounds.top + stage.clientHeight / 2,
          },
          canvas.getBoundingClientRect(),
          sceneViewBox,
        )
      : { x: activeTransform.x, y: activeTransform.y }
    const localCenter = scenePointToLocal(
      visibleCenter,
      activeTransform,
      { x: sceneAnchorX, y: sceneAnchorY },
    )
    const equipment: DeployedEquipment = {
      id: `${definitionId}-${crypto.randomUUID()}`,
      definitionId,
      x: localCenter.x,
      y: localCenter.y,
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
    if ((!dragging || mode === 'gospel') && !draggingEquipmentId && !draggingTruckId && !rotatingEquipmentRef.current) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scenePoint = clientToScenePoint(
      { x: event.clientX, y: event.clientY },
      bounds,
      sceneViewBox,
    )
    const activeTransform = selectedSectionTransform ?? {
      x: sceneOrigin.x + sceneAnchorX,
      y: sceneOrigin.y + sceneAnchorY,
      rotation: sceneRotation,
    }
    const localPoint = scenePointToLocal(scenePoint, activeTransform, { x: sceneAnchorX, y: sceneAnchorY })
    if (dragging && mode !== 'gospel') {
      const x = Math.max(6, Math.min(roadScene.viewport.width - 6, localPoint.x))
      const y = Math.max(30, Math.min(roadScene.viewport.height - 30, localPoint.y))
      setPoints((current) => current.map((point) => (point.id === dragging ? { ...point, x, y } : point)))
    }
    if (draggingEquipmentId) {
      const item = deployedEquipment.find((equipment) => equipment.id === draggingEquipmentId)
      if (!item) return
      const definition = equipmentDefinition(item.definitionId)
      const x = Math.max(definition.width / 2, Math.min(roadScene.viewport.width - definition.width / 2, localPoint.x))
      const y = Math.max(definition.length / 2, Math.min(roadScene.viewport.height - definition.length / 2, localPoint.y))
      updateDeployedEquipment(item.id, { x, y })
    }
    if (draggingTruckId) {
      const x = Math.max(RIGHT_LANE_STANDARD.truck.width / 2, Math.min(roadScene.viewport.width - RIGHT_LANE_STANDARD.truck.width / 2, localPoint.x))
      const y = Math.max(RIGHT_LANE_STANDARD.truck.halfLength, Math.min(roadScene.viewport.height - RIGHT_LANE_STANDARD.truck.halfLength, localPoint.y))
      setTrucks((current) => current.map((truck) => truck.id === draggingTruckId ? { ...truck, x, y } : truck))
    }
    const rotating = rotatingEquipmentRef.current
    if (rotating) {
      const item = deployedEquipment.find((equipment) => equipment.id === rotating.id)
      if (!item) return
      const angle = Math.atan2(localPoint.y - item.y, localPoint.x - item.x) * 180 / Math.PI
      updateDeployedEquipment(item.id, {
        rotation: Math.round(rotating.startRotation + angle - rotating.startAngle),
      })
    }
  }

  function beginEquipmentRotation(event: React.PointerEvent<SVGCircleElement>, item: DeployedEquipment) {
    event.stopPropagation()
    const canvas = event.currentTarget.ownerSVGElement
    if (!canvas) return
    const scenePoint = clientToScenePoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
      sceneViewBox,
    )
    const activeTransform = selectedSectionTransform ?? {
      x: sceneOrigin.x + sceneAnchorX,
      y: sceneOrigin.y + sceneAnchorY,
      rotation: sceneRotation,
    }
    const localPoint = scenePointToLocal(scenePoint, activeTransform, { x: sceneAnchorX, y: sceneAnchorY })
    rotatingEquipmentRef.current = {
      id: item.id,
      startAngle: Math.atan2(localPoint.y - item.y, localPoint.x - item.x) * 180 / Math.PI,
      startRotation: item.rotation,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedEquipmentId(item.id)
    setSelectedTruckId('')
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

  function setCenteredSceneZoom(nextZoom: number) {
    const stage = roadStageRef.current
    const zoom = clampSceneZoom(nextZoom, maximumSceneZoom)
    if (stage) {
      pendingZoomCenterRef.current = {
        x: (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth,
        y: (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight,
        zoom,
      }
    }
    setSceneZoom(zoom)
  }

  function changeSceneZoom(direction: -1 | 1) {
    setCenteredSceneZoom(
      sceneZoom * (direction > 0 ? SCENE_ZOOM_FACTOR : 1 / SCENE_ZOOM_FACTOR),
    )
  }

  function scenePointerCenter() {
    const pointers = [...panPointersRef.current.values()]
    if (pointers.length === 0) return { x: 0, y: 0 }
    return {
      x: pointers.reduce((sum, pointer) => sum + pointer.x, 0) / pointers.length,
      y: pointers.reduce((sum, pointer) => sum + pointer.y, 0) / pointers.length,
    }
  }

  function startScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    panPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (panPointersRef.current.size === 3) {
      setDragging(null)
      threeFingerPanStartRef.current = {
        center: scenePointerCenter(),
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
      }
    } else if (panPointersRef.current.size > 3) {
      threeFingerPanStartRef.current = null
    }
  }

  function moveScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!panPointersRef.current.has(event.pointerId)) return
    panPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!threeFingerPanStartRef.current || panPointersRef.current.size !== 3 || gestureFrameRef.current !== null) return
    event.preventDefault()
    const stage = event.currentTarget
    gestureFrameRef.current = requestAnimationFrame(() => {
      gestureFrameRef.current = null
      const panStart = threeFingerPanStartRef.current
      if (!panStart || panPointersRef.current.size !== 3) return
      const center = scenePointerCenter()
      stage.scrollTo({
        left: panStart.scrollLeft + panStart.center.x - center.x,
        top: panStart.scrollTop + panStart.center.y - center.y,
      })
    })
  }

  function endScenePointer(event: React.PointerEvent<HTMLDivElement>) {
    panPointersRef.current.delete(event.pointerId)
    if (panPointersRef.current.size === 3) {
      threeFingerPanStartRef.current = {
        center: scenePointerCenter(),
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
      }
    } else {
      threeFingerPanStartRef.current = null
      if (gestureFrameRef.current !== null) cancelAnimationFrame(gestureFrameRef.current)
      gestureFrameRef.current = null
    }
  }

  function zoomSceneWithTrackpad(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    if (event.ctrlKey) {
      setCenteredSceneZoom(sceneZoom * Math.exp(-event.deltaY * 0.01))
      return
    }
    event.currentTarget.scrollBy({ left: event.deltaX, top: event.deltaY })
  }

  async function loadRoadLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateRoadLocation(locationRequest)
    setLocationErrors(errors)
    if (errors.length > 0) return

    setLocationLoading(true)
    const resolution = ++locationResolutionRef.current
    const resolved = await resolveRoadLocation(locationRequest, undefined, appSettings.connectivityMode)
    if (resolution !== locationResolutionRef.current) return
    setRoadScene(resolved.scene)
    const placement = laterallyAlignedPlacement(centeredRoadPlacement(resolved.scene), scenario)
    if (placement) {
      setSceneOrigin({ x: placement.x - sceneAnchorX, y: placement.y - sceneAnchorY })
      setSceneRotation(placement.rotation)
    }
    setResolvedLocation(resolved)
    setSelectedRoadSectionId(null)
    setSectionSelectionEnabled(false)
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
        <div className="connectivity-switch" role="group" aria-label="Map connectivity">
          {connectivityModes.map((item) => {
            const Icon = item.icon
            return <button type="button" aria-pressed={appSettings.connectivityMode === item.id} key={item.id} onClick={() => selectConnectivityMode(item.id)}><Icon size={14} /><span>{item.label}</span></button>
          })}
        </div>
        <div className="zoom-controls topbar-zoom" role="group" aria-label="Scene zoom">
          <button type="button" title="Zoom out" aria-label="Zoom out highway graphic" disabled={sceneZoom <= MIN_SCENE_ZOOM} onClick={() => changeSceneZoom(-1)}><Minus size={17} /></button>
          <button className="zoom-value" type="button" title="Reset to 320 foot view" aria-label={`Reset highway graphic zoom, currently ${Math.round(sceneVisibleWidth)} feet wide`} onClick={() => setCenteredSceneZoom(defaultSceneZoom)}>{Math.round(sceneVisibleWidth)} FT</button>
          <button type="button" title="Zoom in" aria-label="Zoom in highway graphic" disabled={sceneZoom >= maximumSceneZoom} onClick={() => changeSceneZoom(1)}><Plus size={17} /></button>
        </div>
        <div className="settings-anchor">
          <button className="icon-button" type="button" title="Settings" aria-label="Open settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings size={18} /></button>
          {settingsOpen && <section className="settings-popover" aria-label="Settings">
            <div className="settings-heading"><div><span>Magnus preferences</span><h2>Settings</h2></div><button type="button" title="Close settings" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={17} /></button></div>
            <div className="settings-section">
              <div className="settings-section-title"><Wifi size={15} /><span>Map connection</span></div>
              <div className="settings-mode-options" role="radiogroup" aria-label="Map connection mode">{connectivityModes.map((item) => <button type="button" role="radio" aria-checked={appSettings.connectivityMode === item.id} key={item.id} onClick={() => selectConnectivityMode(item.id)}>{item.label}</button>)}</div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title"><Palette size={15} /><span>Theme</span></div>
              <div className="theme-options">{themeIds.map((id) => {
                const custom = id.startsWith('custom') ? appSettings.customThemes[id as keyof typeof appSettings.customThemes] : null
                const label = id === 'dark' ? 'Dark' : id === 'light' ? 'Light' : custom?.name
                const color = id === 'dark' ? '#1d2522' : id === 'light' ? '#eef2f0' : custom?.color
                return <button type="button" aria-pressed={appSettings.theme === id} key={id} onClick={() => selectTheme(id)}><span className="theme-swatch" style={{ background: color }} /><span>{label}</span></button>
              })}</div>
              {appSettings.theme.startsWith('custom') && (() => {
                const id = appSettings.theme as keyof typeof appSettings.customThemes
                return <div className="theme-editor"><input aria-label="Custom theme color" type="color" value={appSettings.customThemes[id].color} onChange={(event) => updateCustomTheme(id, { color: event.target.value })} /><input aria-label="Custom theme name" maxLength={24} value={appSettings.customThemes[id].name} onChange={(event) => updateCustomTheme(id, { name: event.target.value })} /></div>
              })()}
            </div>
            <div className="settings-section offline-preparation">
              <div className="settings-section-title"><HardDrive size={15} /><span>Offline preparation</span></div>
              <div className="offline-summary"><span>{offlineStatus?.cachedScenes ?? 0} prepared scenes</span><b>{formatStorageSize(offlineStatus?.cacheBytes ?? 0)}</b></div>
              <div className="offline-regions">{offlineStatus?.regions.map((region) => <div key={region.id}><span><b>{region.label}</b><small>{region.installed ? formatStorageSize(region.bytes) : 'Not installed'}</small></span><button type="button" disabled={offlinePreparing !== null} onClick={() => { void prepareRegion(region.id) }}>{offlinePreparing === region.id ? <LoaderCircle className="location-spinner" size={14} /> : region.installed ? <RefreshCw size={14} /> : <Download size={14} />}<span>{region.installed ? 'Refresh' : 'Prepare'}</span></button></div>)}</div>
              {offlineStatusMessage && <p className="offline-status-message" role="status">{offlineStatusMessage}</p>}
            </div>
          </section>}
        </div>
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
            <div><span className="eyebrow">Vector scene · {roadScene.source.type.replaceAll('-', ' ')}</span><div className="scene-heading-row"><h1>{sceneVisible ? selectedScenario.heading : scenePlacementActive ? `Place ${selectedScenario.label.toLowerCase()}` : 'Roadway only'}</h1>{sceneVisible && <ArrowUp className="traffic-direction-arrow" style={{ transform: `rotate(${effectiveSceneRotation}deg)` }} size={19} aria-label="Traffic flow bearing" />}</div><small className="scene-dataset">{roadScene.source.dataset}</small></div>
            <div className="canvas-tools">
              <div className="scale-key"><span /> 40 FT</div>
            </div>
          </div>
          <div className="road-stage" ref={roadStageRef} data-zoom={sceneZoom} onPointerDown={startScenePointer} onPointerMove={moveScenePointer} onPointerUp={endScenePointer} onPointerCancel={endScenePointer} onWheel={zoomSceneWithTrackpad}>
            <div className="road-canvas-surface" style={sceneCanvasSize}>
            <svg className={`road-canvas${scenePlacementActive ? ' placing-scene' : ''}`} viewBox={sceneViewBoxValue} role="img" aria-label="Top-down highway scene with SSP vehicle and traffic cones" data-visible-width-feet={Math.round(sceneVisibleWidth)} data-zoom={sceneZoom} onPointerDown={placeScene} onPointerMove={moveCone} onPointerUp={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null); rotatingEquipmentRef.current = null }} onPointerLeave={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null); rotatingEquipmentRef.current = null }}>
              <g className="map-world" transform={mapTransform}>
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
                <g className={`cone ${mode === 'gospel' ? 'locked' : ''}`} data-cone-id={point.id} key={point.id} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => { if (mode === 'gospel') return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(point.id) }}>
                  <rect className="cone-hit-area" x="-4" y="-4" width="8" height="8" />
                  <SceneEquipmentGlyph definition={setupConeDefinition} />
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
                  {item.id === selectedEquipmentId && isEquipmentRotatable(definition) && <circle className="equipment-rotation-handle" aria-label={`Rotate ${definition.label}`} cx={definition.width / 2 + 2} cy={-definition.length / 2 - 2} r="2.2" onPointerDown={(event) => beginEquipmentRotation(event, item)} />}
                </g>
              })}
              </g>}
              </g>
            </svg>
            </div>
            <div className={`canvas-hint${scenePlacementActive ? ' placement-active' : ''}`}>{scenePlacementActive ? <><MousePointer2 size={15} /> Tap roadway to place {selectedScenario.label.toLowerCase()}</> : !sceneVisible ? <><Navigation size={15} /> Roadway only</> : sectionSelectionEnabled ? <><MousePointer2 size={15} /> Select a roadway section</> : mode === 'gospel' ? <><ShieldCheck size={15} /> Positions locked to Standard SOP</> : <><Navigation size={15} /> Drag cones to adapt the scene</>}</div>
          </div>
          <MapCompass rotation={mapRotation} />
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
          <section className="roadway-controls" aria-label="Roadway and map controls">
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
