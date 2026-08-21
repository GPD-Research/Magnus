export type ToolkitCategory = 'asset' | 'hazard'
export type SceneCountClass = 'vehicle' | 'cone' | 'personnel' | 'equipment' | 'hazard'

export type EquipmentGlyph =
  | 'cone' | 'flare' | 'diamond-sign' | 'person' | 'ssp-truck' | 'cruiser' | 'ambulance'
  | 'ladder-truck' | 'pump-truck' | 'pickup' | 'tool' | 'suv' | 'sedan'
  | 'tractor-trailer' | 'jackknife' | 'tractor' | 'bus' | 'trailer'
  | 'car-hauler' | 'debris' | 'deer' | 'airplane' | 'helipad'

export interface EquipmentDefinition {
  id: string
  label: string
  category: ToolkitCategory
  countClass: SceneCountClass
  glyph: EquipmentGlyph
  color: string
  width: number
  length: number
  limit?: number
  capacity?: { per: 'ssp-truck' | 'vsp-cruiser' | 'fire-response' | 'incident-command'; quantity: number }
}

export interface DeployedEquipment {
  id: string
  definitionId: string
  x: number
  y: number
  rotation: number
}

// Add new scene items here. Existing glyphs need no component changes; genuinely
// new silhouettes require one additional case in SceneEquipmentGlyph.
export const EQUIPMENT_CATALOG: EquipmentDefinition[] = [
  { id: 'ssp-truck', label: 'SSP truck', category: 'asset', countClass: 'vehicle', glyph: 'ssp-truck', color: '#eef1ed', width: 8.5, length: 24, limit: 5 },
  { id: 'cone', label: 'Full-size cone', category: 'asset', countClass: 'cone', glyph: 'cone', color: '#ed6a24', width: 3, length: 3, capacity: { per: 'ssp-truck', quantity: 20 } },
  { id: 'flare', label: 'Road flare', category: 'asset', countClass: 'equipment', glyph: 'flare', color: '#e24631', width: 2, length: 2, capacity: { per: 'ssp-truck', quantity: 80 } },
  { id: 'emergency-sign', label: 'Emergency Scene Ahead sign', category: 'asset', countClass: 'equipment', glyph: 'diamond-sign', color: '#ed5ca8', width: 6, length: 6, capacity: { per: 'ssp-truck', quantity: 2 } },
  { id: 'ssp-patroller', label: 'SSP patroller', category: 'asset', countClass: 'personnel', glyph: 'person', color: '#e7d62e', width: 3, length: 3, capacity: { per: 'ssp-truck', quantity: 1 } },
  { id: 'vsp-cruiser', label: 'VSP cruiser', category: 'asset', countClass: 'vehicle', glyph: 'cruiser', color: '#333b42', width: 8, length: 18, limit: 5 },
  { id: 'vsp-officer', label: 'VSP officer', category: 'asset', countClass: 'personnel', glyph: 'person', color: '#777b7e', width: 3, length: 3, capacity: { per: 'vsp-cruiser', quantity: 1 } },
  { id: 'ems-ambulance', label: 'EMS ambulance', category: 'asset', countClass: 'vehicle', glyph: 'ambulance', color: '#f2f3ef', width: 9, length: 24 },
  { id: 'ladder-truck', label: 'Fire & rescue ladder truck', category: 'asset', countClass: 'vehicle', glyph: 'ladder-truck', color: '#c83b31', width: 10, length: 42 },
  { id: 'pump-truck', label: 'Fire & rescue pump truck', category: 'asset', countClass: 'vehicle', glyph: 'pump-truck', color: '#c83b31', width: 10, length: 30 },
  { id: 'fire-chief', label: 'Fire chief pickup', category: 'asset', countClass: 'vehicle', glyph: 'pickup', color: '#c83b31', width: 8, length: 20 },
  { id: 'hurst', label: 'Hurst rescue tool', category: 'asset', countClass: 'equipment', glyph: 'tool', color: '#e8c62f', width: 4, length: 4 },
  { id: 'compact-cone', label: 'Compact cone', category: 'asset', countClass: 'cone', glyph: 'cone', color: '#ed6a24', width: 2, length: 2, capacity: { per: 'fire-response', quantity: 10 } },
  { id: 'incident-command', label: 'Incident commander SUV', category: 'asset', countClass: 'vehicle', glyph: 'suv', color: '#f3f4ef', width: 8, length: 20, limit: 2 },
  { id: 'command-cone', label: 'Incident command cone', category: 'asset', countClass: 'cone', glyph: 'cone', color: '#ed6a24', width: 3, length: 3, capacity: { per: 'incident-command', quantity: 10 } },
  { id: 'sedan-green', label: 'Green sedan', category: 'hazard', countClass: 'hazard', glyph: 'sedan', color: '#477b58', width: 7, length: 16 },
  { id: 'sedan-grey', label: 'Grey sedan', category: 'hazard', countClass: 'hazard', glyph: 'sedan', color: '#858c8d', width: 7, length: 16 },
  { id: 'sedan-black', label: 'Black sedan', category: 'hazard', countClass: 'hazard', glyph: 'sedan', color: '#242827', width: 7, length: 16 },
  { id: 'pickup-green', label: 'Green pickup', category: 'hazard', countClass: 'hazard', glyph: 'pickup', color: '#477b58', width: 8, length: 19 },
  { id: 'pickup-grey', label: 'Grey pickup', category: 'hazard', countClass: 'hazard', glyph: 'pickup', color: '#858c8d', width: 8, length: 19 },
  { id: 'pickup-black', label: 'Black pickup', category: 'hazard', countClass: 'hazard', glyph: 'pickup', color: '#242827', width: 8, length: 19 },
  { id: 'tractor-trailer', label: 'Tractor trailer', category: 'hazard', countClass: 'hazard', glyph: 'tractor-trailer', color: '#d8dcda', width: 9, length: 55 },
  { id: 'jackknife-left', label: 'Tractor trailer - jackknife left', category: 'hazard', countClass: 'hazard', glyph: 'jackknife', color: '#d8dcda', width: 38, length: 38 },
  { id: 'tractor-purple', label: 'Purple tractor without trailer', category: 'hazard', countClass: 'hazard', glyph: 'tractor', color: '#724a82', width: 9, length: 18 },
  { id: 'school-bus', label: 'School bus', category: 'hazard', countClass: 'hazard', glyph: 'bus', color: '#e6bb25', width: 9, length: 36 },
  { id: 'tour-bus', label: 'White tour bus', category: 'hazard', countClass: 'hazard', glyph: 'bus', color: '#f1f2ee', width: 9, length: 42 },
  { id: 'car-hauler-trailer', label: 'Disconnected car hauler', category: 'hazard', countClass: 'hazard', glyph: 'trailer', color: '#777f7d', width: 9, length: 34 },
  { id: 'fifth-wheel-hauler', label: 'Pickup with three-car hauler', category: 'hazard', countClass: 'hazard', glyph: 'car-hauler', color: '#687473', width: 9, length: 48 },
  { id: 'debris-grey', label: 'Grey debris', category: 'hazard', countClass: 'hazard', glyph: 'debris', color: '#b3b9b7', width: 8, length: 8 },
  { id: 'debris-red', label: 'Red debris', category: 'hazard', countClass: 'hazard', glyph: 'debris', color: '#c94b41', width: 8, length: 8 },
  { id: 'deer', label: 'Deer debris', category: 'hazard', countClass: 'hazard', glyph: 'deer', color: '#8a674b', width: 6, length: 9 },
  { id: 'airplane', label: 'Damaged single-prop airplane', category: 'hazard', countClass: 'hazard', glyph: 'airplane', color: '#d9dddb', width: 34, length: 28 },
  { id: 'helicopter-zone', label: 'Helicopter landing zone', category: 'hazard', countClass: 'hazard', glyph: 'helipad', color: '#d24035', width: 36, length: 36 },
]

export const equipmentDefinition = (id: string): EquipmentDefinition => {
  const definition = EQUIPMENT_CATALOG.find((item) => item.id === id)
  if (!definition) throw new Error(`Unknown equipment definition: ${id}`)
  return definition
}

export function deploymentLimit(definition: EquipmentDefinition, deployed: DeployedEquipment[], sspTruckCount: number): number {
  if (definition.limit !== undefined) return definition.limit
  if (!definition.capacity) return Number.POSITIVE_INFINITY
  const sourceCounts = {
    'ssp-truck': sspTruckCount + deployed.filter((item) => item.definitionId === 'ssp-truck').length,
    'vsp-cruiser': deployed.filter((item) => item.definitionId === 'vsp-cruiser').length,
    'fire-response': deployed.filter((item) => ['ladder-truck', 'pump-truck', 'fire-chief'].includes(item.definitionId)).length,
    'incident-command': deployed.filter((item) => item.definitionId === 'incident-command').length,
  }
  return sourceCounts[definition.capacity.per] * definition.capacity.quantity
}

export function canDeploy(
  definitionId: string,
  deployed: DeployedEquipment[],
  sspTruckCount: number,
  baselineCounts: Partial<Record<string, number>> = {},
): boolean {
  const definition = equipmentDefinition(definitionId)
  const count = (baselineCounts[definitionId] ?? 0) + deployed.filter((item) => item.definitionId === definitionId).length
  return count < deploymentLimit(definition, deployed, sspTruckCount)
}

export function sceneCounts(deployed: DeployedEquipment[], sspTruckCount: number, sopConeCount: number) {
  return deployed.reduce((counts, item) => {
    const countClass = equipmentDefinition(item.definitionId).countClass
    if (countClass === 'vehicle') counts.vehicles += 1
    if (countClass === 'cone') counts.cones += 1
    if (countClass === 'personnel') counts.personnel += 1
    if (countClass === 'hazard') counts.hazards += 1
    return counts
  }, { vehicles: sspTruckCount, cones: sopConeCount, personnel: 0, hazards: 0 })
}

export function deployedCount(definitionId: string, deployed: DeployedEquipment[], baselineCounts: Partial<Record<string, number>> = {}): number {
  return (baselineCounts[definitionId] ?? 0) + deployed.filter((item) => item.definitionId === definitionId).length
}
