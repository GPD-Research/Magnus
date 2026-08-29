import { ROADWAY_DIMENSIONS_FEET, type Position, type RoadFeature, type RoadScene } from './roadScene'

export type HighwayLaneCount = 1 | 2 | 3
export type HighwayDirectionMode = 'one-direction' | 'both-directions'
export type HighwayAuxiliaryLane = 'none' | 'acceleration-lane' | 'deceleration-lane'
export type HighwayRampStyle = 'straight-off-ramp' | 'straight-on-ramp' | 'circular-off-ramp' | 'circular-on-ramp'

export interface HighwayGeneratorOptions {
  lanes: HighwayLaneCount
  direction: HighwayDirectionMode
  auxiliaryLane: HighwayAuxiliaryLane
  ramp: HighwayRampStyle
}

export const HIGHWAY_LANE_OPTIONS: { value: HighwayLaneCount; label: string }[] = [
  { value: 1, label: '1 lane highway' },
  { value: 2, label: '2 lane highway' },
  { value: 3, label: '3 lane highway' },
]

export const HIGHWAY_DIRECTION_OPTIONS: { value: HighwayDirectionMode; label: string }[] = [
  { value: 'one-direction', label: 'One direction' },
  { value: 'both-directions', label: 'Both directions' },
]

export const HIGHWAY_AUXILIARY_LANE_OPTIONS: { value: HighwayAuxiliaryLane; label: string }[] = [
  { value: 'none', label: 'Nothing more' },
  { value: 'acceleration-lane', label: 'Acceleration lane' },
  { value: 'deceleration-lane', label: 'Deceleration lane' },
]

export const HIGHWAY_RAMP_OPTIONS: { value: HighwayRampStyle; label: string }[] = [
  { value: 'straight-off-ramp', label: 'Straight off-ramp' },
  { value: 'straight-on-ramp', label: 'Straight on-ramp' },
  { value: 'circular-off-ramp', label: 'Circular off-ramp' },
  { value: 'circular-on-ramp', label: 'Circular on-ramp' },
]

export const DEFAULT_HIGHWAY_GENERATOR_OPTIONS: HighwayGeneratorOptions = {
  lanes: 3,
  direction: 'one-direction',
  auxiliaryLane: 'none',
  ramp: 'straight-off-ramp',
}

const { laneWidth, shoulderWidth, edgeLineWidth, skipLineWidth } = ROADWAY_DIMENSIONS_FEET
const HEIGHT = 900
const AUX_TAPER_START_Y = 700
const AUX_TAPER_END_Y = 600
const AUX_ATTACH_Y = 300
const AUX_LANE_WIDTH = 14
const AUX_CASING_PAD = 2

function pt(x: number, y: number): Position {
  return [x, y]
}

function boundsOf(features: RoadFeature[]): { minX: number; maxX: number } {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const feature of features) {
    const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    for (const ring of rings) {
      for (const [x] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  return { minX, maxX }
}

/** Builds one carriageway's pavement/markings, returning the x of its right shoulder edge for attachments. */
function carriageway(idPrefix: string, startX: number, lanes: HighwayLaneCount, direction: 'forward' | 'backward'): {
  features: RoadFeature[]
  rightEdgeX: number
} {
  const surfaceWidth = 2 * shoulderWidth + lanes * laneWidth
  const leftEdgeX = startX
  const rightEdgeX = startX + surfaceWidth
  const casingLeftX = leftEdgeX - AUX_CASING_PAD
  const casingRightX = rightEdgeX + AUX_CASING_PAD
  const leftFogX = leftEdgeX + shoulderWidth
  const rightFogX = rightEdgeX - shoulderWidth
  const properties = { name: `${lanes}-lane highway`, highway: 'motorway', lanes, direction }

  const vertical = (id: string, kind: RoadFeature['kind'], x: number, layer: number, renderWidthFeet?: number): RoadFeature => ({
    id: `${idPrefix}-${id}`,
    kind,
    layer,
    geometry: { type: 'LineString', coordinates: [pt(x, 0), pt(x, HEIGHT)] },
    properties: { lanes, direction, renderWidthFeet },
  })

  const features: RoadFeature[] = [
    {
      id: `${idPrefix}-casing`,
      kind: 'road-casing',
      layer: 0,
      geometry: { type: 'Polygon', coordinates: [[pt(casingLeftX, 0), pt(casingRightX, 0), pt(casingRightX, HEIGHT), pt(casingLeftX, HEIGHT), pt(casingLeftX, 0)]] },
      properties,
    },
    {
      id: `${idPrefix}-surface`,
      kind: 'road-surface',
      layer: 0,
      geometry: { type: 'Polygon', coordinates: [[pt(leftEdgeX, 0), pt(rightEdgeX, 0), pt(rightEdgeX, HEIGHT), pt(leftEdgeX, HEIGHT), pt(leftEdgeX, 0)]] },
      properties,
    },
    vertical('left-shoulder-edge', 'shoulder-edge', leftEdgeX, 1, 1),
    vertical('left-fog-line', 'left-fog-line', leftFogX, 2, edgeLineWidth),
    ...Array.from({ length: lanes - 1 }, (_, index) => vertical(`skip-${index}`, 'skip-line', leftFogX + laneWidth * (index + 1), 2, skipLineWidth)),
    vertical('right-fog-line', 'right-fog-line', rightFogX, 2, edgeLineWidth),
    vertical('right-shoulder-edge', 'shoulder-edge', rightEdgeX, 1, 1),
  ]

  const flowStartY = direction === 'forward' ? HEIGHT - 55 : 55
  const flowEndY = direction === 'forward' ? 55 : HEIGHT - 55
  for (let lane = 0; lane < lanes; lane += 1) {
    const x = leftFogX + laneWidth * lane + laneWidth / 2
    features.push({
      id: `${idPrefix}-flow-${lane}`,
      kind: 'traffic-flow',
      layer: 3,
      geometry: { type: 'LineString', coordinates: [pt(x, flowStartY), pt(x, flowEndY)] },
      properties: { direction },
    })
  }

  return { features, rightEdgeX }
}

/** Builds a deceleration (off-ramp) or acceleration (on-ramp) parallel lane, returning where the ramp curve attaches. */
function auxiliaryLaneFeatures(idPrefix: string, rightEdgeX: number, mode: 'decel' | 'accel'): {
  features: RoadFeature[]
  attachPoint: Position
} {
  const outerX = rightEdgeX + AUX_LANE_WIDTH
  const casingOuterX = outerX + AUX_CASING_PAD
  const properties = { name: mode === 'decel' ? 'Deceleration lane' : 'Acceleration lane', highway: 'motorway_link', lanes: 1, direction: 'forward' as const }
  const wideY = AUX_TAPER_START_Y
  const narrowY = AUX_ATTACH_Y
  // decel: full width runs from the taper (near AUX_TAPER_END_Y) down to the gore at AUX_ATTACH_Y.
  // accel: full width runs from the wide end (AUX_TAPER_START_Y) down to where it tapers to 0 at AUX_ATTACH_Y.
  const casingRing = mode === 'decel'
    ? [pt(rightEdgeX, AUX_TAPER_START_Y), pt(casingOuterX, AUX_TAPER_END_Y), pt(casingOuterX, narrowY), pt(rightEdgeX, narrowY), pt(rightEdgeX, AUX_TAPER_START_Y)]
    : [pt(rightEdgeX, narrowY), pt(casingOuterX, AUX_TAPER_END_Y), pt(casingOuterX, wideY), pt(rightEdgeX, wideY), pt(rightEdgeX, narrowY)]
  const surfaceRing = mode === 'decel'
    ? [pt(rightEdgeX, AUX_TAPER_START_Y), pt(outerX, AUX_TAPER_END_Y), pt(outerX, narrowY), pt(rightEdgeX, narrowY), pt(rightEdgeX, AUX_TAPER_START_Y)]
    : [pt(rightEdgeX, narrowY), pt(outerX, AUX_TAPER_END_Y), pt(outerX, wideY), pt(rightEdgeX, wideY), pt(rightEdgeX, narrowY)]
  const shoulderEdge = mode === 'decel'
    ? [pt(rightEdgeX, AUX_TAPER_START_Y), pt(outerX, AUX_TAPER_END_Y), pt(outerX, narrowY)]
    : [pt(rightEdgeX, narrowY), pt(outerX, AUX_TAPER_END_Y), pt(outerX, wideY)]

  const features: RoadFeature[] = [
    { id: `${idPrefix}-aux-casing`, kind: 'road-casing', layer: 1, geometry: { type: 'Polygon', coordinates: [casingRing] }, properties },
    { id: `${idPrefix}-aux-surface`, kind: 'road-surface', layer: 1, geometry: { type: 'Polygon', coordinates: [surfaceRing] }, properties },
    { id: `${idPrefix}-aux-shoulder-edge`, kind: 'shoulder-edge', layer: 1, geometry: { type: 'LineString', coordinates: shoulderEdge }, properties: { direction: 'forward', renderWidthFeet: 1 } },
  ]
  const attachY = mode === 'decel' ? narrowY : wideY
  const attachPoint = pt((rightEdgeX + outerX) / 2, attachY)
  return { features, attachPoint }
}

/** Builds the ramp curve (straight or circular) running away from `attachPoint`, oriented off/on per style. */
function rampFeatures(idPrefix: string, attachPoint: Position, style: HighwayRampStyle): RoadFeature[] {
  const isOff = style === 'straight-off-ramp' || style === 'circular-off-ramp'
  const isCircular = style === 'circular-off-ramp' || style === 'circular-on-ramp'
  const [ax, ay] = attachPoint
  const relative: Position[] = isCircular
    ? [pt(0, 0), pt(4, -50), pt(20, -110), pt(46, -170), pt(73, -215), pt(84, -255), pt(94, -285)]
    : [pt(0, 0), pt(10, -40), pt(85, -235)]
  const oriented = isOff ? relative : relative.map(([dx, dy]): Position => pt(dx, -dy))
  const coordinates: Position[] = oriented.map(([dx, dy]) => pt(ax + dx, ay + dy))
  const properties = { name: isOff ? 'Exit ramp' : 'Entrance ramp', highway: 'motorway_link', lanes: 1, direction: 'forward' as const }
  return [
    { id: `${idPrefix}-ramp-casing`, kind: 'road-casing', layer: 1, geometry: { type: 'LineString', coordinates }, properties: { ...properties, renderWidthFeet: laneWidth + 8 } },
    { id: `${idPrefix}-ramp-surface`, kind: 'road-surface', layer: 1, geometry: { type: 'LineString', coordinates }, properties: { ...properties, renderWidthFeet: laneWidth } },
  ]
}

/**
 * Additively generates a generic highway `RoadScene` from four independent choices (lane count,
 * direction, auxiliary lane, ramp style) — a from-scratch alternative to an OSM lookup, meant to be
 * loaded into the Location Template Creator for further hand editing. Hand-authored geometry (no
 * offset/topology algorithms), same convention as `createRampFeatures`/the built-in templates.
 */
export function generateHighwayScene(options: HighwayGeneratorOptions): RoadScene {
  const isOff = options.ramp === 'straight-off-ramp' || options.ramp === 'circular-off-ramp'
  const wantsAux = (isOff && options.auxiliaryLane === 'deceleration-lane') || (!isOff && options.auxiliaryLane === 'acceleration-lane')

  const features: RoadFeature[] = []
  let primaryStartX = 4

  if (options.direction === 'both-directions') {
    const opposing = carriageway('opposing', 4, options.lanes, 'backward')
    features.push(...opposing.features)
    primaryStartX = opposing.rightEdgeX + AUX_CASING_PAD + 24
  }

  const primary = carriageway('primary', primaryStartX, options.lanes, 'forward')
  features.push(...primary.features)

  let attachPoint: Position = pt(primary.rightEdgeX, AUX_ATTACH_Y)
  if (wantsAux) {
    const aux = auxiliaryLaneFeatures('primary', primary.rightEdgeX, isOff ? 'decel' : 'accel')
    features.push(...aux.features)
    attachPoint = aux.attachPoint
  }
  features.push(...rampFeatures('primary', attachPoint, options.ramp))

  const { maxX } = boundsOf(features)
  const rampLabel = HIGHWAY_RAMP_OPTIONS.find((option) => option.value === options.ramp)?.label ?? options.ramp
  const directionLabel = options.direction === 'both-directions' ? 'divided' : 'one-way'

  return {
    version: 1,
    source: {
      type: 'reference-layout',
      dataset: `Generated ${options.lanes}-lane ${directionLabel} highway with ${rampLabel.toLowerCase()} scale reference`,
      generatedAt: new Date().toISOString(),
      attribution: 'Magnus generic highway generator; geometry is not map-derived.',
    },
    coordinateSystem: { worldCrs: 'EPSG:2283', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
    viewport: { width: maxX + 16, height: HEIGHT },
    features,
  }
}

export function defaultGeneratedHighwayName(options: HighwayGeneratorOptions): string {
  const directionLabel = options.direction === 'both-directions' ? 'Divided' : 'One-Way'
  const rampLabel = HIGHWAY_RAMP_OPTIONS.find((option) => option.value === options.ramp)?.label ?? ''
  return `${options.lanes} Lane Highway (${directionLabel}, ${rampLabel})`
}
