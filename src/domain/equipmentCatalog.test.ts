import { describe, expect, it } from 'vitest'
import { canDeploy, deployedCount, deploymentLimit, equipmentDefinition, sceneCounts, type DeployedEquipment } from './equipmentCatalog'

const deploy = (definitionId: string, index: number): DeployedEquipment => ({
  id: `${definitionId}-${index}`,
  definitionId,
  x: 20,
  y: 200,
  rotation: 0,
})

describe('equipment catalog', () => {
  it('scales truck equipment inventory from active SSP trucks', () => {
    expect(deploymentLimit(equipmentDefinition('cone'), [], 2)).toBe(40)
    expect(deploymentLimit(equipmentDefinition('flare'), [], 2)).toBe(160)
    expect(deploymentLimit(equipmentDefinition('emergency-sign'), [], 2)).toBe(4)
    expect(deploymentLimit(equipmentDefinition('ssp-patroller'), [], 2)).toBe(2)
  })

  it('caps VSP cruisers and officers at five', () => {
    const cruisers = Array.from({ length: 5 }, (_, index) => deploy('vsp-cruiser', index))
    expect(canDeploy('vsp-cruiser', cruisers, 1)).toBe(false)
    expect(deploymentLimit(equipmentDefinition('vsp-officer'), cruisers, 1)).toBe(5)
  })

  it('derives compact and command cone inventory from response vehicles', () => {
    const responseVehicles = [deploy('ladder-truck', 1), deploy('pump-truck', 1), deploy('fire-chief', 1), deploy('incident-command', 1)]

    expect(deploymentLimit(equipmentDefinition('compact-cone'), responseVehicles, 1)).toBe(30)
    expect(deploymentLimit(equipmentDefinition('command-cone'), responseVehicles, 1)).toBe(10)
  })

  it('counts deployed vehicles, cones, personnel, hazards, and existing scene items', () => {
    const deployed = [deploy('ems-ambulance', 1), deploy('compact-cone', 1), deploy('vsp-officer', 1), deploy('deer', 1)]
    expect(sceneCounts(deployed, 2, 11)).toEqual({ vehicles: 3, cones: 12, personnel: 1, hazards: 1 })
    expect(deployedCount('compact-cone', deployed, { 'compact-cone': 11 })).toBe(12)
  })
})
