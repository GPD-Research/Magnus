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
export type AgencyGroup = 'vsp' | 'ems' | 'fire' | 'tow' | 'tree-removal'
export type ShoulderSide = 'left' | 'right'
/** What the SSP learns about the vehicles once on scene; drives the follow-up update to TOC. */
export type IncidentNature = 'unknown' | 'accident' | 'disabled'

export const INCIDENT_NATURE_OPTIONS: { value: IncidentNature; label: string }[] = [
  { value: 'unknown', label: 'Not yet determined' },
  { value: 'accident', label: 'Accident' },
  { value: 'disabled', label: 'Disabled vehicle' },
]

/** Who establishes the finding: the patroller after arrival (update) or TOC from the camera at dispatch. */
export type NatureSource = 'ssp-update' | 'toc-dispatch'

export const NATURE_SOURCE_OPTIONS: { value: NatureSource; label: string }[] = [
  { value: 'ssp-update', label: 'SSP reports it after arrival' },
  { value: 'toc-dispatch', label: 'TOC identifies it at dispatch' },
]

export function isNatureSource(value: unknown): value is NatureSource {
  return NATURE_SOURCE_OPTIONS.some((option) => option.value === value)
}

export type InjurySeverity = 'none' | 'minor' | 'major'
export const INJURY_OPTIONS: { value: InjurySeverity; label: string }[] = [
  { value: 'none', label: 'No injuries reported' },
  { value: 'minor', label: 'Minor injuries' },
  { value: 'major', label: 'Major injuries' },
]
export function isInjurySeverity(value: unknown): value is InjurySeverity {
  return INJURY_OPTIONS.some((option) => option.value === value)
}

export type ServiceRendered = 'none' | 'tire-change' | 'jump-start' | 'traffic-control' | 'added-coolant' | 'performed-push'
export const SERVICE_OPTIONS: { value: ServiceRendered; label: string; spoken: string }[] = [
  { value: 'none', label: 'No service rendered', spoken: '' },
  { value: 'tire-change', label: 'Tire change', spoken: 'I performed a tire change' },
  { value: 'jump-start', label: 'Jump start', spoken: 'I performed a jump start' },
  { value: 'traffic-control', label: 'Traffic control', spoken: 'I provided traffic control' },
  { value: 'added-coolant', label: 'Added coolant', spoken: 'I added coolant' },
  { value: 'performed-push', label: 'Performed push', spoken: 'I performed a push' },
]
export function isServiceRendered(value: unknown): value is ServiceRendered {
  return SERVICE_OPTIONS.some((option) => option.value === value)
}

export const US_STATES: { code: string; name: string }[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
  ['DE', 'Delaware'], ['DC', 'the District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }))
export const DEFAULT_TAG_STATE = 'VA'
export function stateName(code: string): string {
  return US_STATES.find((state) => state.code === code)?.name ?? code
}

export function isIncidentNature(value: unknown): value is IncidentNature {
  return INCIDENT_NATURE_OPTIONS.some((option) => option.value === value)
}

/** One object the SSP names on the radio and the lanes (0 = left) / shoulders its footprint covers. */
export interface SceneHazard {
  kind: 'vehicle' | 'debris' | 'tree' | 'other'
  noun: [singular: string, plural: string]
  lanes: number[]
  shoulders: ShoulderSide[]
}
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
  /** Free-text location spoken on the radio (e.g. "the on-ramp from eastbound Route 7 to I-495 southbound"). Overrides the structured fields when set. */
  location?: string
  scenario: ScenarioType
  travelLanes: number
  sspOnScene: boolean
  /** Only the SSP truck is left: no hazards, agencies or other equipment. Ends the script with "scene clear". */
  sceneEmpty?: boolean
  hazards: ReportedHazards
  /** Footprint-derived hazards; when present they replace `hazards`/`scenario` for the call-out wording. */
  sceneHazards?: SceneHazard[]
  incidentNature?: IncidentNature
  natureSource?: NatureSource
  injuries?: InjurySeverity
  service?: ServiceRendered
  /** Licence plate read off the vehicle; spoken in SSP-discovered call-outs only. */
  tagNumber?: string
  tagState?: string
  agencies: AgencyGroup[]
}

export interface CommunicationsState {
  phase: CommunicationsPhase
  agencies: AgencyGroup[]
  /** Nature already reported to TOC, so the update is sent once per change. */
  nature?: IncidentNature
  injuries?: InjurySeverity
  service?: ServiceRendered
}

export const INITIAL_COMMUNICATIONS_STATE: CommunicationsState = { phase: 'idle', agencies: [] }

export function normalizeCommunicationsState(value: unknown): CommunicationsState {
  if (!value || typeof value !== 'object') return INITIAL_COMMUNICATIONS_STATE
  const state = value as Partial<CommunicationsState>
  const phases: CommunicationsPhase[] = ['idle', 'dispatched', 'on-scene', 'cleared']
  const groups: AgencyGroup[] = ['vsp', 'ems', 'fire', 'tow', 'tree-removal']
  return {
    phase: phases.includes(state.phase!) ? state.phase! : 'idle',
    agencies: Array.isArray(state.agencies) ? state.agencies.filter((group): group is AgencyGroup => groups.includes(group)) : [],
    ...(isIncidentNature(state.nature) && state.nature !== 'unknown' ? { nature: state.nature } : {}),
    ...(isInjurySeverity(state.injuries) && state.injuries !== 'none' ? { injuries: state.injuries } : {}),
    ...(isServiceRendered(state.service) && state.service !== 'none' ? { service: state.service } : {}),
  }
}

export const AGENCY_ORDER: AgencyGroup[] = ['ems', 'fire', 'vsp', 'tow', 'tree-removal']

const AGENCY_PHRASES: Record<AgencyGroup, { name: string; arrived: string; departed: string }> = {
  ems: { name: 'EMS', arrived: 'EMS now on scene', departed: 'EMS has departed' },
  fire: { name: 'fire department', arrived: 'fire now on scene', departed: 'fire has departed' },
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
  const controller = controllerForScene(scene)
  const reportable = scene.sceneHazards ? scene.sceneHazards.length > 0 : hasReportableHazard(scene.hazards)
  const messages: RadioMessage[] = []
  const hail = (text: string): RadioMessage => ({ channel: 'SSP', text: `${unit} to ${controller}, ${text}.` })
  const copy: RadioMessage = { channel: 'TOC', text: 'Copy.' }

  if (state.phase === 'on-scene') {
    const service = serviceUpdate(state, scene)
    if (!scene.sspOnScene || scene.sceneEmpty) {
      if (service) messages.push(hail(service), copy)
      messages.push(hail("scene clear, I'm clear"), copy)
      return { state: { phase: 'cleared', agencies: [] }, messages }
    }
    const present = sortAgencies(scene.agencies)
    for (const group of AGENCY_ORDER) {
      const was = state.agencies.includes(group)
      const is = present.includes(group)
      if (is && !was) messages.push(hail(AGENCY_PHRASES[group].arrived), copy)
      if (was && !is) messages.push(hail(AGENCY_PHRASES[group].departed), copy)
    }
    messages.push(...natureExchange(state, scene, hail, present))
    if (service) messages.push(hail(service), copy)
    return { state: onSceneState(present, scene), messages }
  }

  if (!reportable) return { state, messages }

  if (scene.sspOnScene) {
    if (scene.mode === 'toc-dispatched' && state.phase !== 'dispatched') messages.push(...dispatchExchange(unit, controller, scene))
    const present = sortAgencies(scene.agencies)
    messages.push(...onSceneExchange(unit, controller, scene, state.phase === 'dispatched' || scene.mode === 'toc-dispatched'))
    messages.push(...natureExchange(state, scene, hail, present))
    return { state: onSceneState(present, scene), messages }
  }

  if (scene.mode === 'toc-dispatched' && state.phase === 'idle') {
    messages.push(...dispatchExchange(unit, controller, scene))
    return { state: { phase: 'dispatched', agencies: [], nature: tocKnownNature(scene) }, messages }
  }

  return { state, messages }
}

function dispatchExchange(unit: string, controller: string, scene: CommunicationsScene): RadioMessage[] {
  return [
    { channel: 'TOC', text: `${controller} to ${unit}?` },
    { channel: 'SSP', text: `${unit}.` },
    { channel: 'TOC', text: [`Please respond to ${dispatchPhrase(scene)} at ${locationPhrase(scene)}.`, alreadyOnScenePhrase(sortAgencies(scene.agencies))].filter(Boolean).join(' ') },
    { channel: 'SSP', text: 'Show me en route.' },
  ]
}

function onSceneExchange(unit: string, controller: string, scene: CommunicationsScene, afterDispatch = false): RadioMessage[] {
  const onShoulder = scene.sceneHazards ? blockedLanes(scene.sceneHazards).length === 0 : scene.scenario === 'shoulder'
  const present = sortAgencies(scene.agencies)
  const needsVsp = !onShoulder && !present.includes('vsp')
  const tag = !afterDispatch && scene.tagNumber?.trim() ? `, tag reads ${scene.tagNumber.trim().toUpperCase()} out of ${stateName(scene.tagState ?? DEFAULT_TAG_STATE)}` : ''
  const opening = afterDispatch ? 'Show me on scene at' : 'Show me out at'
  const report = [
    scene.sceneHazards
      ? `${opening} ${locationPhrase(scene)} ${scenePhrase(scene, 'ssp')}${tag}.`
      : `Show me on scene at ${locationPhrase(scene)} ${positionPhrase(scene.scenario, scene.travelLanes)} with ${incidentPhrase(scene.hazards)}${tag}.`,
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

function alreadyOnScenePhrase(agencies: AgencyGroup[]): string {
  if (agencies.length === 0) return ''
  return `${capitalize(joinList(agencies.map((group) => AGENCY_PHRASES[group].name)))} already on scene.`
}

function onSceneState(agencies: AgencyGroup[], scene: CommunicationsScene): CommunicationsState {
  return {
    phase: 'on-scene',
    agencies,
    nature: reportedNature(scene),
    ...(scene.injuries && scene.injuries !== 'none' ? { injuries: scene.injuries } : {}),
    ...(scene.service && scene.service !== 'none' ? { service: scene.service } : {}),
  }
}

/** Picks the TOC controller from the typed location when it names a route (and exit/mile marker), else from the structured request. */
export function controllerForScene(scene: Pick<CommunicationsScene, 'highway' | 'reference' | 'location'>): string {
  const text = scene.location?.trim() ?? ''
  const route = /\b(?:I-?\s?)?(66|495|395|95)\b/i.exec(text)?.[1]
  if (!route) return controllerFor(scene.highway, scene.reference)
  const marker = /\b(?:exit|mm|mile\s*marker)\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1]
  return controllerFor(route, marker ?? scene.reference)
}

function locationPhrase(scene: CommunicationsScene): string {
  const typed = scene.location?.trim().replace(/[.\s]+$/, '')
  if (typed) return typed
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
  return `${capitalize(joinList(agencies.map((group) => AGENCY_PHRASES[group].name)))} on scene.`
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const COUNT_WORDS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** "a car and a tractor trailer", "two cars", "debris" — vehicles first, in scene order. */
export function objectsPhrase(hazards: SceneHazard[]): string {
  const counts = new Map<string, { noun: SceneHazard['noun']; count: number }>()
  for (const hazard of hazards) {
    const entry = counts.get(hazard.noun[0]) ?? { noun: hazard.noun, count: 0 }
    entry.count += 1
    counts.set(hazard.noun[0], entry)
  }
  return joinList([...counts.values()].map(({ noun, count }) => {
    if (noun[0] === 'debris') return 'debris'
    if (count === 1) return `${/^[aeiou]/i.test(noun[0]) ? 'an' : 'a'} ${noun[0]}`
    return `${COUNT_WORDS[count] ?? String(count)} ${noun[1]}`
  }))
}

export function blockedLanes(hazards: SceneHazard[]): number[] {
  return [...new Set(hazards.flatMap((hazard) => hazard.lanes))].sort((first, second) => first - second)
}

function laneName(index: number, laneCount: number): string {
  if (laneCount === 1) return 'the'
  if (index === 0) return 'left'
  if (index === laneCount - 1) return 'right'
  if (laneCount === 3) return 'center'
  if (laneCount === 4) return index === 1 ? 'left center' : 'right center'
  if (laneCount === 5) return index === 1 ? 'left center' : index === 2 ? 'center' : 'right center'
  return `number ${index + 1}`
}

export function lanesPhrase(lanes: number[], laneCount: number): string {
  if (lanes.length >= laneCount) return 'all lanes'
  if (lanes.length === 1) return `the ${laneName(lanes[0], laneCount)} lane`
  return `the ${joinList(lanes.map((lane) => laneName(lane, laneCount)))} lanes`
}

/**
 * Where/what clause: hazards in a travel lane are "blocking the … lane(s)" (shoulders not mentioned,
 * except a downed tree also on a shoulder); shoulder-only hazards are "on the right shoulder with …".
 */
function scenePhrase(scene: CommunicationsScene, voice: 'ssp' | 'toc'): string {
  const hazards = scene.sceneHazards ?? []
  const objects = objectsPhrase(hazards)
  const lanes = blockedLanes(hazards)
  if (lanes.length === 0) {
    const side = shoulderSide(hazards)
    return voice === 'ssp' ? `on the ${side} shoulder with ${objects}` : `${objects} on the ${side} shoulder`
  }
  const treeShoulders = [...new Set(hazards.filter((hazard) => hazard.kind === 'tree').flatMap((hazard) => hazard.shoulders))]
  const shoulderTail = treeShoulders.length > 0 ? ` and the ${joinList(treeShoulders)} shoulder` : ''
  const blocking = `blocking ${lanesPhrase(lanes, scene.travelLanes)}${shoulderTail}`
  return voice === 'ssp' ? `with ${objects} ${blocking}` : `${objects} ${blocking}`
}

function shoulderSide(hazards: SceneHazard[]): ShoulderSide {
  return hazards.some((hazard) => hazard.shoulders.includes('right')) || !hazards.some((hazard) => hazard.shoulders.includes('left'))
    ? 'right'
    : 'left'
}

function tocKnownNature(scene: CommunicationsScene): IncidentNature | undefined {
  return scene.natureSource === 'toc-dispatch' ? reportedNature(scene) : undefined
}

/** TOC's dispatch wording: what it saw on camera, naming the finding only when TOC already has it. */
function dispatchPhrase(scene: CommunicationsScene): string {
  if (!scene.sceneHazards) return `${incidentPhrase(scene.hazards)} ${positionPhrase(scene.scenario, scene.travelLanes)}`
  const nature = tocKnownNature(scene)
  if (!nature) return scenePhrase(scene, 'toc')
  const hazards = scene.sceneHazards
  const lanes = blockedLanes(hazards)
  if (lanes.length === 0) {
    return nature === 'accident' ? `an accident on the ${shoulderSide(hazards)} shoulder` : `a disabled ${objectsPhrase(hazards).replace(/^an? /, '')} on the ${shoulderSide(hazards)} shoulder`
  }
  if (nature === 'accident') return 'a blocking accident'
  return `a disabled ${objectsPhrase(hazards).replace(/^an? /, '')} blocking ${lanesPhrase(lanes, scene.travelLanes)}`
}

function reportedNature(scene: CommunicationsScene): IncidentNature | undefined {
  const nature = scene.incidentNature ?? 'unknown'
  return nature === 'unknown' ? undefined : nature
}

/** Follow-up once the SSP has determined whether the vehicles crashed or are disabled. */
function natureUpdate(state: CommunicationsState, scene: CommunicationsScene): string | null {
  const nature = reportedNature(scene)
  const injuries = scene.injuries ?? 'none'
  if (!nature || (nature === state.nature && injuries === (state.injuries ?? 'none'))) return null
  const vehicles = scene.sceneHazards?.filter((hazard) => hazard.kind === 'vehicle').length ?? 1
  if (vehicles === 0) return null
  if (nature === 'accident') {
    const subject = vehicles === 1 ? 'vehicle was in a crash' : 'vehicles were in a crash'
    const withInjuries = injuries === 'none' ? subject : `${subject} with ${injuries} injuries`
    return scene.mode === 'toc-dispatched' && injuries !== 'none' && !scene.agencies.includes('fire') ? `${withInjuries}, send fire and rescue` : withInjuries
  }
  if (nature === state.nature) return null
  return vehicles === 1 ? 'vehicle is disabled' : 'vehicles are disabled'
}

/** Nature update plus TOC's answer: on an SSP-discovered crash with injuries TOC dispatches fire and rescue. */
function natureExchange(state: CommunicationsState, scene: CommunicationsScene, hail: (text: string) => RadioMessage, present: AgencyGroup[]): RadioMessage[] {
  const update = natureUpdate(state, scene)
  if (!update) return []
  const injured = scene.incidentNature === 'accident' && (scene.injuries ?? 'none') !== 'none' && !present.includes('fire')
  const reply = injured ? (scene.mode === 'toc-dispatched' ? 'Copy. Fire and rescue en route.' : 'Copy. Sending fire and rescue.') : 'Copy.'
  return [hail(update), { channel: 'TOC', text: reply }]
}

/** "I performed a tire change" once the service dropdown changes; usually right before scene clear. */
function serviceUpdate(state: CommunicationsState, scene: CommunicationsScene): string | null {
  const service = scene.service ?? 'none'
  if (service === 'none' || service === state.service) return null
  return SERVICE_OPTIONS.find((option) => option.value === service)?.spoken ?? null
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
