import { describe, expect, it } from 'vitest'
import { agenciesOnScene, reportedHazards, sceneHazards } from './sceneReport'
import { carriagewaysOf, createReferenceRoadScene } from './roadScene'
import { generateHighwayScene, DEFAULT_HIGHWAY_GENERATOR_OPTIONS } from './highwayGenerator'
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
  const layout = { laneCount: 3, carriageways: carriagewaysOf(createReferenceRoadScene(3)), scenario: 'right-lane' as const }
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
    expect(sceneHazards([placed('sedan-grey', 0, 0, 'crashed')], { laneCount: 3, carriageways: [], scenario: 'two-right-lanes' }))
      .toMatchObject([{ lanes: [1, 2] }])
    expect(sceneHazards([placed('sedan-grey', 0)], { laneCount: 3, carriageways: [], scenario: 'shoulder' }))
      .toMatchObject([{ lanes: [], shoulders: ['right'] }])
  })
})

describe('sceneHazards on generated highways', () => {
  const placed = (definitionId: string, x: number, rotation = 0): DeployedEquipment =>
    ({ id: `${definitionId}-${x}`, definitionId, x, y: 300, rotation, hazardState: 'disabled' })

  it('names lanes from the loaded five-lane template rather than the stepper', () => {
    const scene = generateHighwayScene({ ...DEFAULT_HIGHWAY_GENERATOR_OPTIONS, lanes: 5, direction: 'one-direction', ramp: 'none' })
    const [primary] = carriagewaysOf(scene)
    expect(primary).toMatchObject({ lanes: 5, direction: 'forward' })
    const laneCenter = (index: number) => primary.minX + (primary.maxX - primary.minX - 12 * 5) / 2 + 12 * index + 6
    const layout = { laneCount: 3, carriageways: [primary], scenario: 'two-left-lanes' as const }
    expect(sceneHazards([placed('sedan-grey', laneCenter(1))], layout)).toMatchObject([{ lanes: [1] }])
    expect(sceneHazards([placed('sedan-grey', laneCenter(3))], layout)).toMatchObject([{ lanes: [3] }])
  })

  it('mirrors lane names and shoulders on the opposing carriageway of a divided highway', () => {
    const scene = generateHighwayScene({ ...DEFAULT_HIGHWAY_GENERATOR_OPTIONS, lanes: 3, direction: 'both-directions', ramp: 'none' })
    const carriageways = carriagewaysOf(scene)
    const opposing = carriageways.find((c) => c.direction === 'backward')!
    const forward = carriageways.find((c) => c.direction === 'forward')!
    expect(opposing.maxX).toBeLessThan(forward.minX)
    const shoulder = (opposing.maxX - opposing.minX - 36) / 2
    const layout = { laneCount: 3, carriageways, scenario: 'right-lane' as const }
    // scene-left lane of the down-flowing carriageway is the driver's right lane
    expect(sceneHazards([placed('sedan-grey', opposing.minX + shoulder + 6)], layout)).toMatchObject([{ lanes: [2], shoulders: [] }])
    // median-side shoulder of the down-flowing carriageway is its left shoulder
    expect(sceneHazards([placed('sedan-grey', opposing.maxX - shoulder / 2)], layout)).toMatchObject([{ lanes: [], shoulders: ['left'] }])
    // forward carriageway is unchanged
    expect(sceneHazards([placed('sedan-grey', forward.minX + shoulder + 6)], layout)).toMatchObject([{ lanes: [0], shoulders: [] }])
  })
})
