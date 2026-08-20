export type Position = readonly [number, number]
export interface LineGeometry { type: 'LineString'; coordinates: Position[] }
export interface PolygonGeometry { type: 'Polygon'; coordinates: Position[][] }

export type RoadFeatureKind =
  | 'road-casing'
  | 'road-surface'
  | 'left-fog-line'
  | 'right-fog-line'
  | 'skip-line'
  | 'shoulder-edge'
  | 'traffic-flow'

export interface RoadFeature {
  id: string
  kind: RoadFeatureKind
  layer: number
  geometry: LineGeometry | PolygonGeometry
  properties: {
    osmId?: number
    name?: string
    highway?: string
    bridge?: boolean
    tunnel?: boolean
    lanes?: number
    direction?: 'forward' | 'backward'
    renderWidthFeet?: number
  }
}

export interface RoadScene {
  version: 1
  source: {
    type: 'osm-pbf' | 'qgis-supplement' | 'development-fixture'
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
}

export function createDevelopmentRoadScene(): RoadScene {
  const verticalLine = (id: string, kind: RoadFeatureKind, x: number, layer = 1): RoadFeature => ({
    id,
    kind,
    layer,
    geometry: { type: 'LineString', coordinates: [[x, 0], [x, 760]] },
    properties: { lanes: 3, direction: 'forward' },
  })

  return {
    version: 1,
    source: {
      type: 'development-fixture',
      dataset: 'I-95 northbound contract fixture',
      generatedAt: '2026-08-20T00:00:00.000Z',
      attribution: 'Development geometry only; replace with locally compiled OpenStreetMap data.',
    },
    coordinateSystem: {
      worldCrs: 'EPSG:2283',
      displayUnits: 'feet',
      origin: 'top-left',
      trafficFlow: 'bottom-to-top',
    },
    viewport: { width: 500, height: 760 },
    features: [
      {
        id: 'mainline-casing',
        kind: 'road-casing',
        layer: 0,
        geometry: { type: 'Polygon', coordinates: [[[14, 0], [492, 0], [492, 760], [14, 760], [14, 0]]] },
        properties: { name: 'I-95 Northbound', highway: 'motorway', lanes: 3, direction: 'forward' },
      },
      {
        id: 'mainline-surface',
        kind: 'road-surface',
        layer: 0,
        geometry: { type: 'Polygon', coordinates: [[[20, 0], [480, 0], [480, 760], [20, 760], [20, 0]]] },
        properties: { name: 'I-95 Northbound', highway: 'motorway', lanes: 3, direction: 'forward' },
      },
      verticalLine('left-shoulder-edge', 'shoulder-edge', 20),
      verticalLine('left-fog-line', 'left-fog-line', 27, 2),
      verticalLine('left-center-skip', 'skip-line', 150, 2),
      verticalLine('right-center-skip', 'skip-line', 270, 2),
      verticalLine('right-fog-line', 'right-fog-line', 390, 2),
      verticalLine('right-shoulder-edge', 'shoulder-edge', 480),
      {
        id: 'flow-vector-left',
        kind: 'traffic-flow',
        layer: 3,
        geometry: { type: 'LineString', coordinates: [[91, 705], [91, 55]] },
        properties: { direction: 'forward' },
      },
      {
        id: 'flow-vector-center',
        kind: 'traffic-flow',
        layer: 3,
        geometry: { type: 'LineString', coordinates: [[211, 705], [211, 55]] },
        properties: { direction: 'forward' },
      },
    ],
  }
}