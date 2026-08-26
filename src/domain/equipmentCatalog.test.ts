import { describe, expect, it } from 'vitest'
import { EQUIPMENT_CATALOG, TOOLKIT_CATEGORIES, canDeploy, deployedCount, deploymentLimit, equipmentDefinition, isEquipmentRotatable, sceneCounts, type DeployedEquipment } from './equipmentCatalog'

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
    expect(deploymentLimit(equipmentDefinition('gas-can'), [], 2)).toBe(6)
    expect(deploymentLimit(equipmentDefinition('floor-jack'), [], 2)).toBe(2)
    expect(deploymentLimit(equipmentDefinition('tool-bag'), [], 2)).toBe(2)
    expect(deploymentLimit(equipmentDefinition('portable-compressor'), [], 2)).toBe(2)
    expect(deploymentLimit(equipmentDefinition('pi-lit-flare'), [], 2)).toBe(20)
  })

  it('distinguishes electronic PI-Lit flares from combustible road flares', () => {
    expect(equipmentDefinition('pi-lit-flare')).toMatchObject({ glyph: 'flare', width: 2, length: 2, tooltip: 'electronic' })
    expect(equipmentDefinition('flare')).toMatchObject({ glyph: 'flare', width: 1, length: 1, tooltip: 'combustible' })
  })

  it('organizes the scene catalog into the four planned categories', () => {
    expect(TOOLKIT_CATEGORIES.map(({ label }) => label)).toEqual(['SSP Assets', 'External Assets', 'Hazards', 'Incidentals'])
    expect(equipmentDefinition('ssp-truck').category).toBe('ssp-asset')
    expect(equipmentDefinition('lane-blade-truck')).toMatchObject({ category: 'ssp-asset', glyph: 'lane-blade-truck' })
    expect(equipmentDefinition('ems-ambulance').category).toBe('external-asset')
    expect(equipmentDefinition('vehicle-fire').category).toBe('hazard')
    expect(equipmentDefinition('crash-debris-area')).toMatchObject({ category: 'incidental', resizable: true })
    expect(new Set(EQUIPMENT_CATALOG.map(({ category }) => category))).toEqual(new Set(TOOLKIT_CATEGORIES.map(({ id }) => id)))
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

  it('includes vehicle fire and hazmat tanker hazards', () => {
    expect(equipmentDefinition('vehicle-fire').glyph).toBe('vehicle-fire')
    expect(equipmentDefinition('hazmat-tanker').glyph).toBe('tanker')
    expect(sceneCounts([deploy('vehicle-fire', 1), deploy('hazmat-tanker', 1)], 0, 0).hazards).toBe(2)
  })

  it('includes a rotatable twenty-foot downed tree hazard', () => {
    expect(equipmentDefinition('downed-tree')).toMatchObject({
      category: 'hazard',
      countClass: 'hazard',
      glyph: 'downed-tree',
      length: 20,
      rotatable: true,
    })
    expect(sceneCounts([deploy('downed-tree', 1)], 0, 0).hazards).toBe(1)
  })

  it('includes towing, TMA, barrel, motorcycle, and injury scene items', () => {
    const coneTruck = [deploy('tma-cone-truck', 1)]

    expect(equipmentDefinition('tow-truck').glyph).toBe('tow-truck')
    expect(equipmentDefinition('heavy-tow-truck').rotatable).toBe(true)
    expect(equipmentDefinition('tma-crash-truck').glyph).toBe('tma-crash')
    expect(equipmentDefinition('fallen-motorcycle').rotatable).toBe(true)
    expect(equipmentDefinition('injured-person').glyph).toBe('injured-person')
    expect(deploymentLimit(equipmentDefinition('barrel'), coneTruck, 0)).toBe(50)
    expect(deploymentLimit(equipmentDefinition('barrel'), [...coneTruck, deploy('tma-cone-truck', 2)], 0)).toBe(100)
  })

  it('rotates dropped cars, cruisers, trucks, and motorcycles', () => {
    for (const id of ['vsp-cruiser', 'ems-ambulance', 'tow-truck', 'sedan-grey', 'pickup-green', 'tractor-trailer', 'school-bus', 'fallen-motorcycle']) {
      expect(isEquipmentRotatable(equipmentDefinition(id)), id).toBe(true)
    }
    for (const id of ['cone', 'barrel', 'injured-person', 'debris-grey']) {
      expect(isEquipmentRotatable(equipmentDefinition(id)), id).toBe(false)
    }
  })
})
