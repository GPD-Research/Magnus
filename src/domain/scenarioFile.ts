import type { DeployedEquipment } from './equipmentCatalog'
import type { DrawingStroke } from './drawing'
import { isIncidentType, normalizeTocIncidentDetails, type IncidentType, type TocIncidentDetails } from './communications'
import type { ResolvedRoadLocation, RoadLocationRequest } from './roadLocation'
import type { RoadLayerVisibility, RoadScene } from './roadScene'
import type { SspTruckState } from './signboard'
import type { ComplianceMode, ScenarioType, ScenePoint } from './sop'

export interface PortableScenarioState {
  scenario: ScenarioType
  sceneVisible: boolean
  sceneOrigin: { x: number; y: number }
  sceneRotation: number
  mapRotation: number
  mode: ComplianceMode
  laneCount: number
  points: ScenePoint[]
  trucks: SspTruckState[]
  deployedEquipment: DeployedEquipment[]
  drawingStrokes: DrawingStroke[]
  radioEvents: { time: string; text: string; channel: string }[]
  incidentType: IncidentType
  tocIncidentDetails: TocIncidentDetails
  roadScene: RoadScene
  locationRequest: RoadLocationRequest
  resolvedLocation: ResolvedRoadLocation | null
  roadLayerVisibility: RoadLayerVisibility
  sceneZoom: number
}

export interface PortableScenarioDocument {
  kind: 'magnus-scene'
  version: 2
  appVersion: string
  createdAt: string
  state: PortableScenarioState
}

export function createPortableScenario(
  state: PortableScenarioState,
  appVersion: string,
  createdAt = new Date().toISOString(),
): PortableScenarioDocument {
  return { kind: 'magnus-scene', version: 2, appVersion, createdAt, state }
}

function normalizeRoadScene(scene: RoadScene): RoadScene {
  const sourceType = (scene.source as { type: string }).type
  if (sourceType !== 'development-fixture') return scene
  return {
    ...scene,
    source: {
      ...scene.source,
      type: 'reference-layout',
      attribution: 'Magnus scale reference; geometry is not map-derived.',
    },
  }
}

export function parsePortableScenario(value: string): PortableScenarioDocument {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object') throw new Error('Scene file is not a JSON object.')
  const document = parsed as Partial<PortableScenarioDocument>
  if (document.kind !== 'magnus-scene' || document.version !== 2) {
    throw new Error('Unsupported Magnus scene file.')
  }
  if (!document.state || typeof document.appVersion !== 'string' || typeof document.createdAt !== 'string') {
    throw new Error('Magnus scene file is incomplete.')
  }
  const state = document.state
  if (!state.scenario || !state.mode || typeof state.laneCount !== 'number'
    || !Array.isArray(state.points) || !Array.isArray(state.trucks)
    || !Array.isArray(state.deployedEquipment) || !Array.isArray(state.radioEvents)
    || !state.roadScene || !state.locationRequest || !state.roadLayerVisibility
    || typeof state.sceneZoom !== 'number') {
    throw new Error('Magnus scene file is incomplete.')
  }
  return {
    kind: document.kind,
    version: document.version,
    appVersion: document.appVersion,
    createdAt: document.createdAt,
    state: {
      ...state,
      mapRotation: typeof state.mapRotation === 'number' ? state.mapRotation : 0,
      trucks: state.trucks.map((truck) => ({
        ...truck,
        rotation: typeof truck.rotation === 'number' ? truck.rotation : 0,
        assetType: truck.assetType === 'lane-blade-truck' ? 'lane-blade-truck' : 'ssp-truck',
      })),
      drawingStrokes: Array.isArray(state.drawingStrokes) ? state.drawingStrokes : [],
      incidentType: isIncidentType(state.incidentType) ? state.incidentType : 'crash',
      tocIncidentDetails: normalizeTocIncidentDetails(state.tocIncidentDetails),
      roadScene: normalizeRoadScene(state.roadScene),
      resolvedLocation: state.resolvedLocation
        ? {
            ...state.resolvedLocation,
            source: (state.resolvedLocation.source as string) === 'development-preview'
              ? 'reference-layout'
              : state.resolvedLocation.source,
            scene: normalizeRoadScene(state.resolvedLocation.scene),
          }
        : null,
      roadLayerVisibility: {
        ...state.roadLayerVisibility,
        drawings: state.roadLayerVisibility.drawings !== false,
      },
    },
  }
}