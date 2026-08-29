import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Crop as CropIcon,
  Download,
  FolderOpen,
  GitMerge,
  Layers,
  LoaderCircle,
  MapPinned,
  MousePointer2,
  Move,
  RefreshCw,
  Save,
  Scissors,
  Spline,
  Trash2,
  Wand2,
  Waypoints,
  X,
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
  listEndpoints,
  moveEndpoint,
  offsetPolyline,
  polylineLengthFeet,
  roundVertex,
  splitFeatureAt,
  type BoundingBox,
  type EndpointRef,
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

type EditorTool = 'select' | 'join' | 'split' | 'round-corner' | 'trim' | 'taper' | 'crop' | 'line' | 'stamp'
type SpatialServiceStatus = 'checking' | 'connected' | 'unavailable'
type ToolCategory = 'clip-join' | 'micro-geometry' | 'vector-graphics' | 'crop' | 'trim'

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
  const [openCategories, setOpenCategories] = useState<Set<ToolCategory>>(new Set(['clip-join']))
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null)
  const [pendingJoin, setPendingJoin] = useState<EndpointRef | null>(null)
  const [roundRadius, setRoundRadius] = useState(15)
  const [offsetDistance, setOffsetDistance] = useState(12)
  const [offsetSide, setOffsetSide] = useState<'left' | 'right'>('right')
  const [offsetPatternId, setOffsetPatternId] = useState(LINE_PATTERNS_FOR_OFFSET[0].id)
  const [taperPoints, setTaperPoints] = useState<Position[]>([])
  const [linePattern, setLinePattern] = useState<LinePatternOption>(MUTCD_LINE_PATTERNS[0])
  const [lineStart, setLineStart] = useState<Position | null>(null)
  const [armedStamp, setArmedStamp] = useState<StampKind | null>(null)
  const [selectedStampId, setSelectedStampId] = useState<string | null>(null)
  const [cropBox, setCropBox] = useState<BoundingBox | null>(null)
  const [cropDragStart, setCropDragStart] = useState<Position | null>(null)
  const [draggingEndpoint, setDraggingEndpoint] = useState<{ featureId: string; end: 'start' | 'end' } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')
  const [sceneNameHint, setSceneNameHint] = useState<string | null>(null)
  const [highwayGeneratorOptions, setHighwayGeneratorOptions] = useState<HighwayGeneratorOptions>(DEFAULT_HIGHWAY_GENERATOR_OPTIONS)
  const [loadTemplatesOpen, setLoadTemplatesOpen] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState(() => listLocationTemplates(localStorage))

  const svgRef = useRef<SVGSVGElement>(null)
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
  const endpoints = listEndpoints(scene.features)

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
    if (next !== 'stamp') setArmedStamp(null)
    if (next !== 'crop') { setCropBox(null); setCropDragStart(null) }
    if (next !== 'taper') setTaperPoints([])
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
  }

  function generateHighway() {
    setScene(generateHighwayScene(highwayGeneratorOptions))
    setResolvedLocation(null)
    setStamps([])
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setSceneNameHint(defaultGeneratedHighwayName(highwayGeneratorOptions))
    setLoadTemplatesOpen(false)
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
    } catch (error) {
      window.alert(error instanceof Error ? `Could not load template: ${error.message}` : 'Could not load template.')
    }
  }

  function updateFeatures(updater: (features: RoadFeature[]) => RoadFeature[]) {
    setScene((current) => ({ ...current, features: updater(current.features) }))
  }

  function deleteSelectedFeature() {
    if (!selectedFeatureId) return
    updateFeatures((features) => features.filter((feature) => feature.id !== selectedFeatureId))
    setSelectedFeatureId(null)
  }

  function handleFeatureClick(event: React.MouseEvent<SVGPathElement>, feature: RoadFeature) {
    event.stopPropagation()
    const svg = svgRef.current
    if (tool === 'split' && svg) {
      const point = toSvgPoint(svg, event.clientX, event.clientY)
      const split = splitFeatureAt(feature, point)
      if (split) {
        updateFeatures((features) => [...features.filter((item) => item.id !== feature.id), ...split])
      }
      return
    }
    setSelectedStampId(null)
    setSelectedFeatureId(feature.id)
  }

  function handleEndpointPointerDown(event: React.PointerEvent<SVGCircleElement>, endpoint: EndpointRef) {
    event.stopPropagation()
    if (tool === 'join') {
      if (!pendingJoin || pendingJoin.featureId === endpoint.featureId) {
        setPendingJoin(endpoint)
        return
      }
      const a = scene.features.find((feature) => feature.id === pendingJoin.featureId)
      const b = scene.features.find((feature) => feature.id === endpoint.featureId)
      if (a && b) {
        const joined = joinFeatures(a, pendingJoin.end, b, endpoint.end)
        if (joined) {
          updateFeatures((features) => [...features.filter((item) => item.id !== a.id && item.id !== b.id), joined])
        }
      }
      setPendingJoin(null)
      return
    }
    if (tool === 'trim') {
      setSelectedFeatureId(endpoint.featureId)
      setDraggingEndpoint({ featureId: endpoint.featureId, end: endpoint.end })
    }
  }

  function handleVertexClick(feature: RoadFeature, vertexIndex: number) {
    if (tool !== 'round-corner') return
    const rounded = roundVertex(feature, vertexIndex, roundRadius)
    if (rounded) updateFeatures((features) => features.map((item) => (item.id === feature.id ? rounded : item)))
  }

  function handleCanvasPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget
    const point = toSvgPoint(svg, event.clientX, event.clientY)
    if (cropDragStart) {
      setCropBox({
        minX: Math.min(cropDragStart[0], point[0]),
        maxX: Math.max(cropDragStart[0], point[0]),
        minY: Math.min(cropDragStart[1], point[1]),
        maxY: Math.max(cropDragStart[1], point[1]),
      })
      return
    }
    if (draggingEndpoint) {
      const snapped = findSnapPoint(endpoints, point, SNAP_RADIUS_FEET, draggingEndpoint.featureId)
      const target = snapped ?? point
      updateFeatures((features) => features.map((feature) => (
        feature.id === draggingEndpoint.featureId
          ? moveEndpoint(feature, draggingEndpoint.end, target) ?? feature
          : feature
      )))
    }
  }

  function handleCanvasPointerUp() {
    setDraggingEndpoint(null)
    setCropDragStart(null)
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    const svg = event.currentTarget
    const point = toSvgPoint(svg, event.clientX, event.clientY)
    if (tool === 'taper') {
      setTaperPoints((current) => [...current, point])
      return
    }
    if (tool === 'stamp' && armedStamp) {
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
      const created = commitLinePattern(linePattern, [lineStart, point], crypto.randomUUID().slice(0, 8))
      updateFeatures((features) => [...features, ...created])
      setLineStart(null)
      return
    }
    setSelectedFeatureId(null)
    setSelectedStampId(null)
    setPendingJoin(null)
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
    updateFeatures((features) => [...features, feature])
    setTaperPoints([])
  }

  function applyCrop() {
    if (!cropBox) return
    updateFeatures((features) => cropFeaturesToBoundingBox(features, cropBox))
    setCropBox(null)
  }

  function updateStamp(id: string, updates: Partial<PlacedStamp>) {
    setStamps((current) => current.map((stamp) => (stamp.id === id ? { ...stamp, ...updates } : stamp)))
  }

  function deleteStamp(id: string) {
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
        <div className="loc-creator-header-status">
          {saveStatus === 'saved' && <span className="loc-creator-saved-note">Template saved</span>}
        </div>
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
                <button type="button" className={tool === 'split' ? 'active' : ''} onClick={() => selectTool('split')}>
                  <Scissors size={14} /> Split path<small>Click anywhere along a path to slice it</small>
                </button>
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
            <button type="button" className="loc-creator-category-toggle" aria-expanded={openCategories.has('trim')} onClick={() => toggleCategory('trim')}>
              <Move size={14} /> <span>Path trim / extend</span>
            </button>
            {openCategories.has('trim') && (
              <div className="loc-creator-category-body">
                <button type="button" className={tool === 'trim' ? 'active' : ''} onClick={() => selectTool('trim')}>
                  <Move size={14} /> Trim / extend<small>Drag an endpoint handle; it snaps to nearby paths</small>
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="loc-creator-canvas-wrap">
          <svg
            ref={svgRef}
            className="loc-creator-canvas"
            viewBox={`0 0 ${scene.viewport.width} ${scene.viewport.height}`}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
            onPointerDown={(event) => {
              if (tool === 'crop') {
                const point = toSvgPoint(event.currentTarget, event.clientX, event.clientY)
                setCropDragStart(point)
                setCropBox({ minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] })
              }
            }}
            onClick={handleCanvasClick}
          >
            <rect className="loc-creator-backdrop" width={scene.viewport.width} height={scene.viewport.height} />
            {[...scene.features].sort((a, b) => a.layer - b.layer).map((feature) => {
              const width = feature.properties.renderWidthFeet ?? 0
              const isSelected = feature.id === selectedFeatureId
              return (
                <g key={feature.id}>
                  <path
                    className={`road-feature road-feature-${feature.kind}${isSelected ? ' loc-creator-selected' : ''}`}
                    d={featurePathD(feature)}
                    strokeWidth={width}
                    style={{ strokeWidth: width }}
                    strokeDasharray={feature.kind === 'skip-line' ? '10 30' : feature.kind === 'auxiliary-lane-line' ? '3 9' : undefined}
                  />
                  <path
                    className="loc-creator-hit-area"
                    d={featurePathD(feature)}
                    strokeWidth={Math.max(width, 10)}
                    onClick={(event) => handleFeatureClick(event, feature)}
                  />
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

            {(tool === 'join' || tool === 'trim') && endpoints.map((endpoint) => (
              <circle
                key={`${endpoint.featureId}-${endpoint.end}`}
                className={pendingJoin?.featureId === endpoint.featureId && pendingJoin.end === endpoint.end ? 'loc-creator-endpoint pending' : 'loc-creator-endpoint'}
                cx={endpoint.point[0]}
                cy={endpoint.point[1]}
                r={2.2}
                onPointerDown={(event) => handleEndpointPointerDown(event, endpoint)}
              />
            ))}

            {tool === 'taper' && taperPoints.length > 0 && (
              <polygon className="loc-creator-taper-preview" points={taperPoints.map(([x, y]) => `${x},${y}`).join(' ')} />
            )}

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
          </svg>
        </div>

        <aside className="loc-creator-inspector">
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
              <button className="delete-object" type="button" onClick={deleteSelectedFeature}><Trash2 size={13} /> Delete feature</button>
            </>
          ) : (
            <div className="scene-summary">
              <p>{scene.features.length} roadway features</p>
              <p>{stamps.length} vector stamps</p>
              <p>Source: {scene.source.dataset}</p>
              <p>Active tool: <b>{tool.replaceAll('-', ' ')}</b></p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
