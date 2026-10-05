import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import {
  Anchor,
  ChevronDown,
  Crop as CropIcon,
  Download,
  Eraser,
  FilePlus,
  FolderOpen,
  GitMerge,
  Layers,
  LoaderCircle,
  Lock,
  LockOpen,
  MapPinned,
  MousePointer2,
  Move,
  MoveHorizontal,
  PaintBucket,
  Pencil,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Spline,
  SquareDashedMousePointer,
  Stamp as StampIcon,
  Trash2,
  Undo2,
  Unlink,
  Wand2,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  createReferenceRoadScene,
  type Position,
  type RoadFeature,
  type RoadScene,
} from '../domain/roadScene'
import {
  clearRoadSceneCache,
  normalizeHighway,
  probeSpatialService,
  resolveRoadLocation,
  validateRoadLocation,
  type RoadLocationRequest,
  type ResolvedRoadLocation,
} from '../domain/roadLocation'
import {
  cropFeaturesToBoundingBox,
  findSnapPoint,
  joinFeatures,
  listAllVertices,
  listEndpoints,
  offsetPolyline,
  paintPavementProfile,
  polylineLengthFeet,
  rotateFeatureAroundPoint,
  roundVertex,
  smoothPolyline,
  snapAngleTo45,
  splitFeatureWithGap,
  translateFeature,
  updateVertex,
  variableWidthRibbon,
  type BoundingBox,
  type EndpointRef,
  type PaintProfile,
  type VertexRef,
} from '../domain/locationTemplateEditing'
import {
  bakeStampToFeatures,
  BUILT_IN_LOCATION_TEMPLATES,
  commitLinePattern,
  defaultLocationTemplateName,
  isBuiltInLocationTemplate,
  listLocationTemplates,
  locationTemplateFileBaseName,
  MUTCD_LINE_PATTERNS,
  parseLocationTemplateDocument,
  renderLocationTemplateSvg,
  saveLocationTemplate,
  STAMP_GLYPHS,
  type LinePatternOption,
  type LocationTemplateDocument,
  type LocationTemplateEntry,
  type PlacedStamp,
  type StampKind,
} from '../domain/locationTemplate'
import {
  DEFAULT_HIGHWAY_GENERATOR_OPTIONS,
  defaultGeneratedHighwayName,
  generateHighwayScene,
  HIGHWAY_AUXILIARY_LANE_OPTIONS,
  HIGHWAY_DIRECTION_OPTIONS,
  HIGHWAY_LANE_OPTIONS,
  HIGHWAY_RAMP_OPTIONS,
  type HighwayGeneratorOptions,
} from '../domain/highwayGenerator'
import './LocationTemplateCreator.css'

type EditorTool =
  | 'select'
  | 'points'
  | 'join'
  | 'split'
  | 'round-corner'
  | 'taper'
  | 'crop'
  | 'line'
  | 'freehand'
  | 'stamp'
  | 'pavement'
  | 'erase-pavement'
  | 'area-select'
  | 'offset'
type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'

interface ToolDefinition {
  id: EditorTool
  label: string
  shortcut: string
  icon: ComponentType<{ size?: number }>
}

const TOOL_GROUPS: { label: string; tools: ToolDefinition[] }[] = [
  {
    label: 'Select',
    tools: [
      { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
      { id: 'area-select', label: 'Area select', shortcut: 'A', icon: SquareDashedMousePointer },
      { id: 'points', label: 'Points', shortcut: 'P', icon: Move },
    ],
  },
  {
    label: 'Draw',
    tools: [
      { id: 'line', label: 'Draw line', shortcut: 'L', icon: Waypoints },
      { id: 'freehand', label: 'Freehand path', shortcut: 'F', icon: Pencil },
      { id: 'taper', label: 'Taper / gore area', shortcut: 'T', icon: Layers },
      { id: 'stamp', label: 'Stamps', shortcut: 'S', icon: StampIcon },
    ],
  },
  {
    label: 'Modify',
    tools: [
      { id: 'join', label: 'Join endpoints', shortcut: 'J', icon: GitMerge },
      { id: 'split', label: 'Split line', shortcut: 'X', icon: Scissors },
      { id: 'round-corner', label: 'Round corner', shortcut: 'R', icon: Spline },
      { id: 'offset', label: 'Parallel offset', shortcut: 'O', icon: MoveHorizontal },
    ],
  },
  {
    label: 'Crop',
    tools: [{ id: 'crop', label: 'Crop', shortcut: 'C', icon: CropIcon }],
  },
  {
    label: 'Pavement',
    tools: [
      { id: 'pavement', label: 'Paint pavement', shortcut: 'B', icon: PaintBucket },
      { id: 'erase-pavement', label: 'Erase pavement', shortcut: 'E', icon: Eraser },
    ],
  },
]
const TOOL_DEFINITIONS = TOOL_GROUPS.flatMap((group) => group.tools)
const TOOL_BY_SHORTCUT = new Map(TOOL_DEFINITIONS.map((definition) => [definition.shortcut.toLowerCase(), definition.id]))
const SELECTING_TOOLS: EditorTool[] = ['select', 'split', 'round-corner', 'offset']

interface LocationTemplateCreatorProps {
  onClose: () => void
}

const DEFAULT_LOCATION_REQUEST: RoadLocationRequest = {
  highway: 'I-95',
  direction: 'northbound',
  referenceType: 'exit',
  reference: '143',
}

const SNAP_RADIUS_FEET = 6
const PIXELS_PER_FOOT = 1.4
const STAMP_KINDS: StampKind[] = ['shield', 'arrow-straight', 'arrow-left', 'arrow-right', 'arrow-merge-left', 'arrow-merge-right', 'chevron']
const LINE_PATTERNS_FOR_OFFSET = MUTCD_LINE_PATTERNS.filter((option) => !option.double)

function featurePathD(feature: RoadFeature): string {
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates
      .map((ring) => `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`)
      .join(' ')
  }
  return feature.geometry.coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

function taperGeometry(points: Position[]): RoadFeature['geometry'] {
  const first = points[0]
  const last = points.at(-1)!
  const ring = first[0] === last[0] && first[1] === last[1] ? points : [...points, first]
  return { type: 'Polygon', coordinates: [ring] }
}

function featureWithinBox(feature: RoadFeature, box: BoundingBox): boolean {
  const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
  return rings.some((ring) => ring.some(([x, y]) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY))
}

function centroidOf(points: Position[]): Position {
  const sum = points.reduce((total, [x, y]): Position => [total[0] + x, total[1] + y], [0, 0] as Position)
  return [sum[0] / points.length, sum[1] / points.length]
}

const PAVEMENT_KINDS = new Set<RoadFeature['kind']>(['road-casing', 'road-surface', 'ramp-casing-ribbon', 'ramp-surface-ribbon', 'intersection-surface'])

function isPavementFeature(feature: RoadFeature): boolean {
  return PAVEMENT_KINDS.has(feature.kind)
}

function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Position {
  const ctm = svg.getScreenCTM()
  if (!ctm) return [0, 0]
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
  return [point.x, point.y]
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 10

function zoomStep(zoom: number): number {
  if (zoom >= 4) return 1
  if (zoom >= 2) return 0.5
  return 0.25
}

export function LocationTemplateCreator({ onClose }: LocationTemplateCreatorProps) {
  const [scene, setScene] = useState<RoadScene>(createReferenceRoadScene)
  const [stamps, setStamps] = useState<PlacedStamp[]>([])
  const [locationRequest, setLocationRequest] = useState<RoadLocationRequest>(DEFAULT_LOCATION_REQUEST)
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [cacheNotice, setCacheNotice] = useState<string | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedRoadLocation | null>(null)
  const [spatialServiceStatus, setSpatialServiceStatus] = useState<SpatialServiceStatus>('checking')

  const [tool, setTool] = useState<EditorTool>('select')
  const [sourceOpen, setSourceOpen] = useState(false)
  const [cursorFeet, setCursorFeet] = useState<Position | null>(null)
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [multiSelectedFeatureIds, setMultiSelectedFeatureIds] = useState<Set<string>>(new Set())
  const [pendingJoin, setPendingJoin] = useState<EndpointRef | null>(null)
  const [roundRadius, setRoundRadius] = useState(15)
  const [offsetDistance, setOffsetDistance] = useState(12)
  const [offsetSide, setOffsetSide] = useState<'left' | 'right'>('right')
  const [offsetPatternId, setOffsetPatternId] = useState(LINE_PATTERNS_FOR_OFFSET[0].id)
  const [taperPoints, setTaperPoints] = useState<Position[]>([])
  const [linePattern, setLinePattern] = useState<LinePatternOption>(MUTCD_LINE_PATTERNS[0])
  const [lineStart, setLineStart] = useState<Position | null>(null)
  const [freehandPoints, setFreehandPoints] = useState<Position[]>([])
  const [armedStamp, setArmedStamp] = useState<StampKind | null>(null)
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null)
  const [cropBox, setCropBox] = useState<BoundingBox | null>(null)
  const [cropDragStart, setCropDragStart] = useState<Position | null>(null)
  const [areaSelectBox, setAreaSelectBox] = useState<BoundingBox | null>(null)
  const [areaSelectDragStart, setAreaSelectDragStart] = useState<Position | null>(null)
  const [selectedPoints, setSelectedPoints] = useState<VertexRef[]>([])
  const [anchors, setAnchors] = useState<Record<string, Set<number>>>({})
  const [pointContextMenu, setPointContextMenu] = useState<{ featureId: string; vertexIndex: number; x: number; y: number } | null>(null)
  const [draggingVertex, setDraggingVertex] = useState<{ featureId: string; vertexIndex: number } | null>(null)
  const [draggingWholeFeature, setDraggingWholeFeature] = useState<{ featureId: string; startPoint: Position; originalFeature: RoadFeature } | null>(null)
  const [pavementPoints, setPavementPoints] = useState<Position[]>([])
  const [pavementLanes, setPavementLanes] = useState<1 | 2 | 3>(1)
  const [pavementShoulders, setPavementShoulders] = useState<'none' | 'left' | 'right' | 'both'>('none')
  const [pavementFogLines, setPavementFogLines] = useState(false)
  const [pavementUnlocked, setPavementUnlocked] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [erasePreview, setErasePreview] = useState<Position | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [sceneNameHint, setSceneNameHint] = useState<string | null>('3 Lane Highway')
  const [highwayGeneratorOptions, setHighwayGeneratorOptions] = useState<HighwayGeneratorOptions>(DEFAULT_HIGHWAY_GENERATOR_OPTIONS)
  const [loadTemplatesOpen, setLoadTemplatesOpen] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState(() => listLocationTemplates(localStorage))
  const [history, setHistory] = useState<{ scene: RoadScene; stamps: PlacedStamp[] }[]>([])

  const svgRef = useRef<SVGSVGElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const zoomCenterRef = useRef<{ x: number; y: number } | null>(null)
  const pendingCenterRef = useRef(true)
  const paintStrokeIdRef = useRef<string | null>(null)
  const paintCenterlineRef = useRef<Position[]>([])
  const isErasingRef = useRef(false)
  const availableTemplates = [
    ...BUILT_IN_LOCATION_TEMPLATES,
    ...savedTemplates.filter((entry) => !isBuiltInLocationTemplate(entry.name)),
  ]

  useEffect(() => {
    let active = true
    void probeSpatialService().then((available) => {
      if (active) setSpatialServiceStatus(available ? 'connected' : 'unavailable')
    })
    return () => { active = false }
  }, [])

  const selectedFeature = scene.features.find((feature) => feature.id === selectedFeatureId) ?? null
  const selectedStamp = stamps.find((stamp) => stamp.id === selectedStampId) ?? null
  const editableFeatures = pavementUnlocked ? scene.features : scene.features.filter((feature) => !isPavementFeature(feature))
  const endpoints = listEndpoints(editableFeatures)
  const allVertices = listAllVertices(editableFeatures)

  function selectTool(next: EditorTool) {
    setTool(next)
    setPendingJoin(null)
    setLineStart(null)
    setSelectedPoints([])
    setPointContextMenu(null)
    if (next === 'pavement' || next === 'erase-pavement') setPavementUnlocked(true)
    if (next !== 'stamp') setArmedStamp(null)
    else setArmedStamp((current) => current ?? STAMP_KINDS[0])
    if (next !== 'crop') { setCropBox(null); setCropDragStart(null) }
    if (next !== 'taper') setTaperPoints([])
    if (next !== 'freehand') setFreehandPoints([])
    if (next !== 'pavement') setPavementPoints([])
    if (next !== 'area-select') { setAreaSelectBox(null); setAreaSelectDragStart(null) }
    if (next !== 'select') setMultiSelectedFeatureIds(new Set())
  }

  function captureZoomCenter() {
    const wrap = canvasWrapRef.current
    if (!wrap) return
    zoomCenterRef.current = {
      x: (wrap.scrollLeft + wrap.clientWidth / 2) / (PIXELS_PER_FOOT * zoom),
      y: (wrap.scrollTop + wrap.clientHeight / 2) / (PIXELS_PER_FOOT * zoom),
    }
  }

  function zoomIn() {
    captureZoomCenter()
    setZoom((current) => Math.min(MAX_ZOOM, Math.round((current + zoomStep(current)) * 100) / 100))
  }

  function zoomOut() {
    captureZoomCenter()
    setZoom((current) => Math.max(MIN_ZOOM, Math.round((current - zoomStep(current - 0.01)) * 100) / 100))
  }

  function resetZoom() {
    captureZoomCenter()
    setZoom(1)
  }

  // After zoom changes, restore scroll so the same world point stays under the viewport center.
  useLayoutEffect(() => {
    const wrap = canvasWrapRef.current
    const center = zoomCenterRef.current
    if (!wrap || !center) return
    wrap.scrollLeft = center.x * PIXELS_PER_FOOT * zoom - wrap.clientWidth / 2
    wrap.scrollTop = center.y * PIXELS_PER_FOOT * zoom - wrap.clientHeight / 2
  }, [zoom])

  // Center the view on the scene whenever a fresh scene is loaded/generated/cleared.
  useLayoutEffect(() => {
    if (!pendingCenterRef.current) return
    pendingCenterRef.current = false
    const wrap = canvasWrapRef.current
    if (!wrap) return
    wrap.scrollLeft = (scene.viewport.width * PIXELS_PER_FOOT * zoom) / 2 - wrap.clientWidth / 2
    wrap.scrollTop = (scene.viewport.height * PIXELS_PER_FOOT * zoom) / 2 - wrap.clientHeight / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  function pushHistory() {
    setHistory((current) => [...current, { scene, stamps }].slice(-30))
  }

  function undo() {
    setHistory((current) => {
      if (current.length === 0) return current
      const previous = current[current.length - 1]
      setScene(previous.scene)
      setStamps(previous.stamps)
      return current.slice(0, -1)
    })
  }

  function deselectAll() {
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setMultiSelectedFeatureIds(new Set())
    setSelectedPoints([])
    setPointContextMenu(null)
    setPendingJoin(null)
    setDraggingVertex(null)
    setDraggingWholeFeature(null)
    setCropBox(null)
    setCropDragStart(null)
    setAreaSelectBox(null)
    setAreaSelectDragStart(null)
    setTaperPoints([])
    setFreehandPoints([])
    setLineStart(null)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'Escape') {
        deselectAll()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedStampId) { deleteStamp(selectedStampId); return }
        if (selectedFeatureId) deleteSelectedFeature()
        return
      }
      if (event.key === 'Enter' && (multiSelectedFeatureIds.size > 0 || selectedFeatureId)) {
        event.preventDefault()
        applyBezierToSelection()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const shortcutTool = TOOL_BY_SHORTCUT.get(event.key.toLowerCase())
      if (shortcutTool) selectTool(shortcutTool)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStampId, selectedFeatureId, multiSelectedFeatureIds, scene, history])

  function applyBezierToSelection() {
    const ids = multiSelectedFeatureIds.size > 0 ? [...multiSelectedFeatureIds] : selectedFeatureId ? [selectedFeatureId] : []
    const selected = ids
      .map((id) => scene.features.find((feature) => feature.id === id))
      .filter((feature): feature is RoadFeature => Boolean(feature) && feature?.geometry.type === 'LineString')
    if (selected.length === 0) return
    let chain: Position[] = [...(selected[0].geometry as { coordinates: Position[] }).coordinates]
    const remaining = selected.slice(1)
    while (remaining.length > 0) {
      const chainEnd = chain.at(-1)!
      let bestIndex = 0
      let bestReversed = false
      let bestDistance = Number.POSITIVE_INFINITY
      remaining.forEach((feature, index) => {
        const coordinates = (feature.geometry as { coordinates: Position[] }).coordinates
        const distanceToStart = Math.hypot(chainEnd[0] - coordinates[0][0], chainEnd[1] - coordinates[0][1])
        const distanceToEnd = Math.hypot(chainEnd[0] - coordinates.at(-1)![0], chainEnd[1] - coordinates.at(-1)![1])
        if (distanceToStart < bestDistance) { bestDistance = distanceToStart; bestIndex = index; bestReversed = false }
        if (distanceToEnd < bestDistance) { bestDistance = distanceToEnd; bestIndex = index; bestReversed = true }
      })
      const next = remaining.splice(bestIndex, 1)[0]
      const coordinates = (next.geometry as { coordinates: Position[] }).coordinates
      chain = [...chain, ...(bestReversed ? [...coordinates].reverse() : coordinates)]
    }
    const smoothed = smoothPolyline(chain)
    const base = selected[0]
    const smoothedFeature: RoadFeature = {
      ...base,
      id: `${base.id}-smooth-${Math.random().toString(36).slice(2, 8)}`,
      geometry: { type: 'LineString', coordinates: smoothed },
    }
    pushHistory()
    updateFeatures((features) => [...features.filter((feature) => !ids.includes(feature.id)), smoothedFeature])
    setSelectedFeatureId(smoothedFeature.id)
    setMultiSelectedFeatureIds(new Set())
  }

  async function retrySpatialService() {
    setSpatialServiceStatus('checking')
    const available = await probeSpatialService()
    setSpatialServiceStatus(available ? 'connected' : 'unavailable')
  }

  async function clearSceneCache() {
    setCacheNotice('Clearing cached pulls…')
    try {
      const removed = await clearRoadSceneCache()
      setCacheNotice(`Cleared ${removed} cached pull${removed === 1 ? '' : 's'}. Re-pull the location to fetch fresh data.`)
    } catch (error) {
      setCacheNotice(error instanceof Error ? error.message : 'Could not clear the spatial cache.')
    }
  }

  async function loadRoadLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validateRoadLocation(locationRequest)
    setLocationErrors(errors)
    if (errors.length > 0) return
    setLocationLoading(true)
    const resolved = await resolveRoadLocation(locationRequest)
    setScene(resolved.scene)
    setResolvedLocation(resolved)
    setStamps([])
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setSceneNameHint(null)
    setLoadTemplatesOpen(false)
    setLocationLoading(false)
    setHistory([])
    setPavementUnlocked(false)
    setAnchors({})
    pendingCenterRef.current = true
  }

  function generateHighway() {
    setScene(generateHighwayScene(highwayGeneratorOptions))
    setResolvedLocation(null)
    setStamps([])
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setSceneNameHint(defaultGeneratedHighwayName(highwayGeneratorOptions))
    setLoadTemplatesOpen(false)
    setHistory([])
    setPavementUnlocked(false)
    setAnchors({})
    pendingCenterRef.current = true
  }

  function loadExistingTemplate(entry: LocationTemplateEntry) {
    setLoadTemplatesOpen(false)
    try {
      const document = parseLocationTemplateDocument(entry.document)
      setScene(document.scene)
      setStamps(document.stamps)
      setLocationRequest(document.locationRequest)
      setResolvedLocation(null)
      setSelectedFeatureId(null)
      setSelectedStampId(null)
      setSceneNameHint(entry.name)
      setHistory([])
      setPavementUnlocked(false)
      setAnchors({})
      pendingCenterRef.current = true
    } catch (error) {
      window.alert(error instanceof Error ? `Could not load template: ${error.message}` : 'Could not load template.')
    }
  }

  function clearAll() {
    pushHistory()
    setScene((current) => ({
      ...current,
      source: {
        type: 'reference-layout',
        dataset: 'Blank canvas',
        generatedAt: new Date().toISOString(),
        attribution: 'Magnus location template creator; blank working canvas.',
      },
      features: [],
    }))
    setStamps([])
    setResolvedLocation(null)
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setMultiSelectedFeatureIds(new Set())
    setSelectedPoints([])
    setAnchors({})
    setPavementUnlocked(false)
    setSceneNameHint('Untitled corridor')
    pendingCenterRef.current = true
  }

  function updateFeatures(updater: (features: RoadFeature[]) => RoadFeature[]) {
    setScene((current) => ({ ...current, features: updater(current.features) }))
  }

  function deleteSelectedFeature() {
    if (!selectedFeatureId) return
    pushHistory()
    updateFeatures((features) => features.filter((feature) => feature.id !== selectedFeatureId))
    setSelectedFeatureId(null)
  }

  function handleFeatureClick(event: React.MouseEvent<SVGPathElement>, feature: RoadFeature) {
    if (!SELECTING_TOOLS.includes(tool)) return
    if (!pavementUnlocked && isPavementFeature(feature)) return
    event.stopPropagation()
    const svg = svgRef.current
    if (tool === 'split' && svg) {
      const point = toSvgPoint(svg, event.clientX, event.clientY)
      const split = splitFeatureWithGap(feature, point, 10)
      if (split) {
        pushHistory()
        updateFeatures((features) => [...features.filter((item) => item.id !== feature.id), ...split])
      }
      return
    }
    if (tool === 'select' && event.ctrlKey) {
      setSelectedFeatureId(null)
      setMultiSelectedFeatureIds((current) => {
        const next = new Set(current)
        if (next.has(feature.id)) next.delete(feature.id)
        else next.add(feature.id)
        return next
      })
      return
    }
    setSelectedStampId(null)
    setMultiSelectedFeatureIds(new Set())
    setSelectedFeatureId(feature.id)
  }

  function handleFeatureBodyPointerDown(event: React.PointerEvent<SVGPathElement>, feature: RoadFeature) {
    if (tool !== 'select' || event.ctrlKey || feature.id !== selectedFeatureId) return
    if (!pavementUnlocked && isPavementFeature(feature)) return
    event.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const point = toSvgPoint(svg, event.clientX, event.clientY)
    pushHistory()
    setDraggingWholeFeature({ featureId: feature.id, startPoint: point, originalFeature: feature })
  }

  function handleEndpointPointerDown(event: React.PointerEvent<SVGCircleElement>, endpoint: EndpointRef) {
    event.stopPropagation()
    if (tool !== 'join') return
    if (!pendingJoin || pendingJoin.featureId === endpoint.featureId) {
      setPendingJoin(endpoint)
      return
    }
    const a = scene.features.find((feature) => feature.id === pendingJoin.featureId)
    const b = scene.features.find((feature) => feature.id === endpoint.featureId)
    if (a && b) {
      const joined = joinFeatures(a, pendingJoin.end, b, endpoint.end)
      if (joined) {
        pushHistory()
        updateFeatures((features) => [...features.filter((item) => item.id !== a.id && item.id !== b.id), joined])
      }
    }
    setPendingJoin(null)
  }

  function handleVertexPointerDown(event: React.PointerEvent<SVGCircleElement>, vertex: VertexRef) {
    event.stopPropagation()
    const allowed = tool === 'points' || (tool === 'select' && vertex.featureId === selectedFeatureId)
    if (!allowed) return
    if (event.ctrlKey) {
      setSelectedPoints((current) => {
        const exists = current.some((point) => point.featureId === vertex.featureId && point.vertexIndex === vertex.vertexIndex)
        if (exists) return current.filter((point) => !(point.featureId === vertex.featureId && point.vertexIndex === vertex.vertexIndex))
        const sameFeature = current.filter((point) => point.featureId === vertex.featureId)
        return [...sameFeature, vertex].slice(-2)
      })
      return
    }
    const isPairSelected = selectedPoints.length === 2
      && selectedPoints.every((point) => point.featureId === vertex.featureId)
      && selectedPoints.some((point) => point.vertexIndex === vertex.vertexIndex)
    if (isPairSelected) {
      const feature = scene.features.find((item) => item.id === vertex.featureId)
      const svg = svgRef.current
      if (feature && svg) {
        const point = toSvgPoint(svg, event.clientX, event.clientY)
        pushHistory()
        setDraggingWholeFeature({ featureId: feature.id, startPoint: point, originalFeature: feature })
      }
      return
    }
    pushHistory()
    setDraggingVertex({ featureId: vertex.featureId, vertexIndex: vertex.vertexIndex })
  }

  function handleVertexContextMenu(event: React.MouseEvent<SVGCircleElement>, vertex: VertexRef) {
    event.preventDefault()
    event.stopPropagation()
    setPointContextMenu({ featureId: vertex.featureId, vertexIndex: vertex.vertexIndex, x: event.clientX, y: event.clientY })
  }

  function anchorContextPoint() {
    if (!pointContextMenu) return
    const { featureId, vertexIndex } = pointContextMenu
    setAnchors((current) => ({ ...current, [featureId]: new Set([...(current[featureId] ?? []), vertexIndex]) }))
    setPointContextMenu(null)
  }

  function detachContextPoint() {
    if (!pointContextMenu) return
    const { featureId, vertexIndex } = pointContextMenu
    setAnchors((current) => {
      const existing = current[featureId]
      if (!existing) return current
      const next = new Set(existing)
      next.delete(vertexIndex)
      return { ...current, [featureId]: next }
    })
    setPointContextMenu(null)
  }

  function detachAllLinePoints() {
    if (!pointContextMenu) return
    const { featureId } = pointContextMenu
    setAnchors((current) => {
      const next = { ...current }
      delete next[featureId]
      return next
    })
    setPointContextMenu(null)
  }

  function handleVertexDoubleClick(event: React.MouseEvent<SVGCircleElement>, vertex: VertexRef) {
    event.stopPropagation()
    if (!anchors[vertex.featureId]?.has(vertex.vertexIndex)) return
    pushHistory()
    setAnchors((current) => {
      const existing = current[vertex.featureId]
      if (!existing) return current
      const next = new Set(existing)
      next.delete(vertex.vertexIndex)
      return { ...current, [vertex.featureId]: next }
    })
  }

  function handleFeatureDoubleClick(event: React.MouseEvent<SVGPathElement>, feature: RoadFeature) {
    if (!pavementUnlocked && isPavementFeature(feature)) return
    event.stopPropagation()
    if (!anchors[feature.id] || anchors[feature.id].size === 0) return
    pushHistory()
    setAnchors((current) => {
      const next = { ...current }
      delete next[feature.id]
      return next
    })
  }

  function handleVertexClick(feature: RoadFeature, vertexIndex: number) {
    if (tool !== 'round-corner') return
    const rounded = roundVertex(feature, vertexIndex, roundRadius)
    if (rounded) {
      pushHistory()
      updateFeatures((features) => features.map((item) => (item.id === feature.id ? rounded : item)))
    }
  }

  function buildPavementFeatures(centerline: Position[], idSeed: string): RoadFeature[] {
    const laneHalfWidth = (pavementLanes * 12) / 2
    const leftShoulder = pavementShoulders === 'left' || pavementShoulders === 'both' ? 12 : 0
    const rightShoulder = pavementShoulders === 'right' || pavementShoulders === 'both' ? 12 : 0
    const leftWidths = centerline.map(() => laneHalfWidth + leftShoulder)
    const rightWidths = centerline.map(() => laneHalfWidth + rightShoulder)
    const surfaceProfile: PaintProfile = { centerline, leftWidths, rightWidths }
    const casingProfile: PaintProfile = { centerline, leftWidths: leftWidths.map((width) => width + 2), rightWidths: rightWidths.map((width) => width + 2) }
    const properties = { name: 'Hand-drawn pavement', highway: 'motorway_link', lanes: pavementLanes, direction: 'forward' as const }
    const features: RoadFeature[] = [
      { id: `pavement-${idSeed}-casing`, kind: 'road-casing', layer: 1, geometry: { type: 'Polygon', coordinates: [variableWidthRibbon(casingProfile)] }, properties: { ...properties, paintProfile: casingProfile } },
      { id: `pavement-${idSeed}-surface`, kind: 'road-surface', layer: 1, geometry: { type: 'Polygon', coordinates: [variableWidthRibbon(surfaceProfile)] }, properties: { ...properties, paintProfile: surfaceProfile } },
    ]
    if (leftShoulder > 0) {
      features.push({ id: `pavement-${idSeed}-left-shoulder`, kind: 'shoulder-edge', layer: 1, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, leftWidths, 'left') }, properties: { direction: 'forward', renderWidthFeet: 1 } })
    }
    if (rightShoulder > 0) {
      features.push({ id: `pavement-${idSeed}-right-shoulder`, kind: 'shoulder-edge', layer: 1, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, rightWidths, 'right') }, properties: { direction: 'forward', renderWidthFeet: 1 } })
    }
    if (pavementFogLines) {
      features.push(
        { id: `pavement-${idSeed}-left-fog`, kind: 'left-fog-line', layer: 2, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, laneHalfWidth, 'left') }, properties: { direction: 'forward', renderWidthFeet: 0.6 } },
        { id: `pavement-${idSeed}-right-fog`, kind: 'right-fog-line', layer: 2, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, laneHalfWidth, 'right') }, properties: { direction: 'forward', renderWidthFeet: 0.6 } },
      )
    }
    return features
  }

  function eraseAtPoint(point: Position) {
    updateFeatures((features) => features.map((feature) => {
      if (!feature.properties.paintProfile) return feature
      const erased = paintPavementProfile(feature.properties.paintProfile, point, 2.5)
      return { ...feature, geometry: { type: 'Polygon', coordinates: [variableWidthRibbon(erased)] }, properties: { ...feature.properties, paintProfile: erased } }
    }))
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const point = toSvgPoint(event.currentTarget, event.clientX, event.clientY)
    if (tool === 'crop') {
      setCropDragStart(point)
      setCropBox({ minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] })
      return
    }
    if (tool === 'area-select') {
      setAreaSelectDragStart(point)
      setAreaSelectBox({ minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] })
      return
    }
    if (tool === 'pavement' && pavementUnlocked) {
      pushHistory()
      paintStrokeIdRef.current = crypto.randomUUID().slice(0, 8)
      paintCenterlineRef.current = [point]
      setPavementPoints([point])
      return
    }
    if (tool === 'erase-pavement' && pavementUnlocked) {
      pushHistory()
      isErasingRef.current = true
      eraseAtPoint(point)
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget
    const point = toSvgPoint(svg, event.clientX, event.clientY)
    if (tool === 'erase-pavement') setErasePreview(point)
    if (tool === 'pavement' && paintStrokeIdRef.current) {
      const last = paintCenterlineRef.current.at(-1)
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 4) {
        paintCenterlineRef.current = [...paintCenterlineRef.current, point]
        setPavementPoints(paintCenterlineRef.current)
        const idSeed = paintStrokeIdRef.current
        if (paintCenterlineRef.current.length >= 2) {
          updateFeatures((features) => [
            ...features.filter((feature) => !feature.id.startsWith(`pavement-${idSeed}-`)),
            ...buildPavementFeatures(paintCenterlineRef.current, idSeed),
          ])
        }
      }
      return
    }
    if (tool === 'erase-pavement' && isErasingRef.current) {
      eraseAtPoint(point)
      return
    }
    if (cropDragStart) {
      setCropBox({
        minX: Math.min(cropDragStart[0], point[0]),
        maxX: Math.max(cropDragStart[0], point[0]),
        minY: Math.min(cropDragStart[1], point[1]),
        maxY: Math.max(cropDragStart[1], point[1]),
      })
      return
    }
    if (areaSelectDragStart) {
      setAreaSelectBox({
        minX: Math.min(areaSelectDragStart[0], point[0]),
        maxX: Math.max(areaSelectDragStart[0], point[0]),
        minY: Math.min(areaSelectDragStart[1], point[1]),
        maxY: Math.max(areaSelectDragStart[1], point[1]),
      })
      return
    }
    if (draggingWholeFeature) {
      const dx = point[0] - draggingWholeFeature.startPoint[0]
      const dy = point[1] - draggingWholeFeature.startPoint[1]
      updateFeatures((features) => features.map((item) => (
        item.id === draggingWholeFeature.featureId ? translateFeature(draggingWholeFeature.originalFeature, dx, dy) : item
      )))
      return
    }
    if (draggingVertex) {
      const feature = scene.features.find((item) => item.id === draggingVertex.featureId)
      if (feature?.geometry.type !== 'LineString') return
      const coordinates = feature.geometry.coordinates
      const featureAnchors = anchors[feature.id]
      const otherAnchorIndex = featureAnchors && featureAnchors.size > 0 && !featureAnchors.has(draggingVertex.vertexIndex)
        ? [...featureAnchors][0]
        : null
      if (otherAnchorIndex !== null) {
        const pivot = coordinates[otherAnchorIndex]
        const original = coordinates[draggingVertex.vertexIndex]
        const target = event.ctrlKey ? snapAngleTo45(pivot, point) : point
        const angleBefore = Math.atan2(original[1] - pivot[1], original[0] - pivot[0])
        const angleAfter = Math.atan2(target[1] - pivot[1], target[0] - pivot[0])
        const degrees = ((angleAfter - angleBefore) * 180) / Math.PI
        updateFeatures((features) => features.map((item) => (item.id === feature.id ? rotateFeatureAroundPoint(item, pivot, degrees) : item)))
        return
      }
      const isEndpoint = draggingVertex.vertexIndex === 0 || draggingVertex.vertexIndex === coordinates.length - 1
      let target = point
      if (event.ctrlKey) {
        const adjacentIndex = draggingVertex.vertexIndex === 0
          ? 1
          : draggingVertex.vertexIndex === coordinates.length - 1
            ? coordinates.length - 2
            : draggingVertex.vertexIndex - 1
        target = snapAngleTo45(coordinates[adjacentIndex], point)
      }
      if (isEndpoint) target = findSnapPoint(endpoints, target, SNAP_RADIUS_FEET, feature.id) ?? target
      updateFeatures((features) => features.map((item) => (item.id === feature.id ? updateVertex(item, draggingVertex.vertexIndex, target) ?? item : item)))
    }
  }

  function handleCanvasPointerUp() {
    if (areaSelectDragStart && areaSelectBox) {
      const inBox = scene.features.filter((feature) => featureWithinBox(feature, areaSelectBox)).map((feature) => feature.id)
      setMultiSelectedFeatureIds(new Set(inBox))
    }
    paintStrokeIdRef.current = null
    paintCenterlineRef.current = []
    isErasingRef.current = false
    setPavementPoints([])
    setDraggingVertex(null)
    setDraggingWholeFeature(null)
    setCropDragStart(null)
    setAreaSelectDragStart(null)
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget
    const point = toSvgPoint(svg, event.clientX, event.clientY)
    if (tool === 'taper') {
      setTaperPoints((current) => [...current, point])
      return
    }
    if (tool === 'freehand') {
      setFreehandPoints((current) => [...current, point])
      return
    }
    if (tool === 'stamp' && armedStamp) {
      pushHistory()
      const stamp: PlacedStamp = { id: crypto.randomUUID(), kind: armedStamp, position: point, rotation: 0, scale: 1 }
      setStamps((current) => [...current, stamp])
      setSelectedStampId(stamp.id)
      setSelectedFeatureId(null)
      return
    }
    if (tool === 'line') {
      if (!lineStart) {
        setLineStart(point)
        return
      }
      pushHistory()
      const created = commitLinePattern(linePattern, [lineStart, point], crypto.randomUUID().slice(0, 8))
      updateFeatures((features) => [...features, ...created])
      setLineStart(null)
      return
    }
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setPendingJoin(null)
    setMultiSelectedFeatureIds(new Set())
  }

  function generateOffset() {
    if (selectedFeature?.geometry.type !== 'LineString') return
    const pattern = LINE_PATTERNS_FOR_OFFSET.find((option) => option.id === offsetPatternId) ?? LINE_PATTERNS_FOR_OFFSET[0]
    const coordinates = offsetPolyline(selectedFeature.geometry.coordinates, offsetDistance, offsetSide)
    const created: RoadFeature = {
      id: `offset-${crypto.randomUUID().slice(0, 8)}`,
      kind: pattern.kind,
      layer: selectedFeature.layer,
      geometry: { type: 'LineString', coordinates },
      properties: { ...selectedFeature.properties, renderWidthFeet: pattern.kind === 'shoulder-edge' ? 1 : 0.6 },
    }
    pushHistory()
    updateFeatures((features) => [...features, created])
  }

  function finishTaper() {
    if (taperPoints.length < 3) return
    const feature: RoadFeature = {
      id: `taper-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'semantic-marking',
      layer: 1,
      geometry: taperGeometry(taperPoints),
      properties: { markingType: 'taper' },
    }
    pushHistory()
    updateFeatures((features) => [...features, feature])
    setTaperPoints([])
  }

  function applyCrop() {
    if (!cropBox) return
    pushHistory()
    updateFeatures((features) => cropFeaturesToBoundingBox(features, cropBox))
    setCropBox(null)
  }

  function rotateSelectedFeature(degrees: number) {
    if (selectedFeature?.geometry.type !== 'LineString') return
    const featureAnchors = anchors[selectedFeature.id]
    const pivot = featureAnchors && featureAnchors.size > 0
      ? selectedFeature.geometry.coordinates[[...featureAnchors][0]]
      : centroidOf(selectedFeature.geometry.coordinates)
    pushHistory()
    updateFeatures((features) => features.map((item) => (item.id === selectedFeature.id ? rotateFeatureAroundPoint(item, pivot, degrees) : item)))
  }

  function finishFreehand() {
    if (freehandPoints.length < 2) return
    const created = commitLinePattern(linePattern, freehandPoints, crypto.randomUUID().slice(0, 8))
    pushHistory()
    updateFeatures((features) => [...features, ...created])
    setFreehandPoints([])
  }

  function updateStamp(id: string, updates: Partial<PlacedStamp>) {
    setStamps((current) => current.map((stamp) => (stamp.id === id ? { ...stamp, ...updates } : stamp)))
  }

  function deleteStamp(id: string) {
    pushHistory()
    setStamps((current) => current.filter((stamp) => stamp.id !== id))
    if (selectedStampId === id) setSelectedStampId(null)
  }


  function openSavePanel() {
    setTemplateName(sceneNameHint ?? defaultLocationTemplateName(locationRequest))
    setSaveOpen(true)
  }

  function renderLocationTemplate() {
    const bakedFeatures = [...scene.features, ...stamps.flatMap((stamp) => bakeStampToFeatures(stamp))]
    const bakedScene: RoadScene = { ...scene, features: bakedFeatures }
    const svg = renderLocationTemplateSvg(scene, stamps)
    const name = locationTemplateFileBaseName(templateName)
    const document: LocationTemplateDocument = {
      version: 1,
      name,
      savedAt: new Date().toISOString(),
      locationRequest,
      scene: bakedScene,
      stamps,
      svg,
    }
    saveLocationTemplate(localStorage, name, JSON.stringify(document), document.savedAt)
    setSavedTemplates(listLocationTemplates(localStorage))
    setSceneNameHint(name)
    setSaveStatus('saved')
    setSaveOpen(false)
  }

  function downloadSvgPreview() {
    const svg = renderLocationTemplateSvg(scene, stamps)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${locationTemplateFileBaseName(templateName || defaultLocationTemplateName(locationRequest))}.svg`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const activeToolDefinition = TOOL_DEFINITIONS.find((definition) => definition.id === tool) ?? TOOL_DEFINITIONS[0]
  const selectedLine = selectedFeature?.geometry.type === 'LineString' ? selectedFeature : null
  const sceneTitle = sceneNameHint ?? (resolvedLocation ? normalizeHighway(resolvedLocation.request.highway) : 'Untitled corridor')

  function toolHint(): string {
    switch (tool) {
      case 'select':
        return selectedFeature
          ? 'Drag the line to move it · Delete removes it · Ctrl+click adds more lines'
          : 'Click a line to select it · Ctrl+click to multi-select · Enter smooths a multi-selection'
      case 'area-select':
        return 'Drag a box; every line inside it is selected · Enter smooths the selection'
      case 'points':
        return 'Drag a point to hinge the line · Ctrl locks to 45° · Right-click a point to anchor/detach'
      case 'line':
        return lineStart ? 'Click the end point' : 'Click the start point'
      case 'freehand':
        return 'Click to place each point of the path, then Finish'
      case 'taper':
        return 'Click points to enclose a taper, gore, or pocket area, then Finish shape'
      case 'stamp':
        return armedStamp ? `Click the canvas to place a ${STAMP_GLYPHS[armedStamp].label.toLowerCase()}` : 'Pick a stamp in the panel'
      case 'join':
        return pendingJoin ? 'Click the second endpoint to connect' : 'Click two open endpoints to connect them'
      case 'split':
        return 'Click a line where it should break — leaves a 10 ft gap'
      case 'round-corner':
        return selectedLine ? 'Click a highlighted vertex to round it' : 'Click a line to select it, then click a vertex'
      case 'offset':
        return selectedLine ? 'Set distance and side, then generate' : 'Click a line to offset'
      case 'crop':
        return cropBox ? 'Apply to discard everything outside the box' : 'Drag a rectangle around the area to keep'
      case 'pavement':
        return 'Drag a brush stroke; width follows the lane and shoulder settings'
      case 'erase-pavement':
        return '~5 ft circular brush — drag across pavement to narrow it'
    }
  }

  function handleWrapPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const svg = svgRef.current
    if (!svg) return
    setCursorFeet(toSvgPoint(svg, event.clientX, event.clientY))
  }

  function renderToolOptions() {
    const finishActions = (count: number, minimum: number, finish: () => void, clear: () => void, finishLabel: string) => (
      <div className="loc-editor-actions">
        <span>{count} point{count === 1 ? '' : 's'} placed</span>
        <button type="button" className="primary" disabled={count < minimum} onClick={finish}>{finishLabel}</button>
        <button type="button" disabled={count === 0} onClick={clear}>Clear</button>
      </div>
    )
    const patternField = (
      <label className="loc-editor-field">
        MUTCD line pattern
        <select
          value={linePattern.id}
          onChange={(event) => setLinePattern(MUTCD_LINE_PATTERNS.find((option) => option.id === event.target.value) ?? MUTCD_LINE_PATTERNS[0])}
        >
          {MUTCD_LINE_PATTERNS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
        </select>
      </label>
    )
    const smoothAction = multiSelectedFeatureIds.size > 0 && (
      <button type="button" className="loc-editor-action primary" onClick={applyBezierToSelection}>
        <Spline size={14} /> Smooth {multiSelectedFeatureIds.size} lines (Bezier)
      </button>
    )

    switch (tool) {
      case 'select':
        return (
          <>
            <div className="loc-editor-subheading">Selected line</div>
            <div className="loc-editor-button-row">
              <button type="button" disabled={!selectedLine} onClick={() => rotateSelectedFeature(-45)}><RotateCcw size={14} /> Rotate −45°</button>
              <button type="button" disabled={!selectedLine} onClick={() => rotateSelectedFeature(45)}><RotateCw size={14} /> Rotate +45°</button>
            </div>
            <p className="loc-editor-note">Rotation pivots on the anchored point if one is set, otherwise the line's center.</p>
            {smoothAction}
          </>
        )
      case 'area-select':
        return smoothAction || <p className="loc-editor-note">Nothing selected yet.</p>
      case 'points':
        return (
          <p className="loc-editor-note">
            Ctrl+click two points on the same line, release Ctrl, then drag either one to move the whole line.
            Anchoring a point lets you rotate the rest of the line around it.
          </p>
        )
      case 'line':
        return patternField
      case 'freehand':
        return (
          <>
            {patternField}
            {finishActions(freehandPoints.length, 2, finishFreehand, () => setFreehandPoints([]), 'Finish line')}
          </>
        )
      case 'taper':
        return finishActions(taperPoints.length, 3, finishTaper, () => setTaperPoints([]), 'Finish shape')
      case 'stamp':
        return (
          <div className="loc-editor-stamp-grid">
            {STAMP_KINDS.map((kind) => (
              <button
                type="button"
                key={kind}
                className={armedStamp === kind ? 'active' : ''}
                title={STAMP_GLYPHS[kind].label}
                onClick={() => setArmedStamp(kind)}
              >
                <svg viewBox="-8 -8 16 16" aria-hidden="true">
                  {STAMP_GLYPHS[kind].strokes.map((stroke, index) => (
                    <polyline key={index} points={stroke.map(([x, y]) => `${x},${y}`).join(' ')} />
                  ))}
                </svg>
                <small>{STAMP_GLYPHS[kind].label}</small>
              </button>
            ))}
          </div>
        )
      case 'join':
        return <p className="loc-editor-note">Open endpoints are highlighted in blue. {pendingJoin ? 'First endpoint chosen.' : ''}</p>
      case 'split':
        return <p className="loc-editor-note">Splitting leaves a 10 ft gap so the two halves can be edited independently.</p>
      case 'round-corner':
        return (
          <label className="loc-editor-field">
            Radius (ft)
            <input type="number" min={1} max={200} value={roundRadius} onChange={(event) => setRoundRadius(Number(event.target.value))} />
          </label>
        )
      case 'offset':
        return (
          <>
            <label className="loc-editor-field">
              Distance (ft)
              <input type="number" min={1} max={100} value={offsetDistance} onChange={(event) => setOffsetDistance(Number(event.target.value))} />
            </label>
            <label className="loc-editor-field">
              Side
              <select value={offsetSide} onChange={(event) => setOffsetSide(event.target.value as 'left' | 'right')}>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="loc-editor-field">
              New line type
              <select value={offsetPatternId} onChange={(event) => setOffsetPatternId(event.target.value)}>
                {LINE_PATTERNS_FOR_OFFSET.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" className="loc-editor-action primary" disabled={!selectedLine} onClick={generateOffset}>
              <MoveHorizontal size={14} /> Generate parallel offset
            </button>
          </>
        )
      case 'crop':
        return cropBox ? (
          <div className="loc-editor-actions">
            <button type="button" className="primary" onClick={applyCrop}>Apply crop</button>
            <button type="button" onClick={() => setCropBox(null)}>Cancel</button>
          </div>
        ) : <p className="loc-editor-note">Everything outside the box is discarded when you apply.</p>
      case 'pavement':
        return (
          <>
            <label className="loc-editor-field">
              Lanes
              <select value={pavementLanes} onChange={(event) => setPavementLanes(Number(event.target.value) as 1 | 2 | 3)}>
                <option value={1}>1 lane</option>
                <option value={2}>2 lanes</option>
                <option value={3}>3 lanes</option>
              </select>
            </label>
            <label className="loc-editor-field">
              Shoulders
              <select value={pavementShoulders} onChange={(event) => setPavementShoulders(event.target.value as typeof pavementShoulders)}>
                <option value="none">None</option>
                <option value="left">Left shoulder</option>
                <option value="right">Right shoulder</option>
                <option value="both">Both shoulders</option>
              </select>
            </label>
            <label className="loc-editor-check">
              <input type="checkbox" checked={pavementFogLines} onChange={(event) => setPavementFogLines(event.target.checked)} />
              Add fog lines
            </label>
            {pavementPoints.length > 0 && <p className="loc-editor-note">Painting… {pavementPoints.length} point{pavementPoints.length === 1 ? '' : 's'}</p>}
          </>
        )
      case 'erase-pavement':
        return <p className="loc-editor-note">Use short strokes along the pavement edge to sculpt tapers.</p>
    }
  }

  return (
    <section className="loc-editor" aria-label="Location template creator">
      <header className="loc-editor-topbar">
        <div className="loc-editor-title">
          <span>Location template</span>
          <h2>{sceneTitle}</h2>
        </div>

        <div className="loc-editor-toolbar-group" role="group" aria-label="File">
          <button type="button" onClick={clearAll} title="Clear the canvas back to an empty scene"><FilePlus size={15} /> New</button>
          <div className="loc-editor-menu-anchor">
            <button type="button" aria-expanded={loadTemplatesOpen} aria-haspopup="menu" onClick={() => { setLoadTemplatesOpen((open) => !open); setSourceOpen(false) }}>
              <FolderOpen size={15} /> Load <ChevronDown size={13} />
            </button>
            {loadTemplatesOpen && (
              <div className="loc-editor-menu" role="menu" aria-label="Existing location templates">
                {availableTemplates.map((entry) => (
                  <button type="button" role="menuitem" key={entry.name} onClick={() => loadExistingTemplate(entry)}>
                    <b>{entry.name}</b>
                    <small>{isBuiltInLocationTemplate(entry.name) ? 'Built-in template' : new Date(entry.savedAt).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="accent" onClick={openSavePanel} title="Save to your local template library"><Save size={15} /> Save</button>
          <button type="button" onClick={downloadSvgPreview} title="Download current SVG preview"><Download size={15} /> Export SVG</button>
        </div>

        <div className="loc-editor-toolbar-group" role="group" aria-label="Edit">
          <button type="button" disabled={history.length === 0} onClick={undo} title="Undo last operation (Ctrl+Z)">
            <Undo2 size={15} /> Undo{history.length > 0 ? ` (${history.length})` : ''}
          </button>
        </div>

        <div className="loc-editor-toolbar-group loc-editor-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={zoomOut} title="Zoom out"><ZoomOut size={15} /></button>
          <button type="button" className="loc-editor-zoom-value" onClick={resetZoom} title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={zoomIn} title="Zoom in"><ZoomIn size={15} /></button>
        </div>

        <div className="loc-editor-menu-anchor loc-editor-source-anchor">
          <button
            type="button"
            className={sourceOpen ? 'active' : ''}
            aria-expanded={sourceOpen}
            aria-haspopup="dialog"
            onClick={() => { setSourceOpen((open) => !open); setLoadTemplatesOpen(false) }}
            title="Roadway lookup and highway generator"
          >
            <MapPinned size={15} /> Source
            <span className={`loc-editor-service-dot ${spatialServiceStatus}`} aria-hidden="true" />
          </button>
        </div>

        {saveStatus === 'saved' && <span className="loc-editor-saved-note">Template saved</span>}
        <button className="loc-editor-close" type="button" title="Close location template creator" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      {sourceOpen && (
        <div className="loc-editor-source" role="dialog" aria-label="Scene source">
          <div className={`loc-editor-service ${spatialServiceStatus}`} role="status" aria-live="polite">
            <span className="loc-editor-service-dot" aria-hidden="true" />
            <div>
              <b>Spatial service</b>
              <small>
                {spatialServiceStatus === 'connected' ? 'Connected' : spatialServiceStatus === 'checking' ? 'Checking connection' : 'Development preview available'}
              </small>
            </div>
            {spatialServiceStatus === 'unavailable' && (
              <button type="button" title="Retry spatial service connection" onClick={() => { void retrySpatialService() }}>
                <RefreshCw size={14} />
              </button>
            )}
            {spatialServiceStatus === 'connected' && (
              <button type="button" title="Clear cached location pulls so the next pull fetches fresh data" onClick={() => { void clearSceneCache() }}>
                <Eraser size={14} />
              </button>
            )}
          </div>
          {cacheNotice && <p className="loc-editor-cache-notice" role="status">{cacheNotice}</p>}

          <form className="loc-editor-source-section" aria-label="Roadway location" onSubmit={(event) => { void loadRoadLocation(event) }}>
            <div className="loc-editor-source-heading">
              <MapPinned size={16} />
              <div>
                <label htmlFor="loc-creator-highway">Roadway location</label>
                <span>Look up scaled corridor geometry</span>
              </div>
            </div>
            <div className="loc-editor-fields">
              <label className="span-2" htmlFor="loc-creator-highway">
                Highway
                <input
                  id="loc-creator-highway"
                  placeholder="I-95 or Route 28"
                  value={locationRequest.highway}
                  onChange={(event) => setLocationRequest((current) => ({ ...current, highway: event.target.value }))}
                />
              </label>
              <label htmlFor="loc-creator-reference-type">
                Reference
                <select
                  id="loc-creator-reference-type"
                  value={locationRequest.referenceType}
                  onChange={(event) => setLocationRequest((current) => ({
                    ...current,
                    referenceType: event.target.value as RoadLocationRequest['referenceType'],
                    reference: '',
                  }))}
                >
                  <option value="mile-marker">Mile marker</option>
                  <option value="exit">Exit number</option>
                </select>
              </label>
              <label htmlFor="loc-creator-reference">
                {locationRequest.referenceType === 'exit' ? 'Exit' : 'Mile marker'}
                <input
                  id="loc-creator-reference"
                  inputMode="decimal"
                  placeholder={locationRequest.referenceType === 'exit' ? '143' : '168.0'}
                  value={locationRequest.reference}
                  onChange={(event) => setLocationRequest((current) => ({ ...current, reference: event.target.value }))}
                />
              </label>
            </div>
            {locationErrors.map((error) => (
              <p className="loc-editor-error" role="alert" key={error}>{error}</p>
            ))}
            <button className="loc-editor-source-submit" type="submit" disabled={locationLoading}>
              {locationLoading ? <LoaderCircle className="loc-editor-spinner" size={15} /> : <MapPinned size={15} />}
              <span>{locationLoading ? 'Resolving location' : 'Render location'}</span>
            </button>
            {resolvedLocation && (
              <div className={`loc-editor-result ${resolvedLocation.source}`} role="status">
                <strong>{resolvedLocation.request.highway}</strong>
                <span>{resolvedLocation.message}</span>
              </div>
            )}
          </form>

          <div className="loc-editor-source-section">
            <div className="loc-editor-source-heading">
              <Wand2 size={16} />
              <div>
                <label htmlFor="loc-creator-generator-lanes">Generic highway generator</label>
                <span>Build a scale reference from scratch</span>
              </div>
            </div>
            <div className="loc-editor-fields">
              <label htmlFor="loc-creator-generator-lanes">
                Lanes
                <select
                  id="loc-creator-generator-lanes"
                  value={highwayGeneratorOptions.lanes}
                  onChange={(event) => setHighwayGeneratorOptions((current) => ({ ...current, lanes: Number(event.target.value) as HighwayGeneratorOptions['lanes'] }))}
                >
                  {HIGHWAY_LANE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label htmlFor="loc-creator-generator-direction">
                Direction
                <select
                  id="loc-creator-generator-direction"
                  value={highwayGeneratorOptions.direction}
                  onChange={(event) => setHighwayGeneratorOptions((current) => ({ ...current, direction: event.target.value as HighwayGeneratorOptions['direction'] }))}
                >
                  {HIGHWAY_DIRECTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label htmlFor="loc-creator-generator-aux">
                Auxiliary lane
                <select
                  id="loc-creator-generator-aux"
                  value={highwayGeneratorOptions.auxiliaryLane}
                  onChange={(event) => setHighwayGeneratorOptions((current) => ({ ...current, auxiliaryLane: event.target.value as HighwayGeneratorOptions['auxiliaryLane'] }))}
                >
                  {HIGHWAY_AUXILIARY_LANE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label htmlFor="loc-creator-generator-ramp">
                Ramp
                <select
                  id="loc-creator-generator-ramp"
                  value={highwayGeneratorOptions.ramp}
                  onChange={(event) => setHighwayGeneratorOptions((current) => ({ ...current, ramp: event.target.value as HighwayGeneratorOptions['ramp'] }))}
                >
                  {HIGHWAY_RAMP_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            <button className="loc-editor-source-submit" type="button" onClick={() => { generateHighway(); setSourceOpen(false) }}>
              <Wand2 size={15} />
              <span>Generate highway</span>
            </button>
          </div>
        </div>
      )}

      {saveOpen && (
        <div className="loc-editor-save-panel" role="dialog" aria-label="Save location template">
          <label>
            Template file name
            <input
              autoFocus
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <small>Saved to your local template library as a JSON/SVG state file, e.g. "I-95 Exit 143".</small>
          <div className="loc-editor-save-actions">
            <button type="button" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button type="button" className="primary" onClick={renderLocationTemplate}>Save template</button>
          </div>
        </div>
      )}

      {pointContextMenu && (
        <>
          <div className="loc-creator-context-backdrop" onClick={() => setPointContextMenu(null)} />
          <div className="loc-creator-context-menu" style={{ left: pointContextMenu.x, top: pointContextMenu.y }} role="menu">
            <button type="button" role="menuitem" onClick={anchorContextPoint}><Anchor size={13} /> Anchor point</button>
            <button type="button" role="menuitem" onClick={detachContextPoint}><Unlink size={13} /> Detach point</button>
            <button type="button" role="menuitem" onClick={detachAllLinePoints}><Unlink size={13} /> Detach all line points</button>
          </div>
        </>
      )}

      <div className="loc-editor-body">
        <nav className="loc-editor-rail" aria-label="Location editing tools">
          {TOOL_GROUPS.map((group) => (
            <div className="loc-editor-rail-group" role="group" aria-label={group.label} key={group.label}>
              {group.tools.map((definition) => {
                const Icon = definition.icon
                return (
                  <button
                    type="button"
                    key={definition.id}
                    className={tool === definition.id ? 'active' : ''}
                    aria-pressed={tool === definition.id}
                    aria-label={definition.label}
                    title={`${definition.label} (${definition.shortcut})`}
                    onClick={() => selectTool(definition.id)}
                  >
                    <Icon size={18} />
                    <kbd>{definition.shortcut}</kbd>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="loc-creator-canvas-wrap" ref={canvasWrapRef} onPointerMove={handleWrapPointerMove} onPointerLeave={() => setCursorFeet(null)}>
          <svg
            ref={svgRef}
            className={`loc-creator-canvas${pavementUnlocked ? '' : ' pavement-locked'}`}
            viewBox={`0 0 ${scene.viewport.width} ${scene.viewport.height}`}
            style={{ width: scene.viewport.width * PIXELS_PER_FOOT * zoom, height: scene.viewport.height * PIXELS_PER_FOOT * zoom }}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
            onPointerDown={handleCanvasPointerDown}
            onClick={handleCanvasClick}
          >
            <rect className="loc-creator-backdrop" width={scene.viewport.width} height={scene.viewport.height} />
            {[...scene.features].sort((a, b) => a.layer - b.layer).map((feature) => {
              const width = feature.properties.renderWidthFeet ?? 0
              const isSelected = feature.id === selectedFeatureId
              const isMultiSelected = multiSelectedFeatureIds.has(feature.id)
              const isLockedPavement = !pavementUnlocked && isPavementFeature(feature)
              return (
                <g key={feature.id}>
                  <path
                    className={`road-feature road-feature-${feature.kind}${isSelected || isMultiSelected ? ' loc-creator-selected' : ''}`}
                    d={featurePathD(feature)}
                    data-geometry-type={feature.geometry.type}
                    data-layer={feature.layer}
                    strokeWidth={width}
                    style={{ strokeWidth: width }}
                    strokeDasharray={feature.kind === 'skip-line' ? '10 30' : feature.kind === 'auxiliary-lane-line' ? '3 9' : undefined}
                  />
                  {!isLockedPavement && (
                    <path
                      className={`loc-creator-hit-area${feature.geometry.type === 'Polygon' ? ' polygon' : ''}`}
                      d={featurePathD(feature)}
                      strokeWidth={Math.max(width, 10)}
                      onClick={(event) => handleFeatureClick(event, feature)}
                      onPointerDown={(event) => handleFeatureBodyPointerDown(event, feature)}
                      onDoubleClick={(event) => handleFeatureDoubleClick(event, feature)}
                    />
                  )}
                  {tool === 'round-corner' && isSelected && feature.geometry.type === 'LineString' && feature.geometry.coordinates.map((point, index) => (
                    index > 0 && index < feature.geometry.coordinates.length - 1 && (
                      <rect
                        key={index}
                        className="loc-creator-vertex-handle"
                        x={point[0] - 1.5}
                        y={point[1] - 1.5}
                        width={3}
                        height={3}
                        onClick={(event) => { event.stopPropagation(); handleVertexClick(feature, index) }}
                      />
                    )
                  ))}
                </g>
              )
            })}

            {stamps.map((stamp) => (
              <g
                key={stamp.id}
                className={stamp.id === selectedStampId ? 'loc-creator-stamp selected' : 'loc-creator-stamp'}
                transform={`translate(${stamp.position[0]} ${stamp.position[1]}) rotate(${stamp.rotation}) scale(${stamp.scale})`}
                onClick={(event) => { event.stopPropagation(); setSelectedStampId(stamp.id); setSelectedFeatureId(null) }}
              >
                {STAMP_GLYPHS[stamp.kind].strokes.map((stroke, index) => (
                  STAMP_GLYPHS[stamp.kind].closed
                    ? <polygon key={index} points={stroke.map(([x, y]) => `${x},${y}`).join(' ')} />
                    : <polyline key={index} points={stroke.map(([x, y]) => `${x},${y}`).join(' ')} />
                ))}
              </g>
            ))}

            {tool === 'join' && endpoints.map((endpoint) => (
              <circle
                key={`${endpoint.featureId}-${endpoint.end}`}
                className={pendingJoin?.featureId === endpoint.featureId && pendingJoin.end === endpoint.end ? 'loc-creator-endpoint pending' : 'loc-creator-endpoint'}
                cx={endpoint.point[0]}
                cy={endpoint.point[1]}
                r={2.2}
                onPointerDown={(event) => handleEndpointPointerDown(event, endpoint)}
              />
            ))}

            {tool === 'points' && allVertices.map((vertex) => {
              const isAnchored = anchors[vertex.featureId]?.has(vertex.vertexIndex) ?? false
              const isPointSelected = selectedPoints.some((point) => point.featureId === vertex.featureId && point.vertexIndex === vertex.vertexIndex)
              return (
                <circle
                  key={`${vertex.featureId}-${vertex.vertexIndex}`}
                  className={`loc-creator-endpoint${isAnchored ? ' anchored' : ''}${isPointSelected ? ' pending' : ''}`}
                  cx={vertex.point[0]}
                  cy={vertex.point[1]}
                  r={2.2}
                  onPointerDown={(event) => handleVertexPointerDown(event, vertex)}
                  onContextMenu={(event) => handleVertexContextMenu(event, vertex)}
                  onDoubleClick={(event) => handleVertexDoubleClick(event, vertex)}
                />
              )
            })}

            {tool === 'select' && selectedFeatureId && allVertices.filter((vertex) => vertex.featureId === selectedFeatureId).map((vertex) => {
              const isAnchored = anchors[vertex.featureId]?.has(vertex.vertexIndex) ?? false
              return (
                <circle
                  key={`selected-${vertex.featureId}-${vertex.vertexIndex}`}
                  className={`loc-creator-endpoint large${isAnchored ? ' anchored' : ''}`}
                  cx={vertex.point[0]}
                  cy={vertex.point[1]}
                  r={3.4}
                  onPointerDown={(event) => handleVertexPointerDown(event, vertex)}
                  onContextMenu={(event) => handleVertexContextMenu(event, vertex)}
                  onDoubleClick={(event) => handleVertexDoubleClick(event, vertex)}
                />
              )
            })}

            {(tool === 'taper' || tool === 'freehand' || tool === 'pavement') && (() => {
              const previewPoints = tool === 'taper' ? taperPoints : tool === 'freehand' ? freehandPoints : pavementPoints
              if (previewPoints.length === 0) return null
              return (
                <>
                  {tool === 'taper' ? (
                    <polygon className="loc-creator-taper-preview" points={previewPoints.map(([x, y]) => `${x},${y}`).join(' ')} />
                  ) : (
                    <polyline className="loc-creator-taper-preview" points={previewPoints.map(([x, y]) => `${x},${y}`).join(' ')} />
                  )}
                  {previewPoints.map((point, index) => (
                    <circle key={index} className="loc-creator-endpoint pending" cx={point[0]} cy={point[1]} r={1.6} />
                  ))}
                </>
              )
            })()}

            {tool === 'line' && lineStart && (
              <circle className="loc-creator-endpoint pending" cx={lineStart[0]} cy={lineStart[1]} r={2.2} />
            )}

            {cropBox && (
              <rect
                className="loc-creator-crop-box"
                x={cropBox.minX}
                y={cropBox.minY}
                width={cropBox.maxX - cropBox.minX}
                height={cropBox.maxY - cropBox.minY}
              />
            )}

            {areaSelectBox && (
              <rect
                className="loc-creator-crop-box"
                x={areaSelectBox.minX}
                y={areaSelectBox.minY}
                width={areaSelectBox.maxX - areaSelectBox.minX}
                height={areaSelectBox.maxY - areaSelectBox.minY}
              />
            )}

            {tool === 'erase-pavement' && erasePreview && (
              <circle className="loc-creator-erase-preview" cx={erasePreview[0]} cy={erasePreview[1]} r={2.5} />
            )}
          </svg>
        </div>

        <aside className="loc-editor-panel" aria-label="Tool options and properties">
          <section className="loc-editor-panel-section">
            <div className="loc-editor-panel-heading">
              <activeToolDefinition.icon size={15} />
              <span>{activeToolDefinition.label}</span>
              <kbd>{activeToolDefinition.shortcut}</kbd>
            </div>
            <p className="loc-editor-hint">{toolHint()}</p>
            {renderToolOptions()}
          </section>

          <section className="loc-editor-panel-section">
            <div className="loc-editor-panel-heading">
              <span>Properties</span>
              <b>{selectedStamp ? 'Stamp' : selectedFeature ? 'Feature' : 'Scene'}</b>
            </div>
            {selectedStamp ? (
              <>
                <p className="loc-editor-note"><b>{STAMP_GLYPHS[selectedStamp.kind].label}</b></p>
                <label className="loc-editor-field">Rotation (deg)<input type="number" value={selectedStamp.rotation} onChange={(event) => updateStamp(selectedStamp.id, { rotation: Number(event.target.value) })} /></label>
                <label className="loc-editor-field">Scale<input type="number" step="0.1" min="0.2" max="4" value={selectedStamp.scale} onChange={(event) => updateStamp(selectedStamp.id, { scale: Number(event.target.value) })} /></label>
                <button className="loc-editor-action danger" type="button" onClick={() => deleteStamp(selectedStamp.id)}><Trash2 size={13} /> Delete stamp</button>
              </>
            ) : selectedFeature ? (
              <>
                <dl className="loc-editor-props">
                  <dt>Kind</dt><dd>{selectedFeature.kind.replaceAll('-', ' ')}</dd>
                  <dt>Layer</dt><dd>{selectedFeature.layer}</dd>
                  {selectedFeature.geometry.type === 'LineString' && (
                    <><dt>Length</dt><dd>{polylineLengthFeet(selectedFeature.geometry.coordinates).toFixed(1)} ft</dd></>
                  )}
                  {(anchors[selectedFeature.id]?.size ?? 0) > 0 && (
                    <><dt>Anchored</dt><dd>point {[...(anchors[selectedFeature.id] ?? [])].join(', ')}</dd></>
                  )}
                </dl>
                <button className="loc-editor-action danger" type="button" onClick={deleteSelectedFeature}><Trash2 size={13} /> Delete feature</button>
              </>
            ) : (
              <dl className="loc-editor-props">
                <dt>Features</dt><dd>{scene.features.length}</dd>
                <dt>Stamps</dt><dd>{stamps.length}</dd>
                <dt>Source</dt><dd>{scene.source.dataset}</dd>
                {multiSelectedFeatureIds.size > 0 && <><dt>Selected</dt><dd>{multiSelectedFeatureIds.size} lines</dd></>}
              </dl>
            )}
          </section>
        </aside>
      </div>

      <footer className="loc-editor-statusbar">
        <span className="loc-editor-status-tool"><activeToolDefinition.icon size={13} /> {activeToolDefinition.label}</span>
        <span className="loc-editor-status-hint">{toolHint()}</span>
        <span>{scene.features.length} features · {stamps.length} stamps</span>
        <button
          type="button"
          className={`loc-editor-lock${pavementUnlocked ? ' unlocked' : ''}`}
          aria-pressed={pavementUnlocked}
          title={pavementUnlocked ? 'Pavement unlocked — click to lock so line tools ignore it' : 'Pavement locked — click to unlock for selecting, painting, or erasing'}
          onClick={() => setPavementUnlocked((current) => !current)}
        >
          {pavementUnlocked ? <LockOpen size={13} /> : <Lock size={13} />} Pavement {pavementUnlocked ? 'unlocked' : 'locked'}
        </button>
        <span className="loc-editor-status-coords">{cursorFeet ? `${cursorFeet[0].toFixed(1)}, ${cursorFeet[1].toFixed(1)} ft` : '—'}</span>
      </footer>
    </section>
  )
}
