import { describe, expect, it } from 'vitest'
import { agenciesOnScene, reportedHazards, sceneHazards } from './sceneReport'
import type { DeployedEquipment } from './equipmentCatalog'

const item = (definitionId: string, hazardState?: DeployedEquipment['hazardState']): DeployedEquipment =>
  ({ id: `${definitionId}-${hazardState ?? ''}`, definitionId, x: 0, y: 0, rotation: 0, hazardState })

describe('scene report', () => {
  it('counts only vehicles whose state is reportable', () => {
    expect(reportedHazards([item('sedan-grey'), item('tractor-trailer')])).toMatchObject({ crashedVehicles: 0, disabledVehicles: 0 })
    expect(reportedHazards([item('sedan-grey', 'crashed'), item('pickup-black', 'crashed'), item('sedan-black', 'disabled')]))
      .toMatchObject({ crashedVehicles: 2, disabledVehicles: 1 })
    expect(reportedHazards([item('vehicle-fire'), item('tractor-trailer', 'fire'), item('jackknife-left')]))
      .toMatchObject({ vehicleFires: 1, tractorTrailerFires: 1, crashedVehicles: 1 })
    expect(reportedHazards([item('debris-red'), item('deer'), item('downed-tree')])).toMatchObject({ debris: 2, downedTrees: 1 })
  })

  it('groups external assets by agency', () => {
    expect(agenciesOnScene([item('vsp-cruiser'), item('vsp-cruiser'), item('ems-ambulance'), item('heavy-tow-truck'), item('tree-removal-truck'), item('barrel')]))
      .toEqual(['vsp', 'ems', 'tow', 'tree-removal'])
  })
})

describe('sceneHazards', () => {
  const layout = { laneCount: 3, generic: true, scenario: 'right-lane' as const }
  const placed = (definitionId: string, x: number, rotation = 0, hazardState?: DeployedEquipment['hazardState']): DeployedEquipment =>
    ({ id: `${definitionId}-${x}-${rotation}`, definitionId, x, y: 300, rotation, hazardState })

  it('ignores straight traffic in a lane but reports rotated, shoulder, and flagged vehicles', () => {
    expect(sceneHazards([placed('sedan-grey', 48)], layout)).toEqual([])
    expect(sceneHazards([placed('sedan-grey', 48, 10)], layout)).toMatchObject([{ kind: 'vehicle', lanes: [2], shoulders: [] }])
    expect(sceneHazards([placed('sedan-grey', 60)], layout)).toMatchObject([{ lanes: [], shoulders: ['right'] }])
    expect(sceneHazards([placed('sedan-grey', 48, 0, 'disabled')], layout)).toMatchObject([{ lanes: [2] }])
  })

  it('measures the rotated footprint across lanes and shoulders', () => {
    // 16 ft sedan turned sideways straddling the right skip line covers the center and right lanes.
    expect(sceneHazards([placed('sedan-grey', 42, 90)], layout)).toMatchObject([{ lanes: [1, 2], shoulders: [] }])
    // Across the right fog line: right lane plus shoulder; the call-out drops the shoulder.
    expect(sceneHazards([placed('sedan-grey', 54, 90)], layout)).toMatchObject([{ lanes: [2], shoulders: ['right'] }])
    expect(sceneHazards([placed('sedan-grey', 18, 90)], layout)).toMatchObject([{ lanes: [0], shoulders: ['left'] }])
    expect(sceneHazards([placed('downed-tree', 56)], layout)).toMatchObject([{ kind: 'tree', lanes: [2], shoulders: ['right'] }])
  })

  it('falls back to the closure scenario on map-pulled roadways', () => {
    expect(sceneHazards([placed('sedan-grey', 0, 0, 'crashed')], { laneCount: 3, generic: false, scenario: 'two-right-lanes' }))
      .toMatchObject([{ lanes: [1, 2] }])
    expect(sceneHazards([placed('sedan-grey', 0)], { laneCount: 3, generic: false, scenario: 'shoulder' }))
      .toMatchObject([{ lanes: [], shoulders: ['right'] }])
  })
})
