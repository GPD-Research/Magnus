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
  normalizedTopology?: unknown
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
} as const

export type RoadLayer = 'roadGeometry' | 'barriers' | 'trafficFlow' | 'highwayLabels' | 'drawings'
export type RoadLayerVisibility = Record<RoadLayer, boolean>

export function roadLayerForFeature(feature: RoadFeature): RoadLayer {
  if (feature.kind === 'shoulder-edge') return 'barriers'
  if (feature.kind === 'traffic-flow') return 'trafficFlow'
  return 'roadGeometry'
}

export function createReferenceRoadScene(): RoadScene {
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
    geometry: {
      type: 'LineString',
      coordinates: [[x, 0], [x, ROADWAY_DIMENSIONS_FEET.viewportLength]],
    },
    properties: { lanes: 3, direction: 'forward', renderWidthFeet },
  })

  return {
    version: 1,
    source: {
      type: 'reference-layout',
      dataset: 'Three-lane divided-highway scale reference',
      generatedAt: '2026-08-20T00:00:00.000Z',
      attribution: 'Magnus scale reference; geometry is not map-derived.',
    },
    coordinateSystem: {
      worldCrs: 'EPSG:2283',
      displayUnits: 'feet',
      origin: 'top-left',
      trafficFlow: 'bottom-to-top',
    },
    viewport: {
      width: ROADWAY_DIMENSIONS_FEET.viewportWidth,
      height: ROADWAY_DIMENSIONS_FEET.viewportLength,
    },
    features: [
      {
        id: 'mainline-casing',
        kind: 'road-casing',
        layer: 0,
        geometry: { type: 'Polygon', coordinates: [[[4, 0], [68, 0], [68, 760], [4, 760], [4, 0]]] },
        properties: { name: 'I-95 Northbound', highway: 'motorway', reference: 'I-95', lanes: 3, direction: 'forward' },
      },
      {
        id: 'mainline-surface',
        kind: 'road-surface',
        layer: 0,
        geometry: { type: 'Polygon', coordinates: [[[6, 0], [66, 0], [66, 760], [6, 760], [6, 0]]] },
        properties: { name: 'I-95 Northbound', highway: 'motorway', reference: 'I-95', lanes: 3, direction: 'forward' },
      },
      verticalLine('left-shoulder-edge', 'shoulder-edge', 6, 1, 1),
      verticalLine('left-fog-line', 'left-fog-line', 18, 2, ROADWAY_DIMENSIONS_FEET.edgeLineWidth),
      verticalLine('left-center-skip', 'skip-line', 30, 2, ROADWAY_DIMENSIONS_FEET.skipLineWidth),
      verticalLine('right-center-skip', 'skip-line', 42, 2, ROADWAY_DIMENSIONS_FEET.skipLineWidth),
      verticalLine('right-fog-line', 'right-fog-line', 54, 2, ROADWAY_DIMENSIONS_FEET.edgeLineWidth),
      verticalLine('right-shoulder-edge', 'shoulder-edge', 66, 1, 1),
      {
        id: 'flow-vector-left',
        kind: 'traffic-flow',
        layer: 3,
        geometry: { type: 'LineString', coordinates: [[24, 705], [24, 55]] },
        properties: { direction: 'forward' },
      },
      {
        id: 'flow-vector-center',
        kind: 'traffic-flow',
        layer: 3,
        geometry: { type: 'LineString', coordinates: [[48, 705], [48, 55]] },
        properties: { direction: 'forward' },
      },
    ],
  }
}