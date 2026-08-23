import type { TravelDirection } from './roadLocation'
import type { RoadReferenceType } from './roadLocation'
import type { ScenarioType } from './sop'

export type CommunicationDirection = Exclude<TravelDirection, 'all'>
export type ReportStatus = 'unknown' | 'none' | 'reported'
export type YesNoUnknown = 'unknown' | 'yes' | 'no'
export type IncidentType =
  | 'car-fire'
  | 'tractor-trailer-fire'
  | 'crash'
  | 'severe-crash'
  | 'plane-crash'
  | 'bridge-collapse'
  | 'overhead-signage-collapse'
  | 'disabled-vehicle'
  | 'blocking-disabled'
  | 'debris'
  | 'downed-tree'

export const INCIDENT_TYPE_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: 'car-fire', label: 'Car fire' },
  { value: 'tractor-trailer-fire', label: 'Tractor trailer fire' },
  { value: 'crash', label: 'Crash' },
  { value: 'severe-crash', label: 'Severe crash' },
  { value: 'plane-crash', label: 'Plane crash' },
  { value: 'bridge-collapse', label: 'Bridge collapse' },
  { value: 'overhead-signage-collapse', label: 'Overhead signage collapse' },
  { value: 'disabled-vehicle', label: 'Disabled vehicle (shoulder)' },
  { value: 'blocking-disabled', label: 'Blocking disabled (travel lane)' },
  { value: 'debris', label: 'Debris' },
  { value: 'downed-tree', label: 'Downed tree' },
]

export function isIncidentType(value: unknown): value is IncidentType {
  return INCIDENT_TYPE_OPTIONS.some((option) => option.value === value)
}

export interface TocIncidentDetails {
  crashVehicleCount: number
  emsTransportCount: number
  injuries: ReportStatus
  licensePlate: string
  licensePlateState: string
  vehicleMake: string
  vehicleModel: string
  vehicleColor: string
  planeLanesImpacted: string
  planeSize: string
  survivors: YesNoUnknown
  treeLanesBlocked: string
  treeSize: string
  treeResourcesNeeded: string
  debrisHazardous: YesNoUnknown
  debrisManualRemoval: YesNoUnknown
  debrisNeedsSlowRoll: YesNoUnknown
  debrisHasLaneBlade: YesNoUnknown
  carFireMotoristOut: YesNoUnknown
  carFireFullyEngulfed: YesNoUnknown
  carFireIsEv: YesNoUnknown
  carFireLanesBlocked: string
  tractorDriverOut: YesNoUnknown
  tractorTrailerCargo: string
  tractorHazmat: YesNoUnknown
  tractorFullyEngulfed: YesNoUnknown
  tractorLanesBlocked: string
}

export const DEFAULT_TOC_INCIDENT_DETAILS: TocIncidentDetails = {
  crashVehicleCount: 2,
  emsTransportCount: 0,
  injuries: 'unknown',
  licensePlate: '',
  licensePlateState: '',
  vehicleMake: '',
  vehicleModel: '',
  vehicleColor: '',
  planeLanesImpacted: 'all lanes',
  planeSize: 'unknown size',
  survivors: 'unknown',
  treeLanesBlocked: 'unknown lanes',
  treeSize: '20 feet',
  treeResourcesNeeded: 'unknown',
  debrisHazardous: 'unknown',
  debrisManualRemoval: 'unknown',
  debrisNeedsSlowRoll: 'unknown',
  debrisHasLaneBlade: 'unknown',
  carFireMotoristOut: 'unknown',
  carFireFullyEngulfed: 'unknown',
  carFireIsEv: 'unknown',
  carFireLanesBlocked: 'unknown lanes',
  tractorDriverOut: 'unknown',
  tractorTrailerCargo: '',
  tractorHazmat: 'unknown',
  tractorFullyEngulfed: 'unknown',
  tractorLanesBlocked: 'unknown lanes',
}

export function normalizeTocIncidentDetails(value: unknown): TocIncidentDetails {
  if (!value || typeof value !== 'object') return DEFAULT_TOC_INCIDENT_DETAILS
  const details = value as Partial<TocIncidentDetails>
  return {
    crashVehicleCount: typeof details.crashVehicleCount === 'number' ? Math.max(1, details.crashVehicleCount) : 2,
    emsTransportCount: typeof details.emsTransportCount === 'number' ? Math.max(0, details.emsTransportCount) : 0,
    injuries: details.injuries === 'none' || details.injuries === 'reported' ? details.injuries : 'unknown',
    licensePlate: typeof details.licensePlate === 'string' ? details.licensePlate : '',
    licensePlateState: typeof details.licensePlateState === 'string' ? details.licensePlateState : '',
    vehicleMake: typeof details.vehicleMake === 'string' ? details.vehicleMake : '',
    vehicleModel: typeof details.vehicleModel === 'string' ? details.vehicleModel : '',
    vehicleColor: typeof details.vehicleColor === 'string' ? details.vehicleColor : '',
    planeLanesImpacted: typeof details.planeLanesImpacted === 'string' ? details.planeLanesImpacted : 'all lanes',
    planeSize: typeof details.planeSize === 'string' ? details.planeSize : 'unknown size',
    survivors: details.survivors === 'yes' || details.survivors === 'no' ? details.survivors : 'unknown',
    treeLanesBlocked: typeof details.treeLanesBlocked === 'string' ? details.treeLanesBlocked : 'unknown lanes',
    treeSize: typeof details.treeSize === 'string' ? details.treeSize : '20 feet',
    treeResourcesNeeded: typeof details.treeResourcesNeeded === 'string' ? details.treeResourcesNeeded : 'unknown',
    debrisHazardous: yesNoUnknown(details.debrisHazardous),
    debrisManualRemoval: yesNoUnknown(details.debrisManualRemoval),
    debrisNeedsSlowRoll: yesNoUnknown(details.debrisNeedsSlowRoll),
    debrisHasLaneBlade: yesNoUnknown(details.debrisHasLaneBlade),
    carFireMotoristOut: yesNoUnknown(details.carFireMotoristOut),
    carFireFullyEngulfed: yesNoUnknown(details.carFireFullyEngulfed),
    carFireIsEv: yesNoUnknown(details.carFireIsEv),
    carFireLanesBlocked: typeof details.carFireLanesBlocked === 'string' ? details.carFireLanesBlocked : 'unknown lanes',
    tractorDriverOut: yesNoUnknown(details.tractorDriverOut),
    tractorTrailerCargo: typeof details.tractorTrailerCargo === 'string' ? details.tractorTrailerCargo : '',
    tractorHazmat: yesNoUnknown(details.tractorHazmat),
    tractorFullyEngulfed: yesNoUnknown(details.tractorFullyEngulfed),
    tractorLanesBlocked: typeof details.tractorLanesBlocked === 'string' ? details.tractorLanesBlocked : 'unknown lanes',
  }
}

function yesNoUnknown(value: unknown): YesNoUnknown {
  return value === 'yes' || value === 'no' ? value : 'unknown'
}

export interface RadioMessage {
  channel: 'SSP' | 'TOC'
  text: string
}

export interface InitialRadioCallOptions {
  unit: string
  highway: string
  direction: CommunicationDirection
  referenceType: RoadReferenceType
  reference: string
  incidentType: IncidentType
  details: TocIncidentDetails
  scenario: ScenarioType
  travelLanes: number
}

export function buildInitialRadioExchange(options: InitialRadioCallOptions): RadioMessage[] {
  const highway = spokenHighway(options.highway)
  const location = options.referenceType === 'exit'
    ? `exit ${options.reference.trim()}`
    : `mile marker ${options.reference.trim()}`
  const incident = incidentDescription(options.incidentType, options.scenario, options.travelLanes)
  const details = tocDetails(options.incidentType, options.details)
  const escalation = options.incidentType === 'severe-crash' ? 'roll EMS, ' : ''
  return [
    { channel: 'SSP', text: `${options.unit} to ${highway} control` },
    { channel: 'TOC', text: `${options.unit}, go ahead` },
    {
      channel: 'SSP',
      text: `Show me out ${options.direction} ${highway} at ${location}, with ${incident}, ${details}${escalation}I'll advise.`,
    },
  ]
}

function tocDetails(incidentType: IncidentType, details: TocIncidentDetails): string {
  if (incidentType === 'crash' || incidentType === 'severe-crash') {
    const vehicles = `${details.crashVehicleCount} ${details.crashVehicleCount === 1 ? 'vehicle' : 'vehicles'} involved`
    const transported = `${details.emsTransportCount} ${details.emsTransportCount === 1 ? 'motorist' : 'motorists'} transported by EMS`
    const injuries = details.injuries === 'reported' ? 'injuries reported' : details.injuries === 'none' ? 'no injuries reported' : 'injuries unknown'
    return `${vehicles}, ${transported}, ${injuries}, `
  }
  if (incidentType === 'disabled-vehicle' || incidentType === 'blocking-disabled') {
    const plateState = details.licensePlateState.trim() || 'unknown state'
    const plate = details.licensePlate.trim() || 'unknown plate'
    const color = details.vehicleColor.trim() || 'unknown color'
    const make = details.vehicleMake.trim() || 'unknown make'
    const model = details.vehicleModel.trim() || 'unknown model'
    return `${plateState} plate ${plate}, ${color} ${make} ${model}, `
  }
  if (incidentType === 'plane-crash') {
    const lanes = details.planeLanesImpacted.trim() || 'unknown lanes'
    const size = details.planeSize.trim() || 'unknown size'
    const survivors = details.survivors === 'yes' ? 'survivors reported' : details.survivors === 'no' ? 'no survivors reported' : 'survivors unknown'
    return `${lanes} impacted, ${size} plane, ${survivors}, `
  }
  if (incidentType === 'downed-tree') {
    const lanes = details.treeLanesBlocked.trim() || 'unknown lanes'
    const size = details.treeSize.trim() || 'unknown size'
    const resources = details.treeResourcesNeeded.trim() || 'unknown'
    return `${lanes} blocked, ${size} tree, additional resources needed: ${resources}, `
  }
  if (incidentType === 'debris') {
    return `${yesNoPhrase(details.debrisHazardous, 'debris is hazardous', 'debris is not hazardous', 'debris hazard status unknown')}, ${yesNoPhrase(details.debrisManualRemoval, 'SSP can remove it manually', 'SSP cannot remove it manually', 'manual removal ability unknown')}, ${yesNoPhrase(details.debrisNeedsSlowRoll, 'VSP slow-roll needed', 'VSP slow-roll not needed', 'VSP slow-roll need unknown')}, ${yesNoPhrase(details.debrisHasLaneBlade, 'SSP has a lane blade', 'SSP does not have a lane blade', 'lane blade availability unknown')}, `
  }
  if (incidentType === 'car-fire') {
    return `${yesNoPhrase(details.carFireMotoristOut, 'motorist is out', 'motorist is not out', 'motorist status unknown')}, ${yesNoPhrase(details.carFireFullyEngulfed, 'vehicle is fully engulfed', 'vehicle is not fully engulfed', 'engulfment status unknown')}, ${yesNoPhrase(details.carFireIsEv, 'vehicle is an EV', 'vehicle is not an EV', 'EV status unknown')}, ${(details.carFireLanesBlocked.trim() || 'unknown lanes')} blocked, `
  }
  if (incidentType === 'tractor-trailer-fire') {
    const cargo = details.tractorTrailerCargo.trim() || 'unknown cargo'
    return `${yesNoPhrase(details.tractorDriverOut, 'driver is out', 'driver is not out', 'driver status unknown')}, trailer hauling ${cargo}, ${yesNoPhrase(details.tractorHazmat, 'HAZMAT confirmed', 'no HAZMAT reported', 'HAZMAT status unknown')}, ${yesNoPhrase(details.tractorFullyEngulfed, 'tractor trailer is fully engulfed', 'tractor trailer is not fully engulfed', 'engulfment status unknown')}, ${(details.tractorLanesBlocked.trim() || 'unknown lanes')} blocked, `
  }
  return ''
}

function yesNoPhrase(value: YesNoUnknown, yes: string, no: string, unknown: string): string {
  return value === 'yes' ? yes : value === 'no' ? no : unknown
}

function spokenHighway(highway: string): string {
  return /\d+[A-Za-z]?/.exec(highway)?.[0] ?? highway.trim()
}

function incidentDescription(incidentType: IncidentType, scenario: ScenarioType, travelLanes: number): string {
  const area = blockedArea(scenario, travelLanes)
  if (incidentType === 'disabled-vehicle') return `a disabled vehicle on ${area}`
  if (incidentType === 'blocking-disabled') return `a disabled vehicle blocking ${area}`
  if (incidentType === 'debris') return `debris blocking ${area}`
  if (incidentType === 'downed-tree') return `a downed tree blocking ${area}`
  if (incidentType === 'bridge-collapse') return `a bridge collapse blocking ${area}`
  if (incidentType === 'overhead-signage-collapse') return `an overhead signage collapse blocking ${area}`
  const incident = incidentType === 'car-fire'
    ? 'a car fire'
    : incidentType === 'tractor-trailer-fire'
      ? 'a tractor trailer fire'
      : incidentType === 'plane-crash'
        ? 'a plane crash'
        : incidentType === 'severe-crash'
          ? 'a severe crash'
          : 'a crash'
  return `${incident} blocking ${area}`
}

function blockedArea(scenario: ScenarioType, travelLanes: number): string {
  if (scenario === 'all-lanes') return 'all lanes'
  if (scenario === 'right-lane') return 'the right lane'
  if (scenario === 'left-lane') return 'the left lane'
  if (scenario === 'center-lane') return 'the center lane'
  if (scenario === 'two-right-lanes') {
    return travelLanes === 3 ? 'the right and center lanes' : 'two right lanes'
  }
  if (scenario === 'two-left-lanes') {
    return travelLanes === 3 ? 'the left and center lanes' : 'two left lanes'
  }
  if (scenario === 'shoulder') return 'the right shoulder'
  if (scenario === 'ramp-closure') return 'the ramp'
  return 'the travel lanes'
}