import {
  ROADWAY_DIMENSIONS_FEET,
  createDevelopmentRoadScene,
  type RoadFeature,
  type RoadScene,
} from './roadScene'
import type { ConnectivityMode } from './appSettings'

export type TravelDirection = 'northbound' | 'southbound' | 'eastbound' | 'westbound' | 'all'
export type RoadReferenceType = 'mile-marker' | 'exit'

export interface RoadLocationRequest {
  highway: string
  direction: TravelDirection
  referenceType: RoadReferenceType
  reference: string
}

export interface ResolvedRoadLocation {
  request: RoadLocationRequest
  scene: RoadScene
  source: 'live-map' | 'development-preview'
  message: string
}

export const travelDirections: { value: TravelDirection; label: string }[] = [
  { value: 'northbound', label: 'Northbound' },
  { value: 'southbound', label: 'Southbound' },
  { value: 'eastbound', label: 'Eastbound' },
  { value: 'westbound', label: 'Westbound' },
  { value: 'all', label: 'All directions' },
]

export function normalizeHighway(value: string): string {
  const compact = value.trim().toUpperCase().replaceAll('.', '').replace(/\s+/g, ' ')
  const interstate = /^I[ -]?(\d+)$/.exec(compact)
  if (interstate) return `I-${interstate[1]}`
  const route = /^(?:RT|ROUTE)[ -]?(\d+)$/.exec(compact)
  if (route) return `Route ${route[1]}`
  return compact
}

export function validateRoadLocation(request: RoadLocationRequest): string[] {
  const errors: string[] = []
  if (!normalizeHighway(request.highway)) errors.push('Enter a highway.')
  if (!request.reference.trim()) {
    errors.push(request.referenceType === 'exit' ? 'Enter an exit number.' : 'Enter a mile marker.')
  }
  return errors
}

function createRampFeatures(): RoadFeature[] {
  const centerline: RoadFeature['geometry'] = {
    type: 'LineString',
    coordinates: [[60, 760], [60, 410], [64, 350], [78, 290], [101, 220], [112, 155]],
  }
  const properties = {
    name: 'Interchange ramp preview',
    highway: 'motorway_link',
    lanes: 1,
    direction: 'forward' as const,
  }

  return [
    {
      id: 'preview-exit-ramp-casing',
      kind: 'road-casing',
      layer: 1,
      geometry: centerline,
      properties: { ...properties, renderWidthFeet: ROADWAY_DIMENSIONS_FEET.laneWidth + 8 },
    },
    {
      id: 'preview-exit-ramp-surface',
      kind: 'road-surface',
      layer: 1,
      geometry: centerline,
      properties: { ...properties, renderWidthFeet: ROADWAY_DIMENSIONS_FEET.laneWidth },
    },
  ]
}

function createMixingBowlPreviewFeatures(): RoadFeature[] {
  const roads = [
    {
      id: 'preview-i495-flyover',
      name: 'I-495 Capital Beltway flyover',
      layer: 1,
      coordinates: [[10, 510], [45, 470], [95, 445], [145, 430], [205, 425]] as const,
      lanes: 3,
    },
    {
      id: 'preview-express-ramp',
      name: 'Northbound express connector',
      layer: 2,
      coordinates: [[20, 610], [55, 540], [100, 490], [155, 455], [205, 440]] as const,
      lanes: 1,
    },
  ]

  return roads.flatMap((road): RoadFeature[] => {
    const width = road.lanes * ROADWAY_DIMENSIONS_FEET.laneWidth
    const geometry: RoadFeature['geometry'] = {
      type: 'LineString',
      coordinates: road.coordinates.map(([x, y]) => [x, y]),
    }
    const properties = {
      name: road.name,
      highway: road.lanes === 1 ? 'motorway_link' : 'motorway',
      bridge: true,
      lanes: road.lanes,
      direction: 'forward' as const,
    }
    return [
      {
        id: `${road.id}-casing`,
        kind: 'road-casing',
        layer: road.layer,
        geometry,
        properties: { ...properties, renderWidthFeet: width + 8 },
      },
      {
        id: `${road.id}-surface`,
        kind: 'road-surface',
        layer: road.layer,
        geometry,
        properties: { ...properties, renderWidthFeet: width },
      },
    ]
  })
}

export function createLocationPreviewScene(request: RoadLocationRequest): RoadScene {
  const scene = createDevelopmentRoadScene()
  const normalizedRequest = { ...request, highway: normalizeHighway(request.highway) }
  const referenceLabel = request.referenceType === 'exit'
    ? `Exit ${request.reference.trim()}`
    : `MM ${request.reference.trim()}`
  const direction = travelDirections.find((item) => item.value === request.direction)?.label

  const isMixingBowl = normalizedRequest.highway === 'I-95'
    && normalizedRequest.direction === 'northbound'
    && normalizedRequest.referenceType === 'mile-marker'
    && Number(normalizedRequest.reference) === 170
  const previewFeatures = isMixingBowl
    ? createMixingBowlPreviewFeatures()
    : request.referenceType === 'exit' ? createRampFeatures() : []

  return {
    ...scene,
    source: {
      ...scene.source,
      dataset: `${normalizedRequest.highway} ${direction} ${referenceLabel} scale preview`,
      attribution: 'Development preview geometry; load a compiled OSM scene before operational use.',
    },
    viewport: { width: isMixingBowl ? 220 : 122, height: scene.viewport.height },
    features: [...scene.features, ...previewFeatures],
  }
}

function isRoadScene(value: unknown): value is RoadScene {
  if (!value || typeof value !== 'object') return false
  const scene = value as Partial<RoadScene>
  return scene.version === 1 && Boolean(scene.viewport) && Array.isArray(scene.features)
}

export async function resolveRoadLocation(
  request: RoadLocationRequest,
  loadScene: (path: string) => Promise<unknown> = async (path) => {
    const response = await fetch(path)
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      const body: unknown = await response.json().catch(() => null)
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Map service returned HTTP ${response.status}`
      throw new Error(message)
    }
    return response.json()
  },
  sourceMode: ConnectivityMode = 'online',
): Promise<ResolvedRoadLocation> {
  const normalizedRequest = { ...request, highway: normalizeHighway(request.highway) }
  try {
    const query = new URLSearchParams({
      highway: normalizedRequest.highway,
      direction: 'all',
      referenceType: normalizedRequest.referenceType,
      reference: normalizedRequest.reference.trim(),
      source: sourceMode,
    })
    const scene = await loadScene(`/api/road-scenes/resolve?${query.toString()}`)
    if (!isRoadScene(scene)) throw new Error('Map service returned an invalid RoadScene contract')
    return {
      request: normalizedRequest,
      scene,
      source: 'live-map',
      message: sourceMode === 'online'
        ? 'Online OpenStreetMap geometry loaded.'
        : sourceMode === 'lan'
          ? 'LAN spatial data loaded.'
          : 'Prepared offline geometry loaded.',
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown map service error'
    const referenceLabel = normalizedRequest.referenceType === 'exit' ? 'exit' : 'mile marker'
    return {
      request: normalizedRequest,
      scene: createLocationPreviewScene(normalizedRequest),
      source: 'development-preview',
      message: `${sourceMode === 'online' ? 'Online' : sourceMode === 'lan' ? 'LAN' : 'Offline'} map geometry is unavailable for ${normalizedRequest.highway}, ${referenceLabel} ${normalizedRequest.reference}: ${reason}. Showing a scale-accurate development preview without map-derived labels.`,
    }
  }
}
