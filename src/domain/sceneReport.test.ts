import { describe, expect, it } from 'vitest'
import { agenciesOnScene, reportedHazards } from './sceneReport'
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
      .toEqual(['vsp', 'fire-rescue', 'tow', 'tree-removal'])
  })
})
