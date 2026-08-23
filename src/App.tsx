import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  FolderOpen,
  HardDrive,
  Layers3,
  LoaderCircle,
  MapPinned,
  MonitorUp,
    Network,
    Palette,
  Minus,
  MousePointer2,
  Navigation,
  Pencil,
  PencilRuler,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScreenShare,
  Settings,
  ShieldCheck,
  TrafficCone,
  Truck,
  Undo2,
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
import { releaseVersionLabel } from './domain/appVersion'
import {
  buildInitialRadioExchange,
  DEFAULT_TOC_INCIDENT_DETAILS,
  INCIDENT_TYPE_OPTIONS,
  type CommunicationDirection,
  type IncidentType,
  type TocIncidentDetails,
  type YesNoUnknown,
} from './domain/communications'
import {
  createPortableScenario,
  parsePortableScenario,
  type PortableScenarioState,
} from './domain/scenarioFile'
import {
  sampleStrokePoint,
  strokeExpiresAt,
  strokePoints,
  type DrawingPersistence,
  type DrawingStroke,
} from './domain/drawing'
import { RoadwayLabels, RoadwayLayer } from './components/RoadwayLayer'
import { SceneDesigner } from './components/SceneDesigner'
import { SceneEquipmentGlyph } from './components/SceneEquipmentGlyph'
import {
  EQUIPMENT_CATALOG,
  TOOLKIT_CATEGORIES,
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
  type SspTruckState,
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
const communicationDirections = travelDirections.filter(
  (direction): direction is { value: CommunicationDirection; label: string } => direction.value !== 'all',
)
const yesNoOptions: { value: YesNoUnknown; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]
const impactedLaneOptions = [
  { value: 'all lanes', label: 'All lanes' },
  { value: 'multiple lanes', label: 'Multiple lanes' },
  { value: 'the left lane', label: 'Left lane' },
  { value: 'the center lane', label: 'Center lane' },
  { value: 'the right lane', label: 'Right lane' },
  { value: 'the right shoulder', label: 'Right shoulder' },
]
const appReleaseVersion = releaseVersionLabel(__APP_VERSION__)

type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'
type SaveStatus = 'idle' | 'saved'
type SceneImageFormat = 'png' | 'jpg' | 'svg'

interface WritableFileHandle {
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>
}

interface SceneDirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<WritableFileHandle>
}

interface OpenFileHandle { getFile(): Promise<File> }

type FilePickerWindow = Window & {
  showDirectoryPicker?: () => Promise<SceneDirectoryHandle>
  showOpenFilePicker?: (options: object) => Promise<OpenFileHandle[]>
}

interface PresentationScreen {
  availHeight: number
  availLeft: number
  availTop: number
  availWidth: number
}

type PresentationWindow = Window & {
  getScreenDetails?: () => Promise<{
    currentScreen: PresentationScreen
    screens: PresentationScreen[]
  }>
}

const DEFAULT_LOCATION_REQUEST: RoadLocationRequest = {
  highway: 'I-95',
  direction: 'northbound',
  referenceType: 'mile-marker',
  reference: '170',
}

interface LegacySavedScenario {
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

function loadSavedScenario(): PortableScenarioState | null {
  try {
    const stored = localStorage.getItem('magnus.scenario')
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) return parsePortableScenario(stored).state
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1) return null
    const scenario = parsed as Partial<LegacySavedScenario>
    return scenario.scenario && scenario.mode && typeof scenario.laneCount === 'number'
      && Array.isArray(scenario.points) && Array.isArray(scenario.trucks)
      && Array.isArray(scenario.deployedEquipment) && Array.isArray(scenario.radioEvents)
      ? {
          ...scenario as LegacySavedScenario,
          sceneVisible: scenario.sceneVisible ?? true,
          sceneOrigin: scenario.sceneOrigin ?? { x: 0, y: 0 },
          sceneRotation: scenario.sceneRotation ?? 0,
          mapRotation: 0,
          drawingStrokes: [],
          incidentType: 'crash',
          tocIncidentDetails: DEFAULT_TOC_INCIDENT_DETAILS,
          roadScene: createDevelopmentRoadScene(),
          locationRequest: DEFAULT_LOCATION_REQUEST,
          resolvedLocation: null,
          roadLayerVisibility: { roadGeometry: true, barriers: true, trafficFlow: true, highwayLabels: true, drawings: true },
          sceneZoom: 1,
        }
      : null
  } catch {
    return null
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function scenarioStateSnapshot(state: PortableScenarioState): string {
  return JSON.stringify({
    scenario: state.scenario,
    sceneVisible: state.sceneVisible,
    sceneOrigin: state.sceneOrigin,
    sceneRotation: state.sceneRotation,
    mapRotation: state.mapRotation,
    mode: state.mode,
    laneCount: state.laneCount,
    points: state.points,
    trucks: state.trucks,
    deployedEquipment: state.deployedEquipment,
    drawingStrokes: state.drawingStrokes,
    radioEvents: state.radioEvents,
    incidentType: state.incidentType,
    tocIncidentDetails: state.tocIncidentDetails,
    roadScene: state.roadScene,
    locationRequest: state.locationRequest,
    resolvedLocation: state.resolvedLocation,
    roadLayerVisibility: state.roadLayerVisibility,
    sceneZoom: state.sceneZoom,
  })
}

async function writeFile(directory: SceneDirectoryHandle, fileName: string, data: Blob | string) {
  const handle = await directory.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

function pageStyles(): string {
  return Array.from(document.styleSheets).map((sheet) => {
    try {
      return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')
    } catch {
      return ''
    }
  }).join('\n')
}

async function rasterizeSvg(svg: Blob, format: Exclude<SceneImageFormat, 'svg'>): Promise<Blob> {
  const url = URL.createObjectURL(svg)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Image export is unavailable.')
    if (format === 'jpg') {
      context.fillStyle = '#4f5c48'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Image export failed.')),
      format === 'jpg' ? 'image/jpeg' : 'image/png',
      0.94,
    ))
  } finally {
    URL.revokeObjectURL(url)
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
      {message === 'double-diamonds' ? <>
        <path className="signboard-symbol signboard-frame-a" d="M -25 0 L -16 -9 L -7 0 L -16 9 Z" />
        <path className="signboard-symbol signboard-frame-b" d="M 7 0 L 16 -9 L 25 0 L 16 9 Z" />
      </> : symbolPath && <path className={`signboard-symbol${message.endsWith('arrow') ? ' signboard-flash' : ''}`} d={symbolPath} />}
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

function compactRouteReference(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function centeredRoadPlacement(scene: RoadScene, highway: string) {
  const requestedReference = compactRouteReference(highway)
  const matchingFeatures = scene.source.type === 'development-fixture' ? [] : scene.features.filter(
    (feature) => feature.properties.reference
      ?.split(';')
      .some((reference) => compactRouteReference(reference) === requestedReference),
  )
  const placementScene = matchingFeatures.length > 0 ? { ...scene, features: matchingFeatures } : scene
  return nearestRoadPlacement(placementScene, {
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
  const [roadScene, setRoadScene] = useState<RoadScene>(() => savedScenario?.roadScene ?? createDevelopmentRoadScene())
  const [locationRequest, setLocationRequest] = useState<RoadLocationRequest>(savedScenario?.locationRequest ?? DEFAULT_LOCATION_REQUEST)
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedRoadLocation | null>(savedScenario?.resolvedLocation ?? null)
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [locationLoading, setLocationLoading] = useState(!savedScenario)
  const [sectionSelectionEnabled, setSectionSelectionEnabled] = useState(false)
  const [selectedRoadSectionId, setSelectedRoadSectionId] = useState<string | null>(null)
  const [scenario, setScenario] = useState<ScenarioType>(savedScenario?.scenario ?? 'right-lane')
  const [sceneVisible, setSceneVisible] = useState(savedScenario?.sceneVisible ?? true)
  const [scenePlacementActive, setScenePlacementActive] = useState(false)
  const [sceneOrigin, setSceneOrigin] = useState(savedScenario?.sceneOrigin ?? { x: 0, y: 0 })
  const [sceneRotation, setSceneRotation] = useState(savedScenario?.sceneRotation ?? 0)
  const [mapRotation, setMapRotation] = useState(savedScenario?.mapRotation ?? 0)
  const [mode, setMode] = useState<ComplianceMode>(savedScenario?.mode ?? 'gospel')
  const [laneCount, setLaneCount] = useState(savedScenario?.laneCount ?? 3)
  const [points, setPoints] = useState<ScenePoint[]>(() => savedScenario?.points ?? createScene('right-lane'))
  const [trucks, setTrucks] = useState(() => savedScenario?.trucks ?? createSspTrucks())
  const [selectedTruckId, setSelectedTruckId] = useState('ssp-truck-1')
  const [selectedConeId, setSelectedConeId] = useState<string | null>(null)
  const [draggingTruckId, setDraggingTruckId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [deployedEquipment, setDeployedEquipment] = useState<DeployedEquipment[]>(savedScenario?.deployedEquipment ?? [])
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null)
  const [draggingEquipmentId, setDraggingEquipmentId] = useState<string | null>(null)
  const rotatingEquipmentRef = useRef<{ id: string; startAngle: number; startRotation: number } | null>(null)
  const rotatingTruckRef = useRef<{ id: string; startAngle: number; startRotation: number } | null>(null)
  const [activeToolkit, setActiveToolkit] = useState<ToolkitCategory>('ssp-asset')
  const [sceneTypeOpen, setSceneTypeOpen] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const [sceneZoom, setSceneZoom] = useState(savedScenario?.sceneZoom ?? 1)
  const [sceneDisplaySize, setSceneDisplaySize] = useState({ width: 1, height: 1 })
  const [designerOpen, setDesignerOpen] = useState(false)
  const [spatialServiceStatus, setSpatialServiceStatus] = useState<SpatialServiceStatus>('checking')
  const [drawingMenuOpen, setDrawingMenuOpen] = useState(false)
  const [drawingActive, setDrawingActive] = useState(false)
  const [drawingColor, setDrawingColor] = useState('#ffd21f')
  const [drawingWidth, setDrawingWidth] = useState(4)
  const [drawingPersistence, setDrawingPersistence] = useState<DrawingPersistence>('persistent')
  const [drawingLifetime, setDrawingLifetime] = useState(10)
  const [drawingStrokes, setDrawingStrokes] = useState<DrawingStroke[]>(savedScenario?.drawingStrokes ?? [])
  const [temporaryDrawingStrokes, setTemporaryDrawingStrokes] = useState<DrawingStroke[]>([])
  const [activeDrawingStroke, setActiveDrawingStroke] = useState<DrawingStroke | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() => savedScenario ? scenarioStateSnapshot(savedScenario) : null)
  const roadStageRef = useRef<HTMLDivElement>(null)
  const loadSceneInputRef = useRef<HTMLInputElement>(null)
  const leftPaneRestoreRef = useRef<HTMLButtonElement>(null)
  const rightPaneRestoreRef = useRef<HTMLButtonElement>(null)
  const locationResolutionRef = useRef(0)
  const panPointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureFrameRef = useRef<number | null>(null)
  const drawingStrokeRef = useRef<DrawingStroke | null>(null)
  const drawingPointerIdRef = useRef<number | null>(null)
  const threeFingerPanStartRef = useRef<{
    center: { x: number; y: number }
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const initializedZoomSceneRef = useRef<RoadScene | null>(savedScenario?.roadScene ?? null)
  const pendingZoomCenterRef = useRef<{ worldX: number; worldY: number; zoom: number } | null>(savedScenario ? {
    worldX: savedScenario.roadScene.viewport.width / 2,
    worldY: savedScenario.roadScene.viewport.height / 2,
    zoom: savedScenario.sceneZoom,
  } : null)
  const [roadLayerVisibility, setRoadLayerVisibility] = useState<RoadLayerVisibility>(savedScenario?.roadLayerVisibility ?? {
    roadGeometry: true,
    barriers: true,
    trafficFlow: true,
    highwayLabels: true,
    drawings: true,
  })
  const [radioEvents, setRadioEvents] = useState(savedScenario?.radioEvents ?? [])
  const [incidentType, setIncidentType] = useState<IncidentType>(savedScenario?.incidentType ?? 'crash')
  const [tocIncidentDetails, setTocIncidentDetails] = useState<TocIncidentDetails>(savedScenario?.tocIncidentDetails ?? DEFAULT_TOC_INCIDENT_DETAILS)

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
    'all-lanes',
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
  const fortyFootScalePixels = 40 * sceneCanvasSize.width / sceneViewBox.width
  const roadSections = selectableRoadSections(roadScene)
  const selectedRoadSection = roadSections.find((feature) => feature.id === selectedRoadSectionId)
  const selectedSectionTransform = selectedRoadSection
    ? roadSectionTransform(selectedRoadSection)
    : null
  const equipmentTransform = selectedSectionTransform
    ? `translate(${selectedSectionTransform.x} ${selectedSectionTransform.y}) rotate(${selectedSectionTransform.rotation}) translate(${scenarioLateralOffset(scenario, selectedRoadSection?.properties.lanes)} ${0}) translate(${-RIGHT_LANE_STANDARD.roadCenterX} ${-RIGHT_LANE_STANDARD.truck.y})`
    : undefined
  const selectedTruck = trucks.find((truck) => truck.id === selectedTruckId) ?? null
  const selectedEquipment = deployedEquipment.find((item) => item.id === selectedEquipmentId)
  const selectedEquipmentDefinition = selectedEquipment
    ? equipmentDefinition(selectedEquipment.definitionId)
    : null
  const selectedEquipmentWidth = selectedEquipment && selectedEquipmentDefinition
    ? selectedEquipment.width ?? selectedEquipmentDefinition.width
    : 0
  const selectedEquipmentLength = selectedEquipment && selectedEquipmentDefinition
    ? selectedEquipment.length ?? selectedEquipmentDefinition.length
    : 0
  const setupConeDefinition = equipmentDefinition('cone')
  const deployedCounts = sceneCounts(
    sceneVisible ? deployedEquipment : [],
    sceneVisible ? trucks.length : 0,
    sceneVisible ? points.length : 0,
  )
  const catalogBaselineCounts = {
    cone: sceneVisible ? points.length : 0,
    'ssp-truck': sceneVisible ? trucks.filter((truck) => truck.assetType === 'ssp-truck').length : 0,
    'lane-blade-truck': sceneVisible ? trucks.filter((truck) => truck.assetType === 'lane-blade-truck').length : 0,
  }
  const selectedScenario = scenarioDefinition(scenario)
  const highwayLabelsAvailable = roadScene.source.type !== 'development-fixture'
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
  const scenarioSnapshot = scenarioStateSnapshot(currentScenarioState())
  const hasUnsavedChanges = savedSnapshot !== null && savedSnapshot !== scenarioSnapshot

  useEffect(() => {
    if (locationLoading || savedSnapshot !== null) return
    const frame = requestAnimationFrame(() => setSavedSnapshot(scenarioSnapshot))
    return () => cancelAnimationFrame(frame)
  }, [locationLoading, savedSnapshot, scenarioSnapshot])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    if (temporaryDrawingStrokes.length === 0) return
    const nextExpiration = Math.min(...temporaryDrawingStrokes.map((stroke) => strokeExpiresAt(stroke) ?? Number.POSITIVE_INFINITY))
    const timeout = window.setTimeout(() => {
      const now = Date.now()
      setTemporaryDrawingStrokes((current) => current.filter(
        (stroke) => (strokeExpiresAt(stroke) ?? Number.POSITIVE_INFINITY) > now,
      ))
    }, Math.max(0, nextExpiration - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [temporaryDrawingStrokes])

  useEffect(() => {
    saveAppSettings(localStorage, appSettings)
    const tokens = themeTokens(appSettings.theme, appSettings.customThemes)
    document.documentElement.dataset.theme = tokens.scheme
    document.documentElement.style.setProperty('--theme-accent', tokens.accent)
  }, [appSettings])

  useEffect(() => {
    function deleteSelectedItem(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return

      if (selectedEquipmentId) {
        setDeployedEquipment((current) => current.filter((item) => item.id !== selectedEquipmentId))
        setSelectedEquipmentId(null)
      } else if (selectedConeId) {
        setPoints((current) => current.filter((point) => point.id !== selectedConeId))
        setSelectedConeId(null)
      } else if (selectedTruckId) {
        setTrucks((current) => current.filter((truck) => truck.id !== selectedTruckId))
        setSelectedTruckId('')
      } else {
        return
      }
      event.preventDefault()
    }

    document.addEventListener('keydown', deleteSelectedItem)
    return () => document.removeEventListener('keydown', deleteSelectedItem)
  }, [selectedConeId, selectedEquipmentId, selectedTruckId])

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
      worldX: roadScene.viewport.width / 2,
      worldY: roadScene.viewport.height / 2,
      zoom: defaultSceneZoom,
    }
    setSceneZoom(defaultSceneZoom)
  }, [defaultSceneZoom, roadScene, sceneDisplaySize, sceneViewBox.x, sceneViewBox.y, sceneViewBox.width, sceneViewBox.height, sceneFocusX, sceneFocusY])

  useEffect(() => {
    const stage = roadStageRef.current
    const pendingCenter = pendingZoomCenterRef.current
    if (!stage || pendingCenter?.zoom !== sceneZoom) return
    if (sceneDisplaySize.width !== stage.clientWidth || sceneDisplaySize.height !== stage.clientHeight) return
    const frame = requestAnimationFrame(() => {
      const surface = stage.querySelector<HTMLElement>('.road-canvas-surface')
      if (!surface) return
      const normalizedX = (pendingCenter.worldX - sceneViewBox.x) / sceneViewBox.width
      const normalizedY = (pendingCenter.worldY - sceneViewBox.y) / sceneViewBox.height
      stage.scrollTo({
        left: Math.max(0, surface.offsetLeft + normalizedX * surface.clientWidth - stage.clientWidth / 2),
        top: Math.max(0, surface.offsetTop + normalizedY * surface.clientHeight - stage.clientHeight / 2),
      })
      pendingZoomCenterRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [roadScene, sceneDisplaySize, sceneViewBox, sceneZoom])

  useEffect(() => {
    let active = true
    void probeSpatialService().then((available) => {
      if (active) setSpatialServiceStatus(available ? 'connected' : 'unavailable')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    if (savedScenario) {
      return () => { active = false }
    }
    const resolution = ++locationResolutionRef.current
    void resolveRoadLocation(DEFAULT_LOCATION_REQUEST, undefined, appSettings.connectivityMode).then((resolved) => {
      if (!active || resolution !== locationResolutionRef.current) return
      setRoadScene(resolved.scene)
      const initialScenario = 'right-lane'
      const placement = laterallyAlignedPlacement(
        centeredRoadPlacement(resolved.scene, resolved.request.highway),
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

  async function presentOnExternalDisplay() {
    const stage = roadStageRef.current
    if (!stage) {
      window.alert('The Magnus scene is not ready to present.')
      return
    }
    const presentation = window.open('', 'magnus-presentation', 'popup,width=1280,height=720')
    if (!presentation) {
      window.alert('Allow pop-up windows to present Magnus on an external display.')
      return
    }
    try {
      const screenWindow = window as PresentationWindow
      if (screenWindow.getScreenDetails) {
        try {
          const details = await screenWindow.getScreenDetails()
          const externalScreen = details.screens.find((screen) => screen !== details.currentScreen)
          if (externalScreen) {
            presentation.moveTo(externalScreen.availLeft, externalScreen.availTop)
            presentation.resizeTo(externalScreen.availWidth, externalScreen.availHeight)
          }
        } catch {
          // The presentation remains usable when window-placement permission is denied.
        }
      }

      presentation.document.head.replaceChildren(...Array.from(document.head.children).map((node) => node.cloneNode(true)))
      presentation.document.title = 'Magnus Presentation'
      presentation.document.body.replaceChildren()
      presentation.document.body.style.cssText = 'margin:0;overflow:hidden;background:#101614;'
      const presentationStyle = presentation.document.createElement('style')
      presentationStyle.textContent = '.road-stage{width:100vw!important;height:100vh!important;max-height:none!important;border:0!important}.road-stage-controls{display:none!important}'
      presentation.document.head.append(presentationStyle)

      let renderFrame: number | null = null
      const renderPresentation = () => {
        if (presentation.closed) return
        presentation.document.documentElement.dataset.theme = document.documentElement.dataset.theme
        presentation.document.documentElement.style.cssText = document.documentElement.style.cssText
        presentation.document.body.replaceChildren(stage.cloneNode(true))
      }
      const scheduleRender = () => {
        if (renderFrame !== null || presentation.closed) return
        renderFrame = window.requestAnimationFrame(() => {
          renderFrame = null
          renderPresentation()
        })
      }
      renderPresentation()
      const observer = new MutationObserver(scheduleRender)
      observer.observe(stage, { attributes: true, childList: true, characterData: true, subtree: true })
      presentation.addEventListener('beforeunload', () => {
        observer.disconnect()
        if (renderFrame !== null) window.cancelAnimationFrame(renderFrame)
      }, { once: true })
    } catch (error) {
      presentation.close()
      window.alert(error instanceof Error ? `Magnus could not start presentation mode: ${error.message}` : 'Magnus could not start presentation mode.')
    }
  }

  function changeScenario(nextScenario: ScenarioType) {
    setScenario(nextScenario)
    setPoints(createScene(nextScenario))
    setTrucks(createScenarioTrucks(nextScenario))
    setSelectedTruckId('ssp-truck-1')
    setDeployedEquipment([])
    setDrawingStrokes([])
    setTemporaryDrawingStrokes([])
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
    const point = clientToMapPoint(
      { x: event.clientX, y: event.clientY },
      bounds,
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
    setDrawingStrokes([])
    setTemporaryDrawingStrokes([])
    cancelDrawingStroke()
    setSelectedEquipmentId(null)
    setRadioEvents([])
    setSceneVisible(true)
    setScenePlacementActive(false)
    setSceneOrigin({ x: 0, y: 0 })
    setSceneRotation(0)
    setMapRotation(0)
    setSaveStatus('idle')
    localStorage.removeItem('magnus.scenario')
  }

  function currentScenarioState(): PortableScenarioState {
    return {
      scenario,
      sceneVisible,
      sceneOrigin,
      sceneRotation,
      mapRotation,
      mode,
      laneCount,
      points,
      trucks,
      deployedEquipment,
      drawingStrokes,
      radioEvents,
      incidentType,
      tocIncidentDetails,
      roadScene,
      locationRequest,
      resolvedLocation,
      roadLayerVisibility,
      sceneZoom,
    }
  }

  function serializeSceneSvg(): Blob {
    const source = roadStageRef.current?.querySelector<SVGSVGElement>('.road-canvas')
    if (!source) throw new Error('Scene canvas is unavailable.')
    const clone = source.cloneNode(true) as SVGSVGElement
    clone.querySelectorAll('.equipment-rotation-handle, .road-section-hit-area, .drawing-hit-area, .drawing-stroke.temporary').forEach((element) => element.remove())
    clone.querySelectorAll('.selected').forEach((element) => element.classList.remove('selected'))
    clone.querySelectorAll('[tabindex], [role="button"]').forEach((element) => {
      element.removeAttribute('tabindex')
      element.removeAttribute('role')
    })
    const [, , viewBoxWidth, viewBoxHeight] = sceneViewBoxValue.split(' ').map(Number)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', '1600')
    clone.setAttribute('height', String(Math.round(1600 * viewBoxHeight / viewBoxWidth)))
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = pageStyles()
    clone.prepend(style)
    return new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
  }

  async function saveScene(format: SceneImageFormat) {
    setSaveMenuOpen(false)
    const portable = createPortableScenario(currentScenarioState(), __APP_VERSION__)
    const scenarioJson = JSON.stringify(portable, null, 2)
    localStorage.setItem('magnus.scenario', scenarioJson)
    const svg = serializeSceneSvg()
    const image = format === 'svg' ? svg : await rasterizeSvg(svg, format)
    const safeRoadName = locationRequest.highway.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'roadway'
    const baseName = `magnus-${safeRoadName}-${new Date().toISOString().slice(0, 10)}`
    const picker = window as FilePickerWindow
    try {
      if (picker.showDirectoryPicker) {
        const directory = await picker.showDirectoryPicker()
        await writeFile(directory, `${baseName}.${format}`, image)
        await writeFile(directory, `${baseName}.magnus.json`, scenarioJson)
      } else {
        downloadBlob(image, `${baseName}.${format}`)
        downloadBlob(new Blob([scenarioJson], { type: 'application/json' }), `${baseName}.magnus.json`)
      }
      setSavedSnapshot(scenarioSnapshot)
      setSaveStatus('saved')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    }
  }

  function applyScenarioState(state: PortableScenarioState) {
    setSavedSnapshot(scenarioStateSnapshot(state))
    setScenario(state.scenario)
    setSceneVisible(state.sceneVisible)
    setScenePlacementActive(false)
    setSceneOrigin(state.sceneOrigin)
    setSceneRotation(state.sceneRotation)
    setMapRotation(state.mapRotation)
    setMode(state.mode)
    setLaneCount(state.laneCount)
    setPoints(state.points)
    setTrucks(state.trucks)
    setSelectedTruckId(state.trucks[0]?.id ?? '')
    setSelectedConeId(null)
    setDeployedEquipment(state.deployedEquipment)
    setDrawingStrokes(state.drawingStrokes)
    setTemporaryDrawingStrokes([])
    setSelectedEquipmentId(null)
    setRadioEvents(state.radioEvents)
    setIncidentType(state.incidentType)
    setTocIncidentDetails(state.tocIncidentDetails)
    initializedZoomSceneRef.current = state.roadScene
    setRoadScene(state.roadScene)
    setLocationRequest(state.locationRequest)
    setResolvedLocation(state.resolvedLocation)
    setRoadLayerVisibility(state.roadLayerVisibility)
    setSceneZoom(state.sceneZoom)
    setSaveStatus('saved')
    localStorage.setItem('magnus.scenario', JSON.stringify(createPortableScenario(state, __APP_VERSION__)))
  }

  async function exitApplication() {
    if (hasUnsavedChanges && !window.confirm('This scenario has unsaved changes. Exit and discard them?')) return
    try {
      const response = await fetch('/api/exit', { method: 'POST' })
      if (!response.ok) throw new Error(`Exit request returned HTTP ${response.status}`)
      window.close()
      window.setTimeout(() => window.location.replace('about:blank'), 50)
    } catch (error) {
      window.alert(error instanceof Error ? `Magnus could not exit cleanly: ${error.message}` : 'Magnus could not exit cleanly.')
    }
  }

  async function loadScenarioFile(file: File) {
    applyScenarioState(parsePortableScenario(await file.text()).state)
  }

  async function chooseScenarioFile() {
    const picker = window as FilePickerWindow
    if (!picker.showOpenFilePicker) {
      loadSceneInputRef.current?.click()
      return
    }
    try {
      const [handle] = await picker.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Magnus scene', accept: { 'application/json': ['.json'] } }],
      })
      if (handle) await loadScenarioFile(await handle.getFile())
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      throw error
    }
  }

  function addTruck(assetType: SspTruckState['assetType'] = 'ssp-truck') {
    const nextTrucks = addSspTruck(trucks, assetType)
    setTrucks(nextTrucks)
    setSelectedTruckId(nextTrucks.at(-1)?.id ?? selectedTruckId)
  }

  function setSelectedTruckSignboard(signboard: SignboardMessage) {
    if (!selectedTruck) return
    setTrucks((current) => updateTruckSignboard(current, selectedTruck.id, signboard))
  }

  function deployCatalogItem(definitionId: string) {
    if (definitionId === 'ssp-truck' || definitionId === 'lane-blade-truck') {
      addTruck(definitionId)
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
      ? clientToMapPoint(
          {
            x: stageBounds.left + stage.clientWidth / 2,
            y: stageBounds.top + stage.clientHeight / 2,
          },
          canvas.getBoundingClientRect(),
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
    setSelectedConeId(null)
    setSelectedTruckId('')
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
    if ((!dragging || mode === 'gospel') && !draggingEquipmentId && !draggingTruckId && !rotatingEquipmentRef.current && !rotatingTruckRef.current) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const scenePoint = clientToMapPoint(
      { x: event.clientX, y: event.clientY },
      bounds,
    )
    const activeTransform = selectedSectionTransform ?? {
      x: sceneOrigin.x + sceneAnchorX,
      y: sceneOrigin.y + sceneAnchorY,
      rotation: sceneRotation,
    }
    const localPoint = scenePointToLocal(scenePoint, activeTransform, { x: sceneAnchorX, y: sceneAnchorY })
    if (dragging && mode !== 'gospel') {
      setPoints((current) => current.map((point) => (point.id === dragging ? { ...point, ...localPoint } : point)))
    }
    if (draggingEquipmentId) {
      const item = deployedEquipment.find((equipment) => equipment.id === draggingEquipmentId)
      if (!item) return
      updateDeployedEquipment(item.id, localPoint)
    }
    if (draggingTruckId) {
      setTrucks((current) => current.map((truck) => truck.id === draggingTruckId ? { ...truck, ...localPoint } : truck))
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
    const rotatingTruck = rotatingTruckRef.current
    if (rotatingTruck) {
      const truck = trucks.find((item) => item.id === rotatingTruck.id)
      if (!truck) return
      const angle = Math.atan2(localPoint.y - truck.y, localPoint.x - truck.x) * 180 / Math.PI
      setTrucks((current) => current.map((item) => item.id === truck.id ? {
        ...item,
        rotation: Math.round(rotatingTruck.startRotation + angle - rotatingTruck.startAngle),
      } : item))
    }
  }

  function beginEquipmentRotation(event: React.PointerEvent<SVGCircleElement>, item: DeployedEquipment) {
    event.stopPropagation()
    const canvas = event.currentTarget.ownerSVGElement
    if (!canvas) return
    const scenePoint = clientToMapPoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
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

  function beginTruckRotation(event: React.PointerEvent<SVGCircleElement>, truck: SspTruckState) {
    event.stopPropagation()
    const canvas = event.currentTarget.ownerSVGElement
    if (!canvas) return
    const scenePoint = clientToMapPoint(
      { x: event.clientX, y: event.clientY },
      canvas.getBoundingClientRect(),
    )
    const activeTransform = selectedSectionTransform ?? {
      x: sceneOrigin.x + sceneAnchorX,
      y: sceneOrigin.y + sceneAnchorY,
      rotation: sceneRotation,
    }
    const localPoint = scenePointToLocal(scenePoint, activeTransform, { x: sceneAnchorX, y: sceneAnchorY })
    rotatingTruckRef.current = {
      id: truck.id,
      startAngle: Math.atan2(localPoint.y - truck.y, localPoint.x - truck.x) * 180 / Math.PI,
      startRotation: truck.rotation,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedTruckId(truck.id)
    setSelectedEquipmentId(null)
  }

  function addRadioEvent() {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const direction = locationRequest.direction === 'all' ? 'northbound' : locationRequest.direction
    const exchange = buildInitialRadioExchange({
      unit: 'SSP970',
      highway: locationRequest.highway,
      direction,
      referenceType: locationRequest.referenceType,
      reference: locationRequest.reference,
      incidentType,
      details: tocIncidentDetails,
      scenario,
      travelLanes: laneCount,
    })
    setRadioEvents((current) => [...current, ...exchange.map((message) => ({ ...message, time: now }))])
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
    const zoom = clampSceneZoom(nextZoom, maximumSceneZoom)
    rememberViewedCenter(zoom)
    setSceneZoom(zoom)
  }

  function rememberViewedCenter(zoom = sceneZoom) {
    const stage = roadStageRef.current
    if (stage) {
      const canvas = stage.querySelector<SVGSVGElement>('.road-canvas')
      const surface = stage.querySelector<HTMLElement>('.road-canvas-surface')
      if (canvas && surface) {
        const viewBox = canvas.viewBox.baseVal
        pendingZoomCenterRef.current = {
          worldX: viewBox.x + ((stage.scrollLeft + stage.clientWidth / 2 - surface.offsetLeft) / surface.clientWidth) * viewBox.width,
          worldY: viewBox.y + ((stage.scrollTop + stage.clientHeight / 2 - surface.offsetTop) / surface.clientHeight) * viewBox.height,
          zoom,
        }
      }
    }
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
    const placement = laterallyAlignedPlacement(centeredRoadPlacement(resolved.scene, resolved.request.highway), scenario)
    if (placement) {
      setSceneOrigin({ x: placement.x - sceneAnchorX, y: placement.y - sceneAnchorY })
      setSceneRotation(placement.rotation)
    }
    setResolvedLocation(resolved)
    setDrawingStrokes([])
    setTemporaryDrawingStrokes([])
    cancelDrawingStroke()
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

  function drawingPoint(event: React.PointerEvent<SVGRectElement>) {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: point.y }
  }

  function beginDrawingStroke(event: React.PointerEvent<SVGRectElement>) {
    if (!drawingActive || event.button !== 0) return
    const point = drawingPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const stroke: DrawingStroke = {
      id: `stroke-${crypto.randomUUID()}`,
      points: [point],
      color: drawingColor,
      widthFeet: drawingWidth,
      createdAt: Date.now(),
      persistence: drawingPersistence,
      lifetimeSeconds: drawingPersistence === 'temporary' ? drawingLifetime : undefined,
    }
    drawingPointerIdRef.current = event.pointerId
    drawingStrokeRef.current = stroke
    setActiveDrawingStroke(stroke)
  }

  function continueDrawingStroke(event: React.PointerEvent<SVGRectElement>) {
    const stroke = drawingStrokeRef.current
    if (!stroke || drawingPointerIdRef.current !== event.pointerId) return
    const point = drawingPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const points = sampleStrokePoint(stroke.points, point)
    if (points === stroke.points) return
    const next = { ...stroke, points }
    drawingStrokeRef.current = next
    setActiveDrawingStroke(next)
  }

  function finishDrawingStroke(event: React.PointerEvent<SVGRectElement>) {
    const stroke = drawingStrokeRef.current
    if (!stroke || drawingPointerIdRef.current !== event.pointerId) return
    const point = drawingPoint(event)
    const completed = {
      ...stroke,
      points: point ? sampleStrokePoint(stroke.points, point, true) : stroke.points,
      createdAt: performance.timeOrigin + event.timeStamp,
    }
    if (completed.points.length > 1) {
      if (completed.persistence === 'persistent') setDrawingStrokes((current) => [...current, completed])
      else setTemporaryDrawingStrokes((current) => [...current, completed])
    }
    cancelDrawingStroke()
  }

  function cancelDrawingStroke() {
    drawingPointerIdRef.current = null
    drawingStrokeRef.current = null
    setActiveDrawingStroke(null)
  }

  function undoDrawing() {
    if (drawingStrokeRef.current) {
      cancelDrawingStroke()
      return
    }
    const latestPersistent = drawingStrokes.at(-1)
    const latestTemporary = temporaryDrawingStrokes.at(-1)
    if (!latestPersistent && !latestTemporary) return
    if (!latestTemporary || (latestPersistent?.createdAt ?? 0) >= latestTemporary.createdAt) {
      setDrawingStrokes((current) => current.slice(0, -1))
    } else {
      setTemporaryDrawingStrokes((current) => current.slice(0, -1))
    }
  }

  function clientToMapPoint(client: { x: number; y: number }, bounds: DOMRect) {
    const point = clientToScenePoint(client, bounds, sceneViewBox)
    const radians = -mapRotation * Math.PI / 180
    const centerX = roadScene.viewport.width / 2
    const centerY = roadScene.viewport.height / 2
    const offsetX = point.x - centerX
    const offsetY = point.y - centerY
    return {
      x: centerX + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
      y: centerY + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
    }
  }

  function rotateMap(delta: number) {
    setMapRotation((current) => (current + delta + 360) % 360)
    setSaveStatus('idle')
  }

  function collapsePane(side: 'left' | 'right', event: React.MouseEvent<HTMLButtonElement>) {
    rememberViewedCenter()
    setAppSettings((current) => ({
      ...current,
      [side === 'left' ? 'leftPaneCollapsed' : 'rightPaneCollapsed']: true,
    }))
    if (event.detail === 0) {
      requestAnimationFrame(() => {
        const restoreButton = side === 'left' ? leftPaneRestoreRef.current : rightPaneRestoreRef.current
        restoreButton?.focus()
      })
    }
  }

  function restorePane(side: 'left' | 'right') {
    rememberViewedCenter()
    setAppSettings((current) => ({
      ...current,
      [side === 'left' ? 'leftPaneCollapsed' : 'rightPaneCollapsed']: false,
    }))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label={`Magnus version ${__APP_VERSION__}`}>
          <div className="brand-mark" aria-hidden="true"><img src="/favicon.svg" alt="" /></div>
          <div className="brand-copy"><div className="brand-name"><strong>AGNUS</strong><b>{appReleaseVersion}</b></div><span>SSP Scene Builder</span></div>
        </div>
        <div className="connectivity-switch" role="group" aria-label="Map connectivity">
          {connectivityModes.map((item) => {
            const Icon = item.icon
            return <button type="button" aria-pressed={appSettings.connectivityMode === item.id} key={item.id} onClick={() => selectConnectivityMode(item.id)}><Icon size={14} /><span>{item.label}</span></button>
          })}
        </div>
        <div className="zoom-controls topbar-zoom" role="group" aria-label="Scene zoom">
          <button type="button" title="Zoom out" aria-label="Zoom out highway graphic" disabled={sceneZoom <= MIN_SCENE_ZOOM} onClick={() => changeSceneZoom(-1)}><Minus size={17} /></button>
          <button className="zoom-value" type="button" title="Reset to 500 foot view" aria-label={`Reset highway graphic zoom, currently ${Math.round(sceneVisibleWidth)} feet wide`} onClick={() => setCenteredSceneZoom(defaultSceneZoom)}>{Math.round(sceneVisibleWidth)} FT</button>
          <button type="button" title="Zoom in" aria-label="Zoom in highway graphic" disabled={sceneZoom >= maximumSceneZoom} onClick={() => changeSceneZoom(1)}><Plus size={17} /></button>
          <button type="button" title="Rotate center view counterclockwise" aria-label="Rotate center view counterclockwise 45 degrees" onClick={() => rotateMap(-45)}><RotateCcw size={16} /></button>
          <button className="rotation-value" type="button" title="Reset center view rotation" aria-label={`Reset center view rotation, currently ${mapRotation} degrees`} onClick={() => setMapRotation(0)}>{mapRotation}°</button>
          <button type="button" title="Rotate center view clockwise" aria-label="Rotate center view clockwise 45 degrees" onClick={() => rotateMap(45)}><RotateCw size={16} /></button>
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
            <div className="settings-section">
              <div className="settings-section-title"><MonitorUp size={15} /><span>Pane and text scale</span></div>
              <label className="interface-scale-control">
                <input aria-label="Pane and text scale" type="range" min="100" max="160" step="10" value={appSettings.interfaceScale} onChange={(event) => setAppSettings((current) => ({ ...current, interfaceScale: Number(event.target.value) }))} />
                <output>{appSettings.interfaceScale}%</output>
              </label>
            </div>
            <div className="settings-section">
              <div className="settings-section-title"><ScreenShare size={15} /><span>External display</span></div>
              <button className="presentation-button" type="button" onClick={() => { void presentOnExternalDisplay() }}><ScreenShare size={15} /> Present on external display</button>
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
        <div className="scene-file-actions">
          <div className="save-scene-anchor">
            <button className="scene-file-button" type="button" aria-expanded={saveMenuOpen} aria-haspopup="menu" onClick={() => setSaveMenuOpen((open) => !open)}><Save size={17} /> SAVE SCENE</button>
            {saveMenuOpen && <div className="save-scene-menu" role="menu" aria-label="Save scene format"><span>Image format</span><button type="button" role="menuitem" onClick={() => { void saveScene('png') }}>PNG image</button><button type="button" role="menuitem" onClick={() => { void saveScene('jpg') }}>JPG image</button><button type="button" role="menuitem" onClick={() => { void saveScene('svg') }}>SVG vector</button><small>Includes a rebuildable .magnus.json scene file</small></div>}
          </div>
          <button className="scene-file-button" type="button" onClick={() => { void chooseScenarioFile() }}><FolderOpen size={17} /> LOAD SCENE</button>
          <input ref={loadSceneInputRef} className="scene-file-input" type="file" accept=".json,.magnus.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadScenarioFile(file); event.currentTarget.value = '' }} />
          {saveStatus === 'saved' && <span className="scene-file-status" role="status">Scene ready</span>}
        </div>
        <button className="icon-button exit-button" type="button" title="Exit Magnus" aria-label="Exit Magnus" onClick={() => { void exitApplication() }}><X size={19} /></button>
      </header>

      <section
        className={`workspace${appSettings.leftPaneCollapsed ? ' left-pane-collapsed' : ''}${appSettings.rightPaneCollapsed ? ' right-pane-collapsed' : ''}`}
        style={{
          '--pane-scale': appSettings.interfaceScale / 100,
          '--pane-min-width': `${2.8 * appSettings.interfaceScale}px`,
          '--pane-max-width': `${3.6 * appSettings.interfaceScale}px`,
        } as CSSProperties}
      >
        <aside className="panel config-panel" aria-label="Scenario configuration">
          <div className="panel-heading"><span>01</span><div><p>Configuration</p><h2>Build the scene</h2></div><button className="pane-toggle" type="button" title="Collapse configuration pane" aria-label="Collapse configuration pane" onClick={(event) => collapsePane('left', event)}><ChevronLeft size={24} /></button></div>
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
              <label className="location-highway" htmlFor="highway">Highway<input id="highway" placeholder="I-95 or Route 28" value={locationRequest.highway} onChange={(event) => { setLocationRequest((current) => ({ ...current, highway: event.target.value, reference: current.highway === event.target.value ? current.reference : '' })); setResolvedLocation(null) }} /></label>
              <label htmlFor="reference-type">Reference<select id="reference-type" value={locationRequest.referenceType} onChange={(event) => setLocationRequest((current) => ({ ...current, referenceType: event.target.value as RoadLocationRequest['referenceType'], reference: '' }))}><option value="mile-marker">Mile marker</option><option value="exit">Exit number</option></select></label>
              <label htmlFor="reference">{locationRequest.referenceType === 'exit' ? 'Exit' : 'Mile marker'}<input id="reference" inputMode="decimal" placeholder={locationRequest.referenceType === 'exit' ? '166' : '168.0'} value={locationRequest.reference} onChange={(event) => setLocationRequest((current) => ({ ...current, reference: event.target.value }))} /></label>
            </div>
            {locationErrors.map((error) => <p className="location-error" role="alert" key={error}>{error}</p>)}
            <button className="location-load" type="submit" disabled={locationLoading}>{locationLoading ? <LoaderCircle className="location-spinner" size={15} /> : <MapPinned size={15} />}<span>{locationLoading ? 'Resolving location' : 'Render location'}</span></button>
            {resolvedLocation && <div className={`location-result ${resolvedLocation.source}`} role="status"><strong>{resolvedLocation.request.highway}</strong><span>{resolvedLocation.message}</span></div>}
          </form>
          <div className="control-group scene-type-control">
            <button className="scene-type-toggle" type="button" aria-expanded={sceneTypeOpen} aria-controls="scene-type-options" onClick={() => setSceneTypeOpen((open) => !open)}><span>Scene type</span>{sceneTypeOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
            {sceneTypeOpen && <div id="scene-type-options" className="scene-type-options"><div className="scenario-options">
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
            </div></div>}
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
              {TOOLKIT_CATEGORIES.map((category) => <button type="button" role="tab" aria-selected={activeToolkit === category.id} data-category={category.id} key={category.id} onClick={() => setActiveToolkit(category.id)}><span>{category.label.split(' ').map((word, index, words) => <span className="toolkit-tab-line" key={word}>{word}{index < words.length - 1 ? ' ' : ''}</span>)}</span></button>)}
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

        <button ref={leftPaneRestoreRef} className="pane-toggle pane-restore left-pane-restore" type="button" title="Expand configuration pane" aria-label="Expand configuration pane" onClick={() => restorePane('left')}><ChevronRight size={24} /></button>

        <section className="canvas-panel" aria-label="Interactive scene canvas">
          <div className="canvas-toolbar">
            <div><span className="eyebrow">Vector scene · {roadScene.source.type.replaceAll('-', ' ')}</span><div className="scene-heading-row"><h1>{sceneVisible ? selectedScenario.heading : scenePlacementActive ? `Place ${selectedScenario.label.toLowerCase()}` : 'Roadway only'}</h1></div><small className="scene-dataset">{roadScene.source.dataset}</small></div>
            <div className="canvas-tools">
              <div className="drawing-menu-anchor">
                <button className={`drawing-menu-button${drawingActive ? ' active' : ''}`} type="button" aria-expanded={drawingMenuOpen} aria-haspopup="dialog" onClick={() => setDrawingMenuOpen((open) => !open)}><Pencil size={15} /> Draw <ChevronDown size={13} /></button>
                {drawingMenuOpen && <div className="drawing-menu" role="dialog" aria-label="Freehand drawing tools">
                  <div className="drawing-menu-heading"><span>Freehand vectors</span><button type="button" aria-pressed={drawingActive} onClick={() => { setDrawingActive((active) => !active); cancelDrawingStroke() }}><Pencil size={14} /> {drawingActive ? 'Pen on' : 'Pen off'}</button></div>
                  <div className="drawing-control"><span>Color</span><div className="drawing-colors" role="radiogroup" aria-label="Drawing color">{['#ffd21f', '#ffffff', '#ff5a1f', '#e53935', '#111111'].map((color) => <button type="button" role="radio" aria-checked={drawingColor === color} aria-label={`Drawing color ${color}`} key={color} style={{ background: color }} onClick={() => setDrawingColor(color)} />)}</div></div>
                  <label className="drawing-control drawing-width"><span>Width</span><input aria-label="Drawing width" type="range" min="1" max="10" step="1" value={drawingWidth} onChange={(event) => setDrawingWidth(Number(event.target.value))} /><b>{drawingWidth} ft</b></label>
                  <div className="drawing-control"><span>Keep</span><div className="drawing-mode" role="radiogroup" aria-label="Drawing persistence"><button type="button" role="radio" aria-checked={drawingPersistence === 'persistent'} onClick={() => setDrawingPersistence('persistent')}>Persistent</button><button type="button" role="radio" aria-checked={drawingPersistence === 'temporary'} onClick={() => setDrawingPersistence('temporary')}>Temporary</button></div></div>
                  {drawingPersistence === 'temporary' && <label className="drawing-control"><span>Lifetime</span><select aria-label="Temporary drawing lifetime" value={drawingLifetime} onChange={(event) => setDrawingLifetime(Number(event.target.value))}>{[5, 10, 15, 30].map((seconds) => <option value={seconds} key={seconds}>{seconds} sec</option>)}</select></label>}
                  <button className="drawing-undo" type="button" disabled={!activeDrawingStroke && drawingStrokes.length === 0 && temporaryDrawingStrokes.length === 0} onClick={undoDrawing}><Undo2 size={14} /> {activeDrawingStroke ? 'Cancel stroke' : 'Undo last stroke'}</button>
                </div>}
              </div>
              {sceneVisible && <div className="traffic-flow-instrument"><span>Traffic flow</span><ArrowUp className="traffic-direction-arrow" style={{ transform: `rotate(${effectiveSceneRotation + mapRotation}deg)` }} size={30} aria-label="Traffic flow bearing" /></div>}
              <MapCompass rotation={mapRotation} />
              <div className="scale-key" data-scale-pixels={fortyFootScalePixels.toFixed(2)}><span style={{ width: `${fortyFootScalePixels}px` }} /> 40 FT</div>
            </div>
          </div>
          <div className="road-stage" ref={roadStageRef} data-zoom={sceneZoom} onPointerDown={startScenePointer} onPointerMove={moveScenePointer} onPointerUp={endScenePointer} onPointerCancel={endScenePointer} onWheel={zoomSceneWithTrackpad}>
            <div className="road-canvas-surface" style={sceneCanvasSize}>
            <svg className={`road-canvas${scenePlacementActive ? ' placing-scene' : ''}`} viewBox={sceneViewBoxValue} role="img" aria-label="Top-down highway scene with SSP vehicle and traffic cones" data-visible-width-feet={Math.round(sceneVisibleWidth)} data-zoom={sceneZoom} onPointerDown={placeScene} onPointerMove={moveCone} onPointerUp={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null); rotatingEquipmentRef.current = null; rotatingTruckRef.current = null }} onPointerLeave={() => { setDragging(null); setDraggingEquipmentId(null); setDraggingTruckId(null); rotatingEquipmentRef.current = null; rotatingTruckRef.current = null }}>
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
                className={`ssp-truck${truck.id === selectedTruckId ? ' selected' : ''}`}
                data-length-feet={RIGHT_LANE_STANDARD.truck.length}
                data-asset-type={truck.assetType}
                data-signboard={truck.signboard}
                data-truck-id={truck.id}
                data-width-feet={RIGHT_LANE_STANDARD.truck.width}
                key={truck.id}
                onClick={(event) => { event.stopPropagation(); setSelectedTruckId(truck.id); setSelectedConeId(null); setSelectedEquipmentId(null) }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setSelectedTruckId(truck.id); setSelectedConeId(null); setSelectedEquipmentId(null) } }}
                onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedTruckId(truck.id); setSelectedConeId(null); setSelectedEquipmentId(null); setDraggingTruckId(truck.id) }}
                role="button"
                tabIndex={0}
                transform={`translate(${truck.x + selectedScenario.truckOffsetX} ${truck.y}) rotate(${truck.rotation})`}
              >
                <rect className="truck-body" x="-4.25" y="-12" width="8.5" height="24" />
                <path className="truck-panel-line" d="M -4.25 -1 H 4.25 M -4.25 -7 H 4.25 M -3 -7 V -1 M 3 -7 V -1" />
                <path className="truck-windshield" d="M -3.4 -3 H 3.4 L 2.8 -8 H -2.8 Z" />
                <path className="truck-hood-line" d="M -3.2 -10 H 3.2 M -2.5 -12 V -10 M 2.5 -12 V -10" />
                <rect className="truck-lightbar" x="-4.5" y="-1" width="9" height="1.4" />
                <rect className="strobe" x="-4" y="-11" width="0.8" height="0.8" />
                <rect className="strobe delayed" x="3.2" y="-11" width="0.8" height="0.8" />
                <g transform="translate(0 10) scale(.1)"><SignboardGraphic message={truck.signboard} /></g>
                {truck.assetType === 'lane-blade-truck' && <path className="truck-lane-blade" d="M -4.25 -12 H 4.25" />}
                <rect className="deployed-selection" x="-6.25" y="-14" width="12.5" height="28" />
                {truck.id === selectedTruckId && <circle className="equipment-rotation-handle" aria-label={`Rotate ${truck.label}`} cx="6.25" cy="-14" r="2.2" onPointerDown={(event) => beginTruckRotation(event, truck)} />}
              </g>)}
              {points.map((point) => (
                <g className={`cone${point.id === selectedConeId ? ' selected' : ''}${mode === 'gospel' ? ' locked' : ''}`} data-cone-id={point.id} key={point.id} role="button" tabIndex={0} transform={`translate(${point.x} ${point.y})`} onClick={(event) => { event.stopPropagation(); setSelectedConeId(point.id); setSelectedEquipmentId(null); setSelectedTruckId('') }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setSelectedConeId(point.id); setSelectedEquipmentId(null); setSelectedTruckId('') } }} onPointerDown={(event) => { event.stopPropagation(); setSelectedConeId(point.id); setSelectedEquipmentId(null); setSelectedTruckId(''); if (mode === 'gospel') return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(point.id) }}>
                  <rect className="cone-hit-area" x="-4" y="-4" width="8" height="8" />
                  <SceneEquipmentGlyph definition={setupConeDefinition} />
                </g>
              ))}
              {deployedEquipment.map((item) => {
                const definition = equipmentDefinition(item.definitionId)
                const renderDefinition = {
                  ...definition,
                  width: item.width ?? definition.width,
                  length: item.length ?? definition.length,
                }
                return <g
                  aria-label={definition.label}
                  className={`deployed-equipment${item.id === selectedEquipmentId ? ' selected' : ''}`}
                  data-definition-id={definition.id}
                  key={item.id}
                  onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedEquipmentId(item.id); setSelectedConeId(null); setSelectedTruckId(''); setDraggingEquipmentId(item.id) }}
                  role="button"
                  tabIndex={0}
                  transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
                >
                  <SceneEquipmentGlyph definition={renderDefinition} />
                  <rect className="deployed-selection" x={-renderDefinition.width / 2 - 2} y={-renderDefinition.length / 2 - 2} width={renderDefinition.width + 4} height={renderDefinition.length + 4} />
                  {item.id === selectedEquipmentId && isEquipmentRotatable(definition) && <circle className="equipment-rotation-handle" aria-label={`Rotate ${definition.label}`} cx={renderDefinition.width / 2 + 2} cy={-renderDefinition.length / 2 - 2} r="2.2" onPointerDown={(event) => beginEquipmentRotation(event, item)} />}
                </g>
              })}
              </g>}
              {roadLayerVisibility.highwayLabels && highwayLabelsAvailable && <RoadwayLabels scene={roadScene} focus={{ x: sceneFocusX, y: sceneFocusY }} />}
              {roadLayerVisibility.drawings && <g className="drawing-layer" aria-label="Freehand drawings">
                {[...drawingStrokes, ...temporaryDrawingStrokes, ...(activeDrawingStroke ? [activeDrawingStroke] : [])].map((stroke) => <polyline className={stroke.persistence === 'temporary' ? 'drawing-stroke temporary' : 'drawing-stroke'} data-stroke-id={stroke.id} fill="none" key={stroke.id} points={strokePoints(stroke)} stroke={stroke.color} strokeWidth={stroke.widthFeet} />)}
              </g>}
              {drawingActive && <rect className="drawing-hit-area" width={roadScene.viewport.width} height={roadScene.viewport.height} onPointerDown={beginDrawingStroke} onPointerMove={continueDrawingStroke} onPointerUp={finishDrawingStroke} onPointerCancel={cancelDrawingStroke} />}
              </g>
            </svg>
            </div>
            <div className={`canvas-hint${scenePlacementActive ? ' placement-active' : ''}`}>{drawingActive ? <><Pencil size={15} /> Drag on the map to draw</> : scenePlacementActive ? <><MousePointer2 size={15} /> Tap roadway to place {selectedScenario.label.toLowerCase()}</> : !sceneVisible ? <><Navigation size={15} /> Roadway only</> : sectionSelectionEnabled ? <><MousePointer2 size={15} /> Select a roadway section</> : mode === 'gospel' ? <><ShieldCheck size={15} /> Positions locked to Standard SOP</> : <><Navigation size={15} /> Drag cones to adapt the scene</>}</div>
          </div>
        </section>

        <button ref={rightPaneRestoreRef} className="pane-toggle pane-restore right-pane-restore" type="button" title="Expand operations pane" aria-label="Expand operations pane" onClick={() => restorePane('right')}><ChevronLeft size={24} /></button>

        <aside className="panel audit-panel" aria-label="Compliance and communications">
          <button className="pane-toggle audit-pane-toggle" type="button" title="Collapse operations pane" aria-label="Collapse operations pane" onClick={(event) => collapsePane('right', event)}><ChevronRight size={24} /></button>
          <section className="scene-resource-counts" aria-label="Scene resource counts"><div><span>Vehicles</span><b>{deployedCounts.vehicles}</b></div><div><span>Cones</span><b>{deployedCounts.cones}</b></div><div><span>Personnel</span><b>{deployedCounts.personnel}</b></div><div><span>Hazards</span><b>{deployedCounts.hazards}</b></div></section>
          {selectedEquipment && selectedEquipmentDefinition && <section className="equipment-inspector" aria-label="Selected scene item"><div><span>Selected item</span><b>{selectedEquipmentDefinition.label}</b></div><div className="equipment-position"><label>X (ft)<input type="number" value={Math.round(selectedEquipment.x)} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { x: Number(event.target.value) })} /></label><label>Y (ft)<input type="number" value={Math.round(selectedEquipment.y)} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { y: Number(event.target.value) })} /></label><label>Rotation<select value={selectedEquipment.rotation} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { rotation: Number(event.target.value) })}><option value="0">0°</option><option value="45">45°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>{selectedEquipmentDefinition.resizable && <><label>Width (ft)<input min="4" max="100" type="number" value={selectedEquipmentWidth} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { width: Math.max(4, Number(event.target.value)) })} /></label><label>Length (ft)<input min="4" max="100" type="number" value={selectedEquipmentLength} onChange={(event) => updateDeployedEquipment(selectedEquipment.id, { length: Math.max(4, Number(event.target.value)) })} /></label></>}</div><button type="button" onClick={deleteSelectedEquipment}>Delete selected item</button></section>}
          {selectedTruck && <section className="signboard-control" aria-label="SSP truck signboard">
            <div className="signboard-control-heading"><div><span>SSP truck signboard</span><b>{selectedTruck.label}</b></div><small>{trucks.length} / {MAX_SSP_TRUCKS}</small></div>
            {trucks.length > 1 && <div className="truck-selector" role="tablist" aria-label="SSP trucks">{trucks.map((truck, index) => <button type="button" role="tab" aria-selected={truck.id === selectedTruck.id} key={truck.id} onClick={() => setSelectedTruckId(truck.id)}>{index + 1}</button>)}</div>}
            <svg className="signboard-output" viewBox="-44 -16 88 32" role="img" aria-label={`${selectedTruck.label} signboard: ${signboardLabel(selectedTruck.signboard)}`}><SignboardGraphic message={selectedTruck.signboard} /></svg>
            <label htmlFor="signboard-message">Displayed message<select id="signboard-message" aria-label={`Signboard message for ${selectedTruck.label}`} value={selectedTruck.signboard} onChange={(event) => setSelectedTruckSignboard(event.target.value as SignboardMessage)}>{SIGNBOARD_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label htmlFor="ssp-truck-rotation">Rotation<select id="ssp-truck-rotation" aria-label={`Rotation for ${selectedTruck.label}`} value={selectedTruck.rotation} onChange={(event) => setTrucks((current) => current.map((truck) => truck.id === selectedTruck.id ? { ...truck, rotation: Number(event.target.value) } : truck))}><option value="0">0°</option><option value="45">45°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
          </section>}
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
              <label className="toggle-row"><span><MapPinned size={16} /> {highwayLabelsAvailable ? 'Highway labels' : 'Highway labels unavailable in preview'}</span><input type="checkbox" checked={roadLayerVisibility.highwayLabels && highwayLabelsAvailable} disabled={!highwayLabelsAvailable} onChange={(event) => setRoadLayerVisibilityValue('highwayLabels', event.target.checked)} /></label>
              <label className="toggle-row"><span><Pencil size={16} /> Drawings</span><input type="checkbox" checked={roadLayerVisibility.drawings} onChange={(event) => setRoadLayerVisibilityValue('drawings', event.target.checked)} /></label>
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
          <section className="radio-section"><div className="section-title"><span>Communications</span><Radio size={15} /></div><div className="communications-fields"><label htmlFor="communications-direction">Travel direction<select id="communications-direction" value={locationRequest.direction === 'all' ? 'northbound' : locationRequest.direction} onChange={(event) => setLocationRequest((current) => ({ ...current, direction: event.target.value as CommunicationDirection }))}>{communicationDirections.map((direction) => <option value={direction.value} key={direction.value}>{direction.label}</option>)}</select></label><label htmlFor="incident-type">Incident type<select id="incident-type" value={incidentType} onChange={(event) => setIncidentType(event.target.value as IncidentType)}>{INCIDENT_TYPE_OPTIONS.map((incident) => <option value={incident.value} key={incident.value}>{incident.label}</option>)}</select></label></div>{(incidentType === 'crash' || incidentType === 'severe-crash') && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Vehicle count<input type="number" min="1" value={tocIncidentDetails.crashVehicleCount} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, crashVehicleCount: Math.max(1, Number(event.target.value)) }))} /></label><label>Transported by EMS<input type="number" min="0" value={tocIncidentDetails.emsTransportCount} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, emsTransportCount: Math.max(0, Number(event.target.value)) }))} /></label><label>Injuries<select value={tocIncidentDetails.injuries} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, injuries: event.target.value as TocIncidentDetails['injuries'] }))}><option value="unknown">Unknown</option><option value="none">None reported</option><option value="reported">Reported</option></select></label></div>}{(incidentType === 'disabled-vehicle' || incidentType === 'blocking-disabled') && <div className="toc-detail-fields vehicle-details" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>License plate<input value={tocIncidentDetails.licensePlate} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, licensePlate: event.target.value }))} /></label><label>Plate state<input value={tocIncidentDetails.licensePlateState} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, licensePlateState: event.target.value }))} /></label><label>Vehicle make<input value={tocIncidentDetails.vehicleMake} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, vehicleMake: event.target.value }))} /></label><label>Vehicle model<input value={tocIncidentDetails.vehicleModel} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, vehicleModel: event.target.value }))} /></label><label>Vehicle color<input value={tocIncidentDetails.vehicleColor} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, vehicleColor: event.target.value }))} /></label></div>}{incidentType === 'plane-crash' && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Lanes impacted<select value={tocIncidentDetails.planeLanesImpacted} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, planeLanesImpacted: event.target.value }))}>{impactedLaneOptions.slice(0, 5).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Plane size<select value={tocIncidentDetails.planeSize} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, planeSize: event.target.value }))}><option value="unknown size">Unknown</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label><label>Survivors<select value={tocIncidentDetails.survivors} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, survivors: event.target.value as TocIncidentDetails['survivors'] }))}><option value="unknown">Unknown</option><option value="yes">Reported</option><option value="no">None reported</option></select></label></div>}{incidentType === 'downed-tree' && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Tree lanes blocked<select value={tocIncidentDetails.treeLanesBlocked} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, treeLanesBlocked: event.target.value }))}>{impactedLaneOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Tree size<input value={tocIncidentDetails.treeSize} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, treeSize: event.target.value }))} /></label><label>Resources to move tree<input value={tocIncidentDetails.treeResourcesNeeded} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, treeResourcesNeeded: event.target.value }))} /></label></div>}{incidentType === 'debris' && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Hazardous debris<select value={tocIncidentDetails.debrisHazardous} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, debrisHazardous: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>SSP can remove manually<select value={tocIncidentDetails.debrisManualRemoval} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, debrisManualRemoval: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Needs VSP slow-roll<select value={tocIncidentDetails.debrisNeedsSlowRoll} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, debrisNeedsSlowRoll: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>SSP has lane blade<select value={tocIncidentDetails.debrisHasLaneBlade} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, debrisHasLaneBlade: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div>}{incidentType === 'car-fire' && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Motorist out<select value={tocIncidentDetails.carFireMotoristOut} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, carFireMotoristOut: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Fully engulfed<select value={tocIncidentDetails.carFireFullyEngulfed} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, carFireFullyEngulfed: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Electric vehicle<select value={tocIncidentDetails.carFireIsEv} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, carFireIsEv: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Fire lanes blocked<select value={tocIncidentDetails.carFireLanesBlocked} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, carFireLanesBlocked: event.target.value }))}>{impactedLaneOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div>}{incidentType === 'tractor-trailer-fire' && <div className="toc-detail-fields" aria-label="What TOC will need to know"><strong>What TOC will need to know</strong><label>Driver out<select value={tocIncidentDetails.tractorDriverOut} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, tractorDriverOut: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Trailer hauling<input value={tocIncidentDetails.tractorTrailerCargo} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, tractorTrailerCargo: event.target.value }))} /></label><label>HAZMAT<select value={tocIncidentDetails.tractorHazmat} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, tractorHazmat: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Fully engulfed<select value={tocIncidentDetails.tractorFullyEngulfed} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, tractorFullyEngulfed: event.target.value as YesNoUnknown }))}>{yesNoOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Truck fire lanes blocked<select value={tocIncidentDetails.tractorLanesBlocked} onChange={(event) => setTocIncidentDetails((current) => ({ ...current, tractorLanesBlocked: event.target.value }))}>{impactedLaneOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div>}<div className="radio-log">{radioEvents.map((event, index) => <div className="radio-event" key={`${event.time}-${index}`}><Clock3 size={14} /><div><span>{event.time} · {event.channel}</span><p>{event.text}</p></div></div>)}</div><button className="secondary-button" type="button" onClick={addRadioEvent}><Radio size={16} /> Build initial radio call</button></section>
        </aside>
      </section>
      {designerOpen && <SceneDesigner onClose={() => setDesignerOpen(false)} onSave={saveTemplate} />}
    </main>
  )
}

export default App
