export type SignboardMessage =
  | 'left-arrow'
  | 'right-arrow'
  | 'split-arrow'
  | 'ramp-blocked'
  | 'slow-roll-do-not-pass'
  | 'double-diamonds'
  | 'incident-ahead'
  | 'high-water'

export interface SspTruckState {
  id: string
  label: string
  x: number
  y: number
  signboard: SignboardMessage
}

export const MAX_SSP_TRUCKS = 5

export const SIGNBOARD_OPTIONS: { value: SignboardMessage; label: string }[] = [
  { value: 'left-arrow', label: 'Left arrow' },
  { value: 'right-arrow', label: 'Right arrow' },
  { value: 'split-arrow', label: 'Split arrow' },
  { value: 'ramp-blocked', label: 'Ramp Blocked' },
  { value: 'slow-roll-do-not-pass', label: 'Slow Roll - Do Not Pass' },
  { value: 'double-diamonds', label: 'Double Diamonds' },
  { value: 'incident-ahead', label: 'Incident Ahead' },
  { value: 'high-water', label: 'High Water' },
]

const truckPositions = [
  { x: 48, y: 260 },
  { x: 36, y: 210 },
  { x: 24, y: 160 },
  { x: 48, y: 110 },
  { x: 36, y: 60 },
]

export function createSspTrucks(): SspTruckState[] {
  return [createSspTruck(0)]
}

export function addSspTruck(trucks: SspTruckState[]): SspTruckState[] {
  if (trucks.length >= MAX_SSP_TRUCKS) return trucks
  return [...trucks, createSspTruck(trucks.length)]
}

export function updateTruckSignboard(
  trucks: SspTruckState[],
  truckId: string,
  signboard: SignboardMessage,
): SspTruckState[] {
  return trucks.map((truck) => truck.id === truckId ? { ...truck, signboard } : truck)
}

export function signboardLabel(message: SignboardMessage): string {
  return SIGNBOARD_OPTIONS.find((option) => option.value === message)?.label ?? message
}

function createSspTruck(index: number): SspTruckState {
  const sequence = index + 1
  return {
    id: `ssp-truck-${sequence}`,
    label: `SSP Truck ${sequence}`,
    ...truckPositions[index],
    signboard: 'double-diamonds',
  }
}
