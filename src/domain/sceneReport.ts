import type { AgencyGroup, ReportedHazards, SceneHazard, ShoulderSide, VehicleHazardState } from './communications'
import { NO_HAZARDS } from './communications'
import { equipmentDefinition, type DeployedEquipment } from './equipmentCatalog'
import { ROADWAY_DIMENSIONS_FEET } from './roadScene'
import type { ScenarioType } from './sop'

const VEHICLE_HAZARD_IDS = new Set([
  'sedan-green', 'sedan-grey', 'sedan-black', 'vehicle-fire', 'pickup-green', 'pickup-grey', 'pickup-black',
  'tractor-trailer', 'hazmat-tanker', 'jackknife-left', 'tractor-purple', 'school-bus', 'tour-bus',
  'car-hauler-trailer', 'fifth-wheel-hauler', 'fallen-motorcycle',
])
const TRACTOR_TRAILER_IDS = new Set(['tractor-trailer', 'hazmat-tanker', 'jackknife-left', 'tractor-purple', 'fifth-wheel-hauler'])
const DEBRIS_IDS = new Set(['debris-grey', 'debris-red', 'deer'])

/** Spoken noun (singular, plural) for each reportable object. */
const VEHICLE_NOUNS: Record<string, [string, string]> = {
  'sedan-green': ['car', 'cars'], 'sedan-grey': ['car', 'cars'], 'sedan-black': ['car', 'cars'],
  'pickup-green': ['pickup truck', 'pickup trucks'], 'pickup-grey': ['pickup truck', 'pickup trucks'], 'pickup-black': ['pickup truck', 'pickup trucks'],
  'tractor-trailer': ['tractor trailer', 'tractor trailers'], 'hazmat-tanker': ['tanker truck', 'tanker trucks'],
  'jackknife-left': ['jackknifed tractor trailer', 'jackknifed tractor trailers'], 'tractor-purple': ['tractor', 'tractors'],
  'school-bus': ['school bus', 'school buses'], 'tour-bus': ['tour bus', 'tour buses'],
  'car-hauler-trailer': ['car hauler trailer', 'car hauler trailers'], 'fifth-wheel-hauler': ['pickup with a car hauler', 'pickups with car haulers'],
  'fallen-motorcycle': ['motorcycle down', 'motorcycles down'],
}

const AGENCY_BY_ASSET: Record<string, AgencyGroup> = {
  'vsp-cruiser': 'vsp',
  'ems-ambulance': 'ems',
  'ladder-truck': 'fire',
  'pump-truck': 'fire',
  'fire-chief': 'fire',
  'tow-truck': 'tow',
  'heavy-tow-truck': 'tow',
  'tree-removal-truck': 'tree-removal',
}

export function isVehicleHazard(definitionId: string): boolean {
  return VEHICLE_HAZARD_IDS.has(definitionId)
}

/** Vehicle fires and wrecks imply their state; every other vehicle is plain traffic until the user says otherwise. */
export function defaultVehicleHazardState(definitionId: string): VehicleHazardState {
  if (definitionId === 'vehicle-fire') return 'fire'
  if (definitionId === 'jackknife-left' || definitionId === 'fallen-motorcycle') return 'crashed'
  return 'traffic'
}

export function vehicleHazardState(item: DeployedEquipment): VehicleHazardState {
  return item.hazardState ?? defaultVehicleHazardState(item.definitionId)
}

export function reportedHazards(equipment: DeployedEquipment[]): ReportedHazards {
  const hazards = { ...NO_HAZARDS }
  for (const item of equipment) {
    if (isVehicleHazard(item.definitionId)) {
      const state = vehicleHazardState(item)
      if (state === 'crashed') hazards.crashedVehicles += 1
      else if (state === 'disabled') hazards.disabledVehicles += 1
      else if (state === 'fire') {
        if (TRACTOR_TRAILER_IDS.has(item.definitionId)) hazards.tractorTrailerFires += 1
        else hazards.vehicleFires += 1
      }
    } else if (DEBRIS_IDS.has(item.definitionId)) {
      hazards.debris += 1
    } else if (item.definitionId === 'downed-tree') {
      hazards.downedTrees += 1
    }
  }
  return hazards
}

export interface SceneLayout {
  laneCount: number
  /** True when equipment coordinates sit on the generic straight highway, so lane occupancy can be measured. */
  generic: boolean
  scenario: ScenarioType
}

interface Occupancy { lanes: number[]; shoulders: ShoulderSide[] }

const EDGE_TOLERANCE_FEET = 0.75

/** Lateral extent of a rotated rectangle in the scene frame (width across x, length along y before rotation). */
function lateralExtent(item: DeployedEquipment): [number, number] {
  const definition = equipmentDefinition(item.definitionId)
  const width = item.width ?? definition.width
  const length = item.length ?? definition.length
  const radians = (item.rotation * Math.PI) / 180
  const half = Math.abs((width / 2) * Math.cos(radians)) + Math.abs((length / 2) * Math.sin(radians))
  return [item.x - half + EDGE_TOLERANCE_FEET, item.x + half - EDGE_TOLERANCE_FEET]
}

/** Lanes (0 = left) and shoulders an item's footprint touches on the generic highway; see createReferenceRoadScene. */
export function laneOccupancy(item: DeployedEquipment, laneCount: number): Occupancy {
  const { shoulderWidth, laneWidth } = ROADWAY_DIMENSIONS_FEET
  const leftFog = shoulderWidth + 6
  const rightFog = leftFog + laneWidth * laneCount
  const [minX, maxX] = lateralExtent(item)
  const lanes: number[] = []
  for (let index = 0; index < laneCount; index += 1) {
    const laneLeft = leftFog + laneWidth * index
    if (maxX > laneLeft && minX < laneLeft + laneWidth) lanes.push(index)
  }
  const shoulders: ShoulderSide[] = []
  if (minX < leftFog) shoulders.push('left')
  if (maxX > rightFog) shoulders.push('right')
  return { lanes, shoulders }
}

/** Lanes a closure scenario covers, used when the roadway is a map pull and footprints cannot be measured. */
export function scenarioOccupancy(scenario: ScenarioType, laneCount: number): Occupancy {
  const last = laneCount - 1
  const all = Array.from({ length: laneCount }, (_, index) => index)
  switch (scenario) {
    case 'shoulder': return { lanes: [], shoulders: ['right'] }
    case 'right-lane': return { lanes: [last], shoulders: [] }
    case 'left-lane': return { lanes: [0], shoulders: [] }
    case 'center-lane': return { lanes: [Math.floor(laneCount / 2)], shoulders: [] }
    case 'two-right-lanes': return { lanes: [Math.max(0, last - 1), last], shoulders: [] }
    case 'two-left-lanes': return { lanes: [0, Math.min(1, last)], shoulders: [] }
    case 'all-lanes': return { lanes: all, shoulders: [] }
    default: return { lanes: [last], shoulders: [] }
  }
}

function isRotated(item: DeployedEquipment): boolean {
  return Math.abs(((item.rotation % 360) + 360) % 360) > 1
}

/**
 * The objects the SSP would name in the initial call-out, with the lanes/shoulders each one covers.
 * Vehicles count only when rotated, on a shoulder, or flagged crashed/disabled/on fire; a vehicle
 * sitting straight in a travel lane is just traffic.
 */
export function sceneHazards(equipment: DeployedEquipment[], layout: SceneLayout): SceneHazard[] {
  const hazards: SceneHazard[] = []
  for (const item of equipment) {
    const where = layout.generic ? laneOccupancy(item, layout.laneCount) : scenarioOccupancy(layout.scenario, layout.laneCount)
    if (isVehicleHazard(item.definitionId)) {
      const state = vehicleHazardState(item)
      const onShoulder = where.shoulders.length > 0
      if (state === 'traffic' && !isRotated(item) && !onShoulder) continue
      const tractorTrailer = TRACTOR_TRAILER_IDS.has(item.definitionId)
      const noun: [string, string] = state === 'fire' || item.definitionId === 'vehicle-fire'
        ? (tractorTrailer ? ['tractor trailer fire', 'tractor trailer fires'] : ['vehicle fire', 'vehicle fires'])
        : VEHICLE_NOUNS[item.definitionId] ?? ['vehicle', 'vehicles']
      hazards.push({ kind: 'vehicle', noun, ...where })
    } else if (DEBRIS_IDS.has(item.definitionId)) {
      hazards.push({ kind: 'debris', noun: item.definitionId === 'deer' ? ['deer', 'deer'] : ['debris', 'debris'], ...where })
    } else if (item.definitionId === 'downed-tree') {
      hazards.push({ kind: 'tree', noun: ['downed tree', 'downed trees'], ...where })
    } else if (item.definitionId === 'airplane') {
      hazards.push({ kind: 'other', noun: ['downed airplane', 'downed airplanes'], ...where })
    }
  }
  return hazards
}

export function agenciesOnScene(equipment: DeployedEquipment[]): AgencyGroup[] {
  const groups = new Set<AgencyGroup>()
  for (const item of equipment) {
    const group = AGENCY_BY_ASSET[item.definitionId]
    if (group && equipmentDefinition(item.definitionId).category === 'external-asset') groups.add(group)
  }
  return [...groups]
}
