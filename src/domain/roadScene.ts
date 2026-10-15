export type Position = readonly [number, number]
export interface LineGeometry { type: 'LineString'; coordinates: Position[] }
export interface PolygonGeometry { type: 'Polygon'; coordinates: Position[][] }

export interface LaneRecord {
  laneType: string
  direction: string
  widthFeet: number
  sourceEvidence?: unknown
}

export interface RelationshipRecord {
  roadIds: number[]
  kind: string
  sourceNodeIds: number[]
}

export interface TopologyDiagnostic {
  kind: string
  roadIds: number[]
  sourceWayIds: number[]
  crossingPoint: Position
}

export interface MergeLaneZone {
  side: string
  geometrySide?: string
  startArcFeet: number
  endArcFeet: number
}

export interface NavigationRoad {
  topologyRoadId: number
  sourceWayIds: number[]
  endpointNodeIds?: number[]
  layer: number
  highway: string
  bridge?: boolean
  tunnel?: boolean
  laneRecords?: LaneRecord[]
  centerLine: Position[]
  surfacePolygon: Position[]
  widthFeet: number
  trimStartFeet: number
  trimEndFeet: number
  mergeLaneZone?: MergeLaneZone
}

export interface NavigationIntersection {
  sourceNodeIds: number[]
  connectedRoadIds?: number[]
  layer: number
  relationship?: string
  relationships?: RelationshipRecord[]
  polygon: Position[]
}

export interface NavigationMarking {
  topologyRoadId?: number
  sourceWayIds?: number[]
  markingType: string
  layer: number
  geometry: Position[]
}

/** Normalized map snapshot in the same scene feet as `RoadScene.features`. */
export interface NavigationMap {
  version: 1
  provider: string
  roads: NavigationRoad[]
  intersections: NavigationIntersection[]
  markings: NavigationMarking[]
}

export type RoadFeatureKind =
  | 'road-casing'
  | 'road-surface'
  | 'left-fog-line'
  | 'right-fog-line'
  | 'skip-line'
  | 'shoulder-edge'
  | 'traffic-flow'
  | 'ramp-gore'
  | 'direction-arrow'
  | 'ramp-surface-ribbon'
  | 'ramp-casing-ribbon'
  | 'auxiliary-lane-line'
  | 'intersection-surface'
  | 'semantic-marking'

export interface RoadFeature {
  id: string
  kind: RoadFeatureKind
  layer: number
  geometry: LineGeometry | PolygonGeometry
  properties: {
    osmId?: number
    topologyRoadId?: number
    sourceWayIds?: number[]
    endpointNodeIds?: number[]
    laneRecords?: LaneRecord[]
    relationship?: string
    connectedRoadIds?: number[]
    relationships?: RelationshipRecord[]
    name?: string
    highway?: string
    reference?: string
    junctionReference?: string
    destinationReference?: string
    bridge?: boolean
    tunnel?: boolean
    lanes?: number
    leftShoulderWidthFeet?: number
    rightShoulderWidthFeet?: number
    direction?: 'forward' | 'backward'
    renderWidthFeet?: number
    markingType?: string
    /** Editable centerline + per-point half-widths for hand-painted pavement (Location Template Creator paint/erase brush). */
    paintProfile?: { centerline: Position[]; leftWidths: number[]; rightWidths: number[] }
  }
}

export interface RoadScene {
  version: 1
  source: {
    type: 'osm-api' | 'osm-pbf' | 'qgis-supplement' | 'reference-layout'
    dataset: string
    generatedAt: string
    attribution: string
  }
  coordinateSystem: {
    worldCrs: string
    displayUnits: 'feet'
    origin: 'top-left'
    trafficFlow: 'bottom-to-top'
  }
  viewport: { width: number; height: number }
  features: RoadFeature[]
  diagnostics?: TopologyDiagnostic[]
  navigationMap?: NavigationMap
}

export const ROADWAY_DIMENSIONS_FEET = {
  viewportWidth: 72,
  viewportLength: 760,
  shoulderWidth: 12,
  laneWidth: 12,
  edgeLineWidth: 0.5,
  skipLineWidth: 0.5,
  skipStripeLength: 10,
  skipGapLength: 30,
  auxiliaryStripeLength: 3,
  auxiliaryGapLength: 9,
} as const

export type RoadLayer = 'roadGeometry' | 'barriers' | 'trafficFlow' | 'highwayLabels' | 'drawings'
export type RoadLayerVisibility = Record<RoadLayer, boolean>

export function roadLayerForFeature(feature: RoadFeature): RoadLayer {
  if (feature.kind === 'shoulder-edge') return 'barriers'
  if (feature.kind === 'traffic-flow') return 'trafficFlow'
  return 'roadGeometry'
}

const GENERIC_HIGHWAY_DATASET = /^(Three|\d+)-lane divided-highway scale reference$/

/** True for the generic straight-highway reference scene (any lane count), as opposed to a map pull or authored template. */
export function isGenericHighwayScene(scene: RoadScene): boolean {
  return scene.source.type === 'reference-layout' && GENERIC_HIGHWAY_DATASET.test(scene.source.dataset)
}

export function createReferenceRoadScene(lanes = 3): RoadScene {
  const { shoulderWidth, laneWidth, viewportLength } = ROADWAY_DIMENSIONS_FEET
  const laneCount = Math.max(1, Math.round(lanes))
  const edge = shoulderWidth + 6
  const width = edge * 2 + laneWidth * laneCount
  const leftFog = edge
  const rightFog = width - leftFog
  const verticalLine = (
    id: string,
    kind: RoadFeatureKind,
    x: number,
    layer = 1,
    renderWidthFeet?: number,
  ): RoadFeature => ({
    id,
    kind,
    layer,
    geometry: { type: 'LineString', coordinates: [[x, 0], [x, viewportLength]] },
    properties: { lanes: laneCount, direction: 'forward', renderWidthFeet },
  })
  const roadProperties = { name: 'I-95 Northbound', highway: 'motorway', reference: 'I-95', lanes: laneCount, direction: 'forward' as const }
  const rect = (inset: number): [number, number][] => [
    [inset, 0], [width - inset, 0], [width - inset, viewportLength], [inset, viewportLength], [inset, 0],
  ]
  const skipId = (index: number) =>
    index === 0 ? 'left-center-skip' : index === laneCount - 2 ? 'right-center-skip' : `center-skip-${index + 1}`
  const skipLines = Array.from({ length: laneCount - 1 }, (_, index) =>
    verticalLine(skipId(index), 'skip-line', leftFog + laneWidth * (index + 1), 2, ROADWAY_DIMENSIONS_FEET.skipLineWidth))
  const flowVectors = Array.from({ length: Math.max(1, laneCount - 1) }, (_, index): RoadFeature => {
    const x = leftFog + laneWidth / 2 + laneWidth * index
    return {
      id: index === 0 ? 'flow-vector-left' : index === 1 ? 'flow-vector-center' : `flow-vector-${index + 1}`,
      kind: 'traffic-flow',
      layer: 3,
      geometry: { type: 'LineString', coordinates: [[x, 705], [x, 55]] },
      properties: { direction: 'forward' },
    }
  })

  return {
    version: 1,
    source: {
      type: 'reference-layout',
      dataset: `${laneCount}-lane divided-highway scale reference`,
      generatedAt: '2026-08-20T00:00:00.000Z',
      attribution: 'Magnus scale reference; geometry is not map-derived.',
    },
    coordinateSystem: { worldCrs: 'EPSG:2283', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
    viewport: { width, height: viewportLength },
    features: [
      { id: 'mainline-casing', kind: 'road-casing', layer: 0, geometry: { type: 'Polygon', coordinates: [rect(4)] }, properties: roadProperties },
      { id: 'mainline-surface', kind: 'road-surface', layer: 0, geometry: { type: 'Polygon', coordinates: [rect(6)] }, properties: roadProperties },
      verticalLine('left-shoulder-edge', 'shoulder-edge', 6, 1, 1),
      verticalLine('left-fog-line', 'left-fog-line', leftFog, 2, ROADWAY_DIMENSIONS_FEET.edgeLineWidth),
      ...skipLines,
      verticalLine('right-fog-line', 'right-fog-line', rightFog, 2, ROADWAY_DIMENSIONS_FEET.edgeLineWidth),
      verticalLine('right-shoulder-edge', 'shoulder-edge', width - 6, 1, 1),
      ...flowVectors,
    ],
  }
}
