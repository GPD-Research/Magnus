import { describe, expect, it } from 'vitest'
import {
  MAX_SSP_TRUCKS,
  addSspTruck,
  createSspTrucks,
  updateTruckSignboard,
  type SspTruckState,
} from './signboard'

describe('SSP truck signboards', () => {
  it('creates one truck with Double Diamonds by default', () => {
    expect(createSspTrucks()).toEqual([
      expect.objectContaining({
        id: 'ssp-truck-1',
        label: 'SSP Truck 1',
        rotation: 0,
        assetType: 'ssp-truck',
        signboard: 'double-diamonds',
      }),
    ])
  })

  it('updates only the selected truck signboard', () => {
    const trucks = addSspTruck(createSspTrucks())
    const updated = updateTruckSignboard(trucks, 'ssp-truck-2', 'incident-ahead')

    expect(updated[0].signboard).toBe('double-diamonds')
    expect(updated[1].signboard).toBe('incident-ahead')
  })

  it('adds a lane blade variant with the same signboard behavior', () => {
    const trucks = addSspTruck(createSspTrucks(), 'lane-blade-truck')
    expect(trucks[1]).toMatchObject({ label: 'Lane Blade Truck 2', assetType: 'lane-blade-truck', rotation: 0 })
  })

  it('never creates more than five trucks', () => {
    const trucks = Array.from({ length: MAX_SSP_TRUCKS + 2 }).reduce<SspTruckState[]>(
      (current) => addSspTruck(current),
      createSspTrucks(),
    )

    expect(trucks).toHaveLength(MAX_SSP_TRUCKS)
    expect(addSspTruck(trucks)).toBe(trucks)
  })
})
