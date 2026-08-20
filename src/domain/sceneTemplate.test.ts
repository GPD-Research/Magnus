import { describe, expect, it } from 'vitest'
import {
  createRightLaneTemplate,
  equipmentMatrix,
  snapToGrid,
  transformPoint,
  type EquipmentPrimitive,
} from './sceneTemplate'

describe('scene template vector model', () => {
  it('snaps authoring points to the 10 ft grid', () => {
    expect(snapToGrid({ x: 124, y: 276 })).toEqual({ x: 120, y: 280 })
  })

  it('applies equipment translation and rotation through a 3x3 matrix', () => {
    const equipment: EquipmentPrimitive = {
      id: 'unit',
      label: 'Unit',
      shape: 'rectangle',
      position: { x: 100, y: 200 },
      size: { x: 20, y: 40 },
      rotation: 90,
      color: '#ffffff',
    }

    const transformed = transformPoint(equipmentMatrix(equipment), { x: 10, y: 0 })

    expect(transformed.x).toBeCloseTo(100)
    expect(transformed.y).toBeCloseTo(210)
  })

  it('seeds a bottom-to-top right-lane template with the truck inside the lane', () => {
    const template = createRightLaneTemplate()
    const truck = template.equipment.find((item) => item.id === 'ssp-truck')

    expect(template.flow).toBe('bottom-to-top')
    expect(template.gridSize).toBe(10)
    expect(template.equipment.filter((item) => item.shape === 'circle')).toHaveLength(11)
    expect(template.sources[0]?.publisher).toBe('Federal Highway Administration')
    expect(truck?.position.x).toBeGreaterThan(320)
    expect(truck?.position.x).toBeLessThan(440)
    expect(truck?.signboard).toBe('left-arrow')
  })
})