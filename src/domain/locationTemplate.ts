import { ROADWAY_DIMENSIONS_FEET, createReferenceRoadScene, type Position, type RoadFeature, type RoadScene } from './roadScene'
import { normalizeHighway, type RoadLocationRequest } from './roadLocation'

export type StampKind =
  | 'shield'
  | 'arrow-straight'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-merge-left'
  | 'arrow-merge-right'
  | 'chevron'

export interface PlacedStamp {
  id: string
  kind: StampKind
  position: Position
  rotation: number
  scale: number
}

interface StampGlyph {
  label: string
  strokes: Position[][]
  closed?: boolean
}

export const STAMP_GLYPHS: Record<StampKind, StampGlyph> = {
  shield: {
    label: 'Route shield marker',
    closed: true,
    strokes: [[[-4, -6], [4, -6], [5, -1], [0, 6], [-5, -1], [-4, -6]]],
  },
  'arrow-straight': {
    label: 'Straight lane arrow',
    strokes: [[[0, 7], [0, -5]], [[0, -7], [-3, -3]], [[0, -7], [3, -3]]],
  },
  'arrow-left': {
    label: 'Left lane arrow',
    strokes: [[[4, 7], [4, 0], [-4, 0]], [[-6, 0], [-2, -3.5]], [[-6, 0], [-2, 3.5]]],
  },
  'arrow-right': {
    label: 'Right lane arrow',
    strokes: [[[-4, 7], [-4, 0], [4, 0]], [[6, 0], [2, -3.5]], [[6, 0], [2, 3.5]]],
  },
  'arrow-merge-left': {
    label: 'Merge left arrow',
    strokes: [[[5, 7], [-5, -3]], [[-5, -3], [-2, -4]], [[-5, -3], [-4, 0.2]]],
  },
  'arrow-merge-right': {
    label: 'Merge right arrow',
    strokes: [[[-5, 7], [5, -3]], [[5, -3], [2, -4]], [[5, -3], [4, 0.2]]],
  },
  chevron: {
    label: 'Chevron alignment marker',
    strokes: [[[-4, 4], [0, -4], [4, 4]]],
  },
}

function transformPoint(point: Position, stamp: PlacedStamp): Position {
  const radians = (stamp.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const x = point[0] * stamp.scale
  const y = point[1] * stamp.scale
  return [stamp.position[0] + x * cos - y * sin, stamp.position[1] + x * sin + y * cos]
}

/** Bakes a placed stamp into concrete `semantic-marking` geometry, one feature per glyph stroke. */
export function bakeStampToFeatures(stamp: PlacedStamp): RoadFeature[] {
  const glyph = STAMP_GLYPHS[stamp.kind]
  return glyph.strokes.map((stroke, index) => ({
    id: `stamp-${stamp.id}-${index}`,
    kind: 'semantic-marking',
    layer: 3,
    geometry: glyph.closed
      ? { type: 'Polygon', coordinates: [stroke.map((point) => transformPoint(point, stamp))] }
      : { type: 'LineString', coordinates: stroke.map((point) => transformPoint(point, stamp)) },
    properties: { markingType: `stamp-${stamp.kind}`, renderWidthFeet: glyph.closed ? undefined : 0.8 },
  }))
}

export interface LinePatternOption {
  id: string
  label: string
  kind: RoadFeature['kind']
  /** Draws two parallel lines (small fixed separation) instead of one, e.g. MUTCD double solid white. */
  double?: boolean
}

export const MUTCD_LINE_PATTERNS: LinePatternOption[] = [
  { id: 'skip-line', label: 'Skip line (broken lane line)', kind: 'skip-line' },
  { id: 'left-fog-line', label: 'Solid white edge/fog line', kind: 'left-fog-line' },
  { id: 'right-fog-line', label: 'Solid yellow edge line', kind: 'right-fog-line' },
  { id: 'shoulder-edge', label: 'Shoulder edge line', kind: 'shoulder-edge' },
  { id: 'auxiliary-lane-line', label: 'Lane extension / merge dashes', kind: 'auxiliary-lane-line' },
  { id: 'double-solid-white', label: 'Double solid white (no passing)', kind: 'left-fog-line', double: true },
]

/** Builds the RoadFeature(s) for a drawn line using a MUTCD pattern preset. */
export function commitLinePattern(option: LinePatternOption, points: Position[], idSeed: string): RoadFeature[] {
  const baseProperties = { direction: 'forward' as const, renderWidthFeet: option.kind === 'shoulder-edge' ? 1 : 0.6 }
  if (!option.double) {
    return [{ id: `line-${idSeed}`, kind: option.kind, layer: 2, geometry: { type: 'LineString', coordinates: points }, properties: baseProperties }]
  }
  return [
    { id: `line-${idSeed}-a`, kind: option.kind, layer: 2, geometry: { type: 'LineString', coordinates: offsetForDoubleLine(points, -0.6) }, properties: baseProperties },
    { id: `line-${idSeed}-b`, kind: option.kind, layer: 2, geometry: { type: 'LineString', coordinates: offsetForDoubleLine(points, 0.6) }, properties: baseProperties },
  ]
}

function offsetForDoubleLine(points: Position[], distanceFeet: number): Position[] {
  if (points.length < 2) return points
  return points.map((point, index) => {
    const neighbor = index === 0 ? points[index + 1] : points[index - 1]
    const dx = neighbor[0] - point[0]
    const dy = neighbor[1] - point[1]
    const length = Math.hypot(dx, dy) || 1
    const normal: Position = index === 0 ? [dy / length, -dx / length] : [-dy / length, dx / length]
    return [point[0] + normal[0] * distanceFeet, point[1] + normal[1] * distanceFeet]
  })
}

export interface LocationTemplateDocument {
  version: 1
  name: string
  savedAt: string
  locationRequest: RoadLocationRequest
  scene: RoadScene
  stamps: PlacedStamp[]
  svg: string
}

export interface LocationTemplateEntry {
  name: string
  savedAt: string
  document: string
}

interface TemplateLibraryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const LOCATION_TEMPLATES_KEY = 'magnus.location-templates'

export function locationTemplateFileBaseName(value: string): string {
  const withoutExtension = value.trim().replace(/(?:\.magnus-location)?\.json$/i, '')
  return withoutExtension.replace(/[^a-z0-9 _-]+/gi, '').trim() || 'location-template'
}

export function defaultLocationTemplateName(request: RoadLocationRequest): string {
  const highway = normalizeHighway(request.highway) || 'Highway'
  const reference = request.reference.trim()
  const referenceLabel = request.referenceType === 'exit' ? `Exit ${reference}` : `MM ${reference}`
  return reference ? `${highway} ${referenceLabel}` : highway
}

export function listLocationTemplates(storage: TemplateLibraryStorage): LocationTemplateEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LOCATION_TEMPLATES_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry: unknown): entry is LocationTemplateEntry => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as Partial<LocationTemplateEntry>
        return typeof candidate.name === 'string' && typeof candidate.savedAt === 'string' && typeof candidate.document === 'string'
      })
      .sort((first, second) => second.savedAt.localeCompare(first.savedAt))
  } catch {
    return []
  }
}

export function saveLocationTemplate(
  storage: TemplateLibraryStorage,
  name: string,
  document: string,
  savedAt = new Date().toISOString(),
): LocationTemplateEntry[] {
  const normalizedName = locationTemplateFileBaseName(name)
  const entries = listLocationTemplates(storage).filter((entry) => entry.name.toLowerCase() !== normalizedName.toLowerCase())
  const updated = [{ name: normalizedName, savedAt, document }, ...entries]
  storage.setItem(LOCATION_TEMPLATES_KEY, JSON.stringify(updated))
  return updated
}

export function removeLocationTemplate(storage: TemplateLibraryStorage, name: string): LocationTemplateEntry[] {
  const updated = listLocationTemplates(storage).filter((entry) => entry.name !== name)
  storage.setItem(LOCATION_TEMPLATES_KEY, JSON.stringify(updated))
  return updated
}

export function parseLocationTemplateDocument(document: string): LocationTemplateDocument {
  const parsed: unknown = JSON.parse(document)
  if (!parsed || typeof parsed !== 'object' || (parsed as Partial<LocationTemplateDocument>).version !== 1) {
    throw new Error('Unrecognized location template file.')
  }
  return parsed as LocationTemplateDocument
}

const EXPORT_STYLE = `
.road-feature-road-casing { fill: #343b3d; stroke: #343b3d; stroke-width: 12; stroke-linejoin: round; }
.road-feature-road-surface { fill: #3c4547; stroke: none; }
.road-feature-road-casing[data-geometry-type='LineString'] { fill: none; }
.road-feature-road-surface[data-geometry-type='LineString'] { fill: none; stroke: #3c4547; stroke-linejoin: round; }
.road-feature-left-fog-line { fill: none; stroke: #e2c943; }
.road-feature-right-fog-line { fill: none; stroke: #f0f1eb; }
.road-feature-skip-line { fill: none; stroke: #edf0e8; stroke-dasharray: 10 30; }
.road-feature-auxiliary-lane-line { fill: none; stroke: #edf0e8; stroke-dasharray: 3 9; }
.road-feature-shoulder-edge { fill: none; stroke: #d8ddd9; }
.road-feature-ramp-surface-ribbon { fill: #3c4547; stroke: none; }
.road-feature-ramp-casing-ribbon { fill: #343b3d; stroke: none; }
.road-feature-intersection-surface { fill: #343b3d; stroke: #343b3d; }
.road-feature-semantic-marking { fill: #f5f6ee; stroke: #f5f6ee; }
`

function svgPathForFeature(feature: RoadFeature): string {
  if (feature.geometry.type === 'Polygon') {
    return feature.geometry.coordinates
      .map((ring) => `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`)
      .join(' ')
  }
  return feature.geometry.coordinates.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

/** Renders a standalone, portable SVG string for a rendered location template (used for save/export). */
export function renderLocationTemplateSvg(scene: RoadScene, stamps: PlacedStamp[]): string {
  const bakedStamps = stamps.flatMap((stamp) => bakeStampToFeatures(stamp))
  const features = [...scene.features, ...bakedStamps].sort((a, b) => a.layer - b.layer)
  const paths = features.map((feature) => {
    const width = feature.properties.renderWidthFeet ?? 0
    return `<path class="road-feature-${feature.kind}" d="${svgPathForFeature(feature)}" stroke-width="${width}" />`
  }).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.viewport.width} ${scene.viewport.height}" width="${scene.viewport.width}" height="${scene.viewport.height}">
  <style>${EXPORT_STYLE}</style>
  <rect width="${scene.viewport.width}" height="${scene.viewport.height}" fill="#56624d" />
  ${paths}
</svg>`
}

const BUILT_IN_LOCATION_REQUEST: RoadLocationRequest = {
  highway: '',
  direction: 'northbound',
  referenceType: 'mile-marker',
  reference: '',
}

function buildDocument(name: string, scene: RoadScene): LocationTemplateDocument {
  return {
    version: 1,
    name,
    savedAt: '2000-01-01T00:00:00.000Z',
    locationRequest: BUILT_IN_LOCATION_REQUEST,
    scene,
    stamps: [],
    svg: renderLocationTemplateSvg(scene, []),
  }
}

function threeLaneHighwayScene(): RoadScene {
  return createReferenceRoadScene()
}

/**
 * Generic 3-lane highway with a single right-side off-ramp: a deceleration lane widens off the
 * right shoulder, runs parallel for a stretch, then curves away as a ramp. Hand-authored (not
 * OSM-derived) like `createRampFeatures`/`createMixingBowlPreviewFeatures` — the ramp curve alone
 * runs roughly 300 ft, long enough to host a shoulder closure scenario on the curved section.
 */
function threeLaneHighwayWithOffRampScene(): RoadScene {
  const base = createReferenceRoadScene()
  const width = 185

  const rampProperties = { name: 'Exit ramp', highway: 'motorway_link', lanes: 1, direction: 'forward' as const }
  const offRampFeatures: RoadFeature[] = [
    {
      id: 'off-ramp-aux-lane-casing',
      kind: 'road-casing',
      layer: 1,
      geometry: { type: 'Polygon', coordinates: [[[66, 700], [82, 600], [82, 300], [66, 300], [66, 700]]] },
      properties: rampProperties,
    },
    {
      id: 'off-ramp-aux-lane-surface',
      kind: 'road-surface',
      layer: 1,
      geometry: { type: 'Polygon', coordinates: [[[66, 700], [80, 600], [80, 300], [66, 300], [66, 700]]] },
      properties: rampProperties,
    },
    {
      id: 'off-ramp-aux-lane-shoulder-edge',
      kind: 'shoulder-edge',
      layer: 1,
      geometry: { type: 'LineString', coordinates: [[66, 700], [80, 600], [80, 300]] },
      properties: { direction: 'forward', renderWidthFeet: 1 },
    },
    {
      id: 'off-ramp-casing',
      kind: 'road-casing',
      layer: 1,
      geometry: { type: 'LineString', coordinates: [[72, 300], [76, 250], [92, 190], [118, 130], [145, 85], [156, 45], [166, 15]] },
      properties: { ...rampProperties, renderWidthFeet: ROADWAY_DIMENSIONS_FEET.laneWidth + 8 },
    },
    {
      id: 'off-ramp-surface',
      kind: 'road-surface',
      layer: 1,
      geometry: { type: 'LineString', coordinates: [[72, 300], [76, 250], [92, 190], [118, 130], [145, 85], [156, 45], [166, 15]] },
      properties: { ...rampProperties, renderWidthFeet: ROADWAY_DIMENSIONS_FEET.laneWidth },
    },
  ]

  return {
    ...base,
    source: { ...base.source, dataset: '3-lane divided highway with a single right-side exit ramp scale reference' },
    viewport: { width, height: base.viewport.height },
    features: [...base.features, ...offRampFeatures],
  }
}

/** Built-in generic scale-reference templates always offered alongside saved location templates. */
export const BUILT_IN_LOCATION_TEMPLATES: LocationTemplateEntry[] = [
  buildDocument('3 Lane Highway', threeLaneHighwayScene()),
  buildDocument('3 Lane Highway with Off-Ramp', threeLaneHighwayWithOffRampScene()),
].map((document) => ({ name: document.name, savedAt: document.savedAt, document: JSON.stringify(document) }))

export function isBuiltInLocationTemplate(name: string): boolean {
  return BUILT_IN_LOCATION_TEMPLATES.some((entry) => entry.name === name)
}

