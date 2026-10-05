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

export type CommunicationsMode = 'ssp-discovered' | 'toc-dispatched'
export type VehicleHazardState = 'traffic' | 'crashed' | 'disabled' | 'fire'
export type AgencyGroup = 'vsp' | 'fire-rescue' | 'tow' | 'tree-removal'
export type CommunicationsPhase = 'idle' | 'dispatched' | 'on-scene' | 'cleared'

export const DEFAULT_SSP_UNIT = 'SSP970'

export const VEHICLE_HAZARD_STATE_OPTIONS: { value: VehicleHazardState; label: string }[] = [
  { value: 'traffic', label: 'Traffic (not reported)' },
  { value: 'crashed', label: 'Crashed' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'fire', label: 'Fire' },
]

export function isVehicleHazardState(value: unknown): value is VehicleHazardState {
  return VEHICLE_HAZARD_STATE_OPTIONS.some((option) => option.value === value)
}

export interface TocSector {
  patrolRoute: string
  route: string
  fromExit: number
  toExit: number
  controller: string
}

/** NRO patrol routes and the TOC controller that works each one; `fromExit` is the north/east end. */
export const TOC_SECTORS: TocSector[] = [
  { patrolRoute: '66-1', route: '66', fromExit: 73, toExit: 62, controller: '66 Control' },
  { patrolRoute: '66-2', route: '66', fromExit: 62, toExit: 52, controller: '66 Control' },
  { patrolRoute: '66-3', route: '66', fromExit: 52, toExit: 40, controller: '66 Control' },
  { patrolRoute: '495-1', route: '495', fromExit: 177, toExit: 54, controller: '495 Control' },
  { patrolRoute: '495-2', route: '495', fromExit: 44, toExit: 54, controller: '495 Control' },
  { patrolRoute: '395-1', route: '395', fromExit: 10, toExit: 2, controller: '395 Control' },
  { patrolRoute: '95-1', route: '95', fromExit: 177, toExit: 160, controller: '95 Control' },
  { patrolRoute: '95-2', route: '95', fromExit: 160, toExit: 148, controller: '95 Control' },
  { patrolRoute: '95-3', route: '95', fromExit: 148, toExit: 133, controller: 'Stafford Control' },
  { patrolRoute: '95-4', route: '95', fromExit: 133, toExit: 118, controller: 'Stafford Control' },
]

export function controllerFor(highway: string, reference: string): string {
  const route = spokenHighway(highway)
  const sectors = TOC_SECTORS.filter((sector) => sector.route === route)
  if (sectors.length === 0) return `${route} Control`
  const milepost = Number.parseFloat(reference.trim())
  if (Number.isNaN(milepost)) return sectors[0].controller
  // Sector boundaries are inclusive at the top: I-95 at or north of exit 148 stays with 95 Control.
  const match = sectors.find((sector) => milepost <= sector.fromExit && milepost >= sector.toExit)
  return (match ?? sectors[sectors.length - 1]).controller
}

export interface ReportedHazards {
  crashedVehicles: number
  disabledVehicles: number
  vehicleFires: number
  tractorTrailerFires: number
  debris: number
  downedTrees: number
}

export const NO_HAZARDS: ReportedHazards = {
  crashedVehicles: 0, disabledVehicles: 0, vehicleFires: 0, tractorTrailerFires: 0, debris: 0, downedTrees: 0,
}

export function hasReportableHazard(hazards: ReportedHazards): boolean {
  return Object.values(hazards).some((count) => count > 0)
}

export interface CommunicationsScene {
  unit: string
  mode: CommunicationsMode
  highway: string
  direction: CommunicationDirection
  referenceType: RoadReferenceType
  reference: string
  scenario: ScenarioType
  travelLanes: number
  sspOnScene: boolean
  hazards: ReportedHazards
  agencies: AgencyGroup[]
}

export interface CommunicationsState {
  phase: CommunicationsPhase
  agencies: AgencyGroup[]
}

export const INITIAL_COMMUNICATIONS_STATE: CommunicationsState = { phase: 'idle', agencies: [] }

export function normalizeCommunicationsState(value: unknown): CommunicationsState {
  if (!value || typeof value !== 'object') return INITIAL_COMMUNICATIONS_STATE
  const state = value as Partial<CommunicationsState>
  const phases: CommunicationsPhase[] = ['idle', 'dispatched', 'on-scene', 'cleared']
  const groups: AgencyGroup[] = ['vsp', 'fire-rescue', 'tow', 'tree-removal']
  return {
    phase: phases.includes(state.phase!) ? state.phase! : 'idle',
    agencies: Array.isArray(state.agencies) ? state.agencies.filter((group): group is AgencyGroup => groups.includes(group)) : [],
  }
}

const AGENCY_ORDER: AgencyGroup[] = ['fire-rescue', 'vsp', 'tow', 'tree-removal']

const AGENCY_PHRASES: Record<AgencyGroup, { name: string; arrived: string; departed: string }> = {
  'fire-rescue': { name: 'fire and rescue', arrived: 'fire and rescue now on scene', departed: 'fire and rescue have cleared' },
  vsp: { name: 'VSP', arrived: 'VSP now on scene', departed: 'VSP has departed the scene' },
  tow: { name: 'tow', arrived: 'tow is on scene', departed: 'tow has cleared' },
  'tree-removal': { name: 'tree removal workers', arrived: 'tree removal workers on scene', departed: 'tree removal has cleared' },
}

/**
 * Advances the radio conversation from the previous state to the current scene, emitting only the
 * exchanges the scene change warrants (initial call-out, first-arrival/last-departure agency
 * updates, "show me clear"). Pure: the caller stores the returned state alongside the transcript.
 */
export function advanceCommunications(
  state: CommunicationsState,
  scene: CommunicationsScene,
): { state: CommunicationsState; messages: RadioMessage[] } {
  const unit = scene.unit.trim() || DEFAULT_SSP_UNIT
  const controller = controllerFor(scene.highway, scene.reference)
  const reportable = hasReportableHazard(scene.hazards)
  const messages: RadioMessage[] = []
  const hail = (text: string): RadioMessage => ({ channel: 'SSP', text: `${unit} to ${controller}, ${text}.` })
  const copy: RadioMessage = { channel: 'TOC', text: 'Copy.' }

  if (state.phase === 'on-scene') {
    if (!scene.sspOnScene) {
      messages.push(hail('show me clear'), copy)
      return { state: { phase: 'cleared', agencies: [] }, messages }
    }
    const present = sortAgencies(scene.agencies)
    for (const group of AGENCY_ORDER) {
      const was = state.agencies.includes(group)
      const is = present.includes(group)
      if (is && !was) messages.push(hail(AGENCY_PHRASES[group].arrived), copy)
      if (was && !is) messages.push(hail(AGENCY_PHRASES[group].departed), copy)
    }
    return { state: { phase: 'on-scene', agencies: present }, messages }
  }

  if (!reportable) return { state, messages }

  if (scene.sspOnScene) {
    if (scene.mode === 'toc-dispatched' && state.phase !== 'dispatched') messages.push(...dispatchExchange(unit, controller, scene))
    messages.push(...onSceneExchange(unit, controller, scene))
    return { state: { phase: 'on-scene', agencies: sortAgencies(scene.agencies) }, messages }
  }

  if (scene.mode === 'toc-dispatched' && state.phase === 'idle') {
    messages.push(...dispatchExchange(unit, controller, scene))
    return { state: { phase: 'dispatched', agencies: [] }, messages }
  }

  return { state, messages }
}

function dispatchExchange(unit: string, controller: string, scene: CommunicationsScene): RadioMessage[] {
  return [
    { channel: 'TOC', text: `${controller} to ${unit}?` },
    { channel: 'SSP', text: `${unit}.` },
    { channel: 'TOC', text: `I show ${incidentPhrase(scene.hazards)} ${positionPhrase(scene.scenario, scene.travelLanes)} at ${locationPhrase(scene)}.` },
    { channel: 'SSP', text: 'Show me en route.' },
  ]
}

function onSceneExchange(unit: string, controller: string, scene: CommunicationsScene): RadioMessage[] {
  const onShoulder = scene.scenario === 'shoulder'
  const present = sortAgencies(scene.agencies)
  const needsVsp = !onShoulder && !present.includes('vsp')
  const report = [
    `Show me on scene at ${locationPhrase(scene)} ${positionPhrase(scene.scenario, scene.travelLanes)} with ${incidentPhrase(scene.hazards)}.`,
    agenciesPhrase(present),
    needsVsp ? 'Send VSP.' : '',
  ].filter(Boolean).join(' ')
  return [
    { channel: 'SSP', text: `${unit} to ${controller}?` },
    { channel: 'TOC', text: `${unit}, go ahead.` },
    { channel: 'SSP', text: report },
    { channel: 'TOC', text: needsVsp ? 'Copy. VSP en route.' : 'Copy.' },
  ]
}

function locationPhrase(scene: CommunicationsScene): string {
  const reference = scene.reference.trim()
  const where = scene.referenceType === 'exit' ? `exit ${reference}` : `mile marker ${reference}`
  const area = scene.scenario === 'ramp-closure' ? 'on the ramp' : 'in the main lanes'
  return `${scene.direction} ${where} ${area}`
}

function positionPhrase(scenario: ScenarioType, travelLanes: number): string {
  if (scenario === 'shoulder') return 'on the right shoulder'
  return `blocking ${blockedArea(scenario, travelLanes)}`
}

export function incidentPhrase(hazards: ReportedHazards): string {
  const parts: string[] = []
  if (hazards.crashedVehicles > 0) {
    parts.push(hazards.crashedVehicles === 1 ? 'an accident' : `an accident involving ${hazards.crashedVehicles} vehicles`)
  }
  if (hazards.disabledVehicles > 0) parts.push(hazards.disabledVehicles === 1 ? 'a disabled vehicle' : `${hazards.disabledVehicles} disabled vehicles`)
  if (hazards.tractorTrailerFires > 0) parts.push('a tractor-trailer fire')
  if (hazards.vehicleFires > 0) parts.push('a vehicle fire')
  if (hazards.debris > 0) parts.push('debris')
  if (hazards.downedTrees > 0) parts.push('a downed tree')
  if (parts.length === 0) return 'an incident'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function agenciesPhrase(agencies: AgencyGroup[]): string {
  if (agencies.length === 0) return "I'll advise."
  const names = agencies.map((group) => AGENCY_PHRASES[group].name)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} plus ${names[names.length - 1]}`
  return `${capitalize(list)} already on scene.`
}

function sortAgencies(agencies: AgencyGroup[]): AgencyGroup[] {
  return AGENCY_ORDER.filter((group) => agencies.includes(group))
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function spokenHighway(highway: string): string {
  return /\d+[A-Za-z]?/.exec(highway)?.[0] ?? highway.trim()
}

function blockedArea(scenario: ScenarioType, travelLanes: number): string {
  if (scenario === 'all-lanes') return 'all lanes'
  if (scenario === 'right-lane') return 'the right lane'
  if (scenario === 'left-lane') return 'the left lane'
  if (scenario === 'center-lane') return 'the center lane'
  if (scenario === 'two-right-lanes') {
    return travelLanes === 3 ? 'the right and center lanes' : 'the two right lanes'
  }
  if (scenario === 'two-left-lanes') {
    return travelLanes === 3 ? 'the left and center lanes' : 'the two left lanes'
  }
  if (scenario === 'ramp-closure') return 'the ramp'
  return 'the travel lanes'
}
