import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Anchor,
  ChevronDown,
  ChevronUp,
  Crop as CropIcon,
  Download,
  Eraser,
  FolderOpen,
  GitMerge,
  Layers,
  LoaderCircle,
  MapPinned,
  MousePointer2,
  Move,
  PaintBucket,
  Pencil,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scissors,
  Settings2,
  Spline,
  SquareDashedMousePointer,
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
type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'
type ToolCategory = 'select-line' | 'points' | 'clip-join' | 'micro-geometry' | 'drawing' | 'vector-graphics' | 'crop' | 'pavement'

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

export function LocationTemplateCreator({ onClose }: LocationTemplateCreatorProps) {
  const [scene, setScene] = useState<RoadScene>(createReferenceRoadScene)
  const [stamps, setStamps] = useState<PlacedStamp[]>([])
  const [locationRequest, setLocationRequest] = useState<RoadLocationRequest>(DEFAULT_LOCATION_REQUEST)
  const [locationErrors, setLocationErrors] = useState<string[]>([])
  const [locationLoading, setLocationLoading] = useState(false)
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedRoadLocation | null>(null)
  const [spatialServiceStatus, setSpatialServiceStatus] = useState<SpatialServiceStatus>('checking')

  const [tool, setTool] = useState<EditorTool>('select')
  const [openCategories, setOpenCategories] = useState<Set<ToolCategory>>(new Set(['select-line']))
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
  const [propertiesOpen, setPropertiesOpen] = useState(false)
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

  function toggleCategory(category: ToolCategory) {
    setOpenCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  function selectTool(next: EditorTool) {
    setTool(next)
    setPendingJoin(null)
    setLineStart(null)
    setSelectedPoints([])
    setPointContextMenu(null)
    if (next !== 'stamp') setArmedStamp(null)
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
    setZoom((current) => Math.min(6, Math.round((current + 0.25) * 100) / 100))
  }

  function zoomOut() {
    captureZoomCenter()
    setZoom((current) => Math.max(0.25, Math.round((current - 0.25) * 100) / 100))
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
      }
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
    if (tool !== 'select' && tool !== 'split') return
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
      // kind names are color-coded, not side-coded: 'right-fog-line' renders yellow, 'left-fog-line' renders white.
      features.push(
        { id: `pavement-${idSeed}-left-fog`, kind: 'right-fog-line', layer: 2, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, laneHalfWidth, 'left') }, properties: { direction: 'forward', renderWidthFeet: 0.6 } },
        { id: `pavement-${idSeed}-right-fog`, kind: 'left-fog-line', layer: 2, geometry: { type: 'LineString', coordinates: offsetPolyline(centerline, laneHalfWidth, 'right') }, properties: { direction: 'forward', renderWidthFeet: 0.6 } },
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

  return (
    <section className="loc-creator-shell" aria-label="Location template creator">
      <header className="loc-creator-header">
        <div>
          <span>Location template authoring</span>
          <h2>{sceneNameHint ?? (resolvedLocation ? normalizeHighway(resolvedLocation.request.highway) : 'Untitled corridor')}</h2>
        </div>
        <div className="loc-creator-zoom-controls">
          <button type="button" onClick={zoomOut} title="Zoom out"><ZoomOut size={15} /></button>
          <button type="button" className="loc-creator-zoom-value" onClick={resetZoom} title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={zoomIn} title="Zoom in"><ZoomIn size={15} /></button>
        </div>
        <button className="loc-creator-clear-all" type="button" onClick={clearAll} title="Clear the canvas back to a bare, empty scene">
          <Trash2 size={15} /> Clear all
        </button>
        <button type="button" disabled={history.length === 0} onClick={undo} title="Undo last operation (Ctrl+Z)">
          <Undo2 size={15} /> Undo{history.length > 0 ? ` (${history.length})` : ''}
        </button>
        <div className="loc-creator-properties-anchor">
          <button
            className="loc-creator-properties-toggle"
            type="button"
            aria-expanded={propertiesOpen}
            aria-haspopup="menu"
            onClick={() => setPropertiesOpen((open) => !open)}
          >
            <Settings2 size={15} /> Properties
          </button>
          {propertiesOpen && (
            <div className="loc-creator-properties-panel" role="dialog" aria-label="Properties">
              <div className="inspector-heading"><span>Properties</span><b>{selectedStamp ? 'STAMP' : selectedFeature ? 'FEATURE' : 'SCENE'}</b></div>
              {selectedStamp ? (
                <>
                  <p>{STAMP_GLYPHS[selectedStamp.kind].label}</p>
                  <label>Rotation (deg)<input type="number" value={selectedStamp.rotation} onChange={(event) => updateStamp(selectedStamp.id, { rotation: Number(event.target.value) })} /></label>
                  <label>Scale<input type="number" step="0.1" min="0.2" max="4" value={selectedStamp.scale} onChange={(event) => updateStamp(selectedStamp.id, { scale: Number(event.target.value) })} /></label>
                  <button className="delete-object" type="button" onClick={() => deleteStamp(selectedStamp.id)}><Trash2 size={13} /> Delete stamp</button>
                </>
              ) : selectedFeature ? (
                <>
                  <p><b>{selectedFeature.kind.replaceAll('-', ' ')}</b></p>
                  <p>Layer {selectedFeature.layer}</p>
                  {selectedFeature.geometry.type === 'LineString' && (
                    <p>{polylineLengthFeet(selectedFeature.geometry.coordinates).toFixed(1)} ft long</p>
                  )}
                  {(anchors[selectedFeature.id]?.size ?? 0) > 0 && <p>Anchored at point {[...(anchors[selectedFeature.id] ?? [])].join(', ')}</p>}
                  <button className="delete-object" type="button" onClick={deleteSelectedFeature}><Trash2 size={13} /> Delete feature</button>
                </>
              ) : (
                <div className="scene-summary">
                  <p>{scene.features.length} roadway features</p>
                  <p>{stamps.length} vector stamps</p>
                  <p>Source: {scene.source.dataset}</p>
                  <p>Active tool: <b>{tool.replaceAll('-', ' ')}</b></p>
                  {multiSelectedFeatureIds.size > 0 && <p>{multiSelectedFeatureIds.size} lines multi-selected (press Enter to smooth)</p>}
                </div>
              )}
            </div>
          )}
        </div>
        {saveStatus === 'saved' && <span className="loc-creator-saved-note">Template saved</span>}
        <button type="button" onClick={downloadSvgPreview} title="Download current SVG preview">
          <Download size={15} /> Export SVG
        </button>
        <button className="loc-creator-render" type="button" onClick={openSavePanel}>
          <Save size={15} /> Render location template
        </button>
        <button className="loc-creator-close" type="button" title="Close location template creator" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      {saveOpen && (
        <div className="loc-creator-save-panel" role="dialog" aria-label="Render location template">
          <label>
            Template file name
            <input
              autoFocus
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
          </label>
          <small>Saved to your local template library as a JSON/SVG state file, e.g. "I-95 Exit 143".</small>
          <div className="loc-creator-save-actions">
            <button type="button" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button type="button" className="loc-creator-save-confirm" onClick={renderLocationTemplate}>Save template</button>
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

      <div className="loc-creator-body">
        <nav className="loc-creator-tools" aria-label="Location editing tools">
          <div className={`spatial-service-status ${spatialServiceStatus}`} role="status" aria-live="polite">
            <span className="service-indicator" aria-hidden="true" />
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
          </div>

          <div className="loc-creator-load-template-anchor">
            <button
              className="location-template-load-button"
              type="button"
              aria-expanded={loadTemplatesOpen}
              aria-haspopup="menu"
              onClick={() => setLoadTemplatesOpen((open) => !open)}
            >
              <FolderOpen size={16} />
              <span>
                <b>Load existing template</b>
                <small>{availableTemplates.length} available for further edits</small>
              </span>
              {loadTemplatesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {loadTemplatesOpen && (
              <div className="location-template-menu" role="menu" aria-label="Existing location templates">
                {availableTemplates.map((entry) => (
                  <div className="saved-scene-entry" key={entry.name}>
                    <button type="button" role="menuitem" onClick={() => loadExistingTemplate(entry)}>
                      <b>{entry.name}</b>
                      <small>{isBuiltInLocationTemplate(entry.name) ? 'Built-in template' : new Date(entry.savedAt).toLocaleString()}</small>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form className="location-tool" aria-label="Roadway location" onSubmit={(event) => { void loadRoadLocation(event) }}>
            <div className="location-tool-heading">
              <MapPinned size={16} />
              <div>
                <label htmlFor="loc-creator-highway">Roadway location</label>
                <span>Look up scaled corridor geometry</span>
              </div>
            </div>
            <div className="location-fields">
              <label className="location-highway" htmlFor="loc-creator-highway">
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
              <p className="location-error" role="alert" key={error}>{error}</p>
            ))}
            <button className="location-load" type="submit" disabled={locationLoading}>
              {locationLoading ? <LoaderCircle className="location-spinner" size={15} /> : <MapPinned size={15} />}
              <span>{locationLoading ? 'Resolving location' : 'Render location'}</span>
            </button>
            {resolvedLocation && (
              <div className={`location-result ${resolvedLocation.source}`} role="status">
                <strong>{resolvedLocation.request.highway}</strong>
                <span>{resolvedLocation.message}</span>
              </div>
            )}
          </form>

          <div className="location-tool highway-generator">
            <div className="location-tool-heading">
              <Wand2 size={16} />
              <div>
                <label htmlFor="loc-creator-generator-lanes">Generic highway generator</label>
                <span>Build a scale reference from scratch, additively</span>
              </div>
            </div>
            <div className="location-fields">
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
            <button className="location-load" type="button" onClick={generateHighway}>
              <Wand2 size={15} />
              <span>Generate highway</span>
            </button>
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('select-line')} onClick={() => toggleCategory('select-line')}>
              <MousePointer2 size={14} /> <span>Select line</span>
            </button>
            {openCategories.has('select-line') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => selectTool('select')}>
                  <MousePointer2 size={14} /> Select<small>Click a line to highlight it; Delete removes it. Ctrl+click more lines to multi-select for Bezier smoothing. Click and drag an already-selected line to move it.</small>
                </button>
                <button type="button" className={tool === 'split' ? 'active' : ''} onClick={() => selectTool('split')}>
                  <Scissors size={14} /> Split selected line<small>Click on the line where it should break — leaves a 10 ft gap</small>
                </button>
                <div className="loc-creator-rotate-controls">
                  <b>Rotate selected line</b>
                  <div className="loc-creator-rotate-buttons">
                    <button type="button" disabled={!selectedFeature} onClick={() => rotateSelectedFeature(-45)}><RotateCcw size={14} /> -45°</button>
                    <button type="button" disabled={!selectedFeature} onClick={() => rotateSelectedFeature(45)}><RotateCw size={14} /> +45°</button>
                  </div>
                  <small>Rotates around the anchored point if one is set, otherwise the line's own center.</small>
                </div>
                {multiSelectedFeatureIds.size > 0 && (
                  <button type="button" onClick={applyBezierToSelection}>
                    <Spline size={14} /> Smooth {multiSelectedFeatureIds.size} selected lines (Bezier)<small>Or just press Enter</small>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('points')} onClick={() => toggleCategory('points')}>
              <Move size={14} /> <span>Points</span>
            </button>
            {openCategories.has('points') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'points' ? 'active' : ''} onClick={() => selectTool('points')}>
                  <Move size={14} /> Points<small>Highlights every point. Drag one to hinge the line; hold Ctrl to lock the angle to 45° steps.</small>
                </button>
                <p className="loc-creator-hint">Ctrl+click two points on the same line, release Ctrl, then drag either one to move the whole line. Right-click any point to anchor/detach it — anchoring lets you rotate the rest of the line (even curves) around that fixed point.</p>
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('clip-join')} onClick={() => toggleCategory('clip-join')}>
              <Waypoints size={14} /> <span>Clip &amp; join tools</span>
            </button>
            {openCategories.has('clip-join') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'join' ? 'active' : ''} onClick={() => selectTool('join')}>
                  <GitMerge size={14} /> Join nodes<small>Click two open endpoints to connect them</small>
                </button>
                <button type="button" className={tool === 'round-corner' ? 'active' : ''} onClick={() => selectTool('round-corner')}>
                  <Spline size={14} /> Bezier corner rounding<small>Select a path, click a vertex to round it</small>
                </button>
                <label className="loc-creator-inline-field">
                  Radius (ft)
                  <input type="number" min={1} max={200} value={roundRadius} onChange={(event) => setRoundRadius(Number(event.target.value))} />
                </label>
                <div className="loc-creator-offset-controls">
                  <b>Path offset generator</b>
                  <label className="loc-creator-inline-field">
                    Distance (ft)
                    <input type="number" min={1} max={100} value={offsetDistance} onChange={(event) => setOffsetDistance(Number(event.target.value))} />
                  </label>
                  <label className="loc-creator-inline-field">
                    Side
                    <select value={offsetSide} onChange={(event) => setOffsetSide(event.target.value as 'left' | 'right')}>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                  <label className="loc-creator-inline-field">
                    New line type
                    <select value={offsetPatternId} onChange={(event) => setOffsetPatternId(event.target.value)}>
                      {LINE_PATTERNS_FOR_OFFSET.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={selectedFeature?.geometry.type !== 'LineString'} onClick={generateOffset}>
                    Generate parallel offset from selected path
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('micro-geometry')} onClick={() => toggleCategory('micro-geometry')}>
              <Layers size={14} /> <span>Micro geometry additions</span>
            </button>
            {openCategories.has('micro-geometry') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'taper' ? 'active' : ''} onClick={() => selectTool('taper')}>
                  <Layers size={14} /> Taper / gore area<small>Click points to enclose a taper, ramp gore, or pocket area</small>
                </button>
                {tool === 'taper' && (
                  <div className="loc-creator-taper-actions">
                    <span>{taperPoints.length} point{taperPoints.length === 1 ? '' : 's'} placed</span>
                    <button type="button" disabled={taperPoints.length < 3} onClick={finishTaper}>Finish shape</button>
                    <button type="button" onClick={() => setTaperPoints([])}>Clear</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('drawing')} onClick={() => toggleCategory('drawing')}>
              <Pencil size={14} /> <span>Freehand &amp; area tools</span>
            </button>
            {openCategories.has('drawing') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'freehand' ? 'active' : ''} onClick={() => selectTool('freehand')}>
                  <Pencil size={14} /> Freehand draw<small>Click to place each point of a hand-drawn vector path</small>
                </button>
                {tool === 'freehand' && (
                  <div className="loc-creator-taper-actions">
                    <span>{freehandPoints.length} point{freehandPoints.length === 1 ? '' : 's'} placed</span>
                    <button type="button" disabled={freehandPoints.length < 2} onClick={finishFreehand}>Finish line</button>
                    <button type="button" onClick={() => setFreehandPoints([])}>Clear</button>
                  </div>
                )}
                <button type="button" className={tool === 'area-select' ? 'active' : ''} onClick={() => selectTool('area-select')}>
                  <SquareDashedMousePointer size={14} /> Select area<small>Drag a box; everything it encompasses gets selected</small>
                </button>
                {multiSelectedFeatureIds.size > 0 && (
                  <button type="button" onClick={applyBezierToSelection}>
                    <Spline size={14} /> Smooth selection (Bezier)<small>{multiSelectedFeatureIds.size} lines selected — or press Enter</small>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('vector-graphics')} onClick={() => toggleCategory('vector-graphics')}>
              <MousePointer2 size={14} /> <span>Roadway vector graphics</span>
            </button>
            {openCategories.has('vector-graphics') && (
              <div className="loc-creator-category-body">
                <b>MUTCD line patterns</b>
                <label className="loc-creator-inline-field">
                  Pattern
                  <select
                    value={linePattern.id}
                    onChange={(event) => setLinePattern(MUTCD_LINE_PATTERNS.find((option) => option.id === event.target.value) ?? MUTCD_LINE_PATTERNS[0])}
                  >
                    {MUTCD_LINE_PATTERNS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <button type="button" className={tool === 'line' ? 'active' : ''} onClick={() => selectTool('line')}>
                  <Waypoints size={14} /> Draw line<small>{lineStart ? 'Click the end point' : 'Click the start point'}</small>
                </button>
                <b>Stamps</b>
                <div className="loc-creator-stamp-grid">
                  {STAMP_KINDS.map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      className={tool === 'stamp' && armedStamp === kind ? 'active' : ''}
                      title={STAMP_GLYPHS[kind].label}
                      onClick={() => { selectTool('stamp'); setArmedStamp(kind) }}
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
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('crop')} onClick={() => toggleCategory('crop')}>
              <CropIcon size={14} /> <span>Bounding box crop</span>
            </button>
            {openCategories.has('crop') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'crop' ? 'active' : ''} onClick={() => selectTool('crop')}>
                  <CropIcon size={14} /> Draw crop box<small>Drag a rectangle, then apply to discard geometry outside it</small>
                </button>
                {cropBox && (
                  <div className="loc-creator-taper-actions">
                    <button type="button" onClick={applyCrop}>Apply crop</button>
                    <button type="button" onClick={() => setCropBox(null)}>Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="loc-creator-category">
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('pavement')} onClick={() => toggleCategory('pavement')}>
              <PaintBucket size={14} /> <span>Draw pavement</span>
            </button>
            {openCategories.has('pavement') && (
              <div className="loc-creator-category-body">
                <b>Pavement layer</b>
                <div className="loc-creator-radio-group" role="radiogroup" aria-label="Pavement layer lock">
                  <label><input type="radio" name="pavement-lock" checked={!pavementUnlocked} onChange={() => setPavementUnlocked(false)} /> Locked</label>
                  <label><input type="radio" name="pavement-lock" checked={pavementUnlocked} onChange={() => setPavementUnlocked(true)} /> Unlocked</label>
                </div>
                <p className="loc-creator-hint">Locked pavement can&apos;t be selected, split, or deleted by the other line tools — unlock it to select, edit, or draw/erase pavement.</p>
                <label className="loc-creator-inline-field">
                  Lanes
                  <select value={pavementLanes} onChange={(event) => setPavementLanes(Number(event.target.value) as 1 | 2 | 3)}>
                    <option value={1}>1 lane</option>
                    <option value={2}>2 lanes</option>
                    <option value={3}>3 lanes</option>
                  </select>
                </label>
                <b>Shoulders</b>
                <div className="loc-creator-radio-group" role="radiogroup" aria-label="Add shoulders">
                  <label><input type="radio" name="pavement-shoulders" checked={pavementShoulders === 'none'} onChange={() => setPavementShoulders('none')} /> None</label>
                  <label><input type="radio" name="pavement-shoulders" checked={pavementShoulders === 'left'} onChange={() => setPavementShoulders('left')} /> Add left shoulder</label>
                  <label><input type="radio" name="pavement-shoulders" checked={pavementShoulders === 'right'} onChange={() => setPavementShoulders('right')} /> Add right shoulder</label>
                  <label><input type="radio" name="pavement-shoulders" checked={pavementShoulders === 'both'} onChange={() => setPavementShoulders('both')} /> Add both shoulders</label>
                </div>
                <b>Fog lines</b>
                <div className="loc-creator-radio-group" role="radiogroup" aria-label="Add fog lines">
                  <label><input type="radio" name="pavement-fog" checked={!pavementFogLines} onChange={() => setPavementFogLines(false)} /> No fog lines</label>
                  <label><input type="radio" name="pavement-fog" checked={pavementFogLines} onChange={() => setPavementFogLines(true)} /> Add fog lines</label>
                </div>
                <button type="button" className={tool === 'pavement' ? 'active' : ''} disabled={!pavementUnlocked} onClick={() => selectTool('pavement')}>
                  <PaintBucket size={14} /> Draw pavement<small>Paint-brush stroke; width follows the lane/shoulder settings above</small>
                </button>
                <button type="button" className={tool === 'erase-pavement' ? 'active' : ''} disabled={!pavementUnlocked} onClick={() => selectTool('erase-pavement')}>
                  <Eraser size={14} /> Erase pavement<small>~5 ft circular brush; narrows the paved area to sculpt tapers</small>
                </button>
                {tool === 'pavement' && pavementPoints.length > 0 && (
                  <div className="loc-creator-taper-actions">
                    <span>Painting… {pavementPoints.length} point{pavementPoints.length === 1 ? '' : 's'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

        <div className="loc-creator-canvas-wrap" ref={canvasWrapRef}>
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
      </div>
    </section>
  )
}
