import type { AgencyGroup, ReportedHazards, VehicleHazardState } from './communications'
import { NO_HAZARDS } from './communications'
import { equipmentDefinition, type DeployedEquipment } from './equipmentCatalog'

const VEHICLE_HAZARD_IDS = new Set([
  'sedan-green', 'sedan-grey', 'sedan-black', 'vehicle-fire', 'pickup-green', 'pickup-grey', 'pickup-black',
  'tractor-trailer', 'hazmat-tanker', 'jackknife-left', 'tractor-purple', 'school-bus', 'tour-bus',
  'car-hauler-trailer', 'fifth-wheel-hauler', 'fallen-motorcycle',
])
const TRACTOR_TRAILER_IDS = new Set(['tractor-trailer', 'hazmat-tanker', 'jackknife-left', 'tractor-purple', 'fifth-wheel-hauler'])
const DEBRIS_IDS = new Set(['debris-grey', 'debris-red', 'deer'])

const AGENCY_BY_ASSET: Record<string, AgencyGroup> = {
  'vsp-cruiser': 'vsp',
  'ems-ambulance': 'fire-rescue',
  'ladder-truck': 'fire-rescue',
  'pump-truck': 'fire-rescue',
  'fire-chief': 'fire-rescue',
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

export function agenciesOnScene(equipment: DeployedEquipment[]): AgencyGroup[] {
  const groups = new Set<AgencyGroup>()
  for (const item of equipment) {
    const group = AGENCY_BY_ASSET[item.definitionId]
    if (group && equipmentDefinition(item.definitionId).category === 'external-asset') groups.add(group)
  }
  return [...groups]
}
