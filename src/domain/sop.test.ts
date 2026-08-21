import { describe, expect, it } from 'vitest'
import {
  RIGHT_LANE_STANDARD,
  SCENARIO_CATALOG,
  auditScene,
  createScene,
  scenarioLateralOffset,
  setDownstreamSpacing,
  setRightLaneTaperCount,
} from './sop'

describe('SOP scene audit', () => {
  it('aligns outer-lane templates to wider roadway markings', () => {
    expect(scenarioLateralOffset('right-lane', 3)).toBe(0)
    expect(scenarioLateralOffset('right-lane', 4)).toBe(6)
    expect(scenarioLateralOffset('shoulder', 5)).toBe(12)
    expect(scenarioLateralOffset('left-lane', 4)).toBe(-6)
    expect(scenarioLateralOffset('two-left-lanes', 5)).toBe(-12)
    expect(scenarioLateralOffset('center-lane', 5)).toBe(0)
  })

  it('places the SSP truck in the right lane with a left-arrow signboard', () => {
    expect(RIGHT_LANE_STANDARD.truck).toMatchObject({
      x: 48,
      width: 8.5,
      length: 24,
      halfLength: 12,
      signboard: 'left-arrow',
    })
    expect(RIGHT_LANE_STANDARD.truck.x).toBeGreaterThan(RIGHT_LANE_STANDARD.skipLineX)
    expect(RIGHT_LANE_STANDARD.truck.x).toBeLessThan(RIGHT_LANE_STANDARD.rightFogLineX)
    expect(RIGHT_LANE_STANDARD.roadCenterX).toBe(36)
  })

  it('accepts the standard right-lane closure template', () => {
    const result = auditScene('right-lane', 'gospel', createScene('right-lane'))

    expect(result.status).toBe('compliant')
  })

  it('offers common MUTCD freeway scene configurations with independent templates', () => {
    expect(SCENARIO_CATALOG.map((scenario) => scenario.id)).toEqual([
      'shoulder',
      'right-lane',
      'left-lane',
      'center-lane',
      'two-right-lanes',
      'two-left-lanes',
      'lane-shift',
      'ramp-closure',
    ])
    expect(createScene('two-right-lanes').filter((point) => point.role === 'taper')).toHaveLength(7)
    expect(createScene('lane-shift').length).toBeGreaterThan(createScene('right-lane').length)
    expect(createScene('left-lane').find((point) => point.id === 'anchor')?.x).toBe(30)
    expect(createScene('left-lane').find((point) => point.id === 'taper-5')?.x).toBe(18)
    expect(createScene('right-lane').find((point) => point.id === 'taper-5')?.x).toBe(54)
    expect(createScene('two-left-lanes').find((point) => point.id === 'anchor')?.x).toBe(42)
    expect(createScene('two-left-lanes').find((point) => point.id === 'taper-7')?.x).toBe(18)
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'two-left-lanes')?.truckOffsetX).toBe(-12)
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'left-lane')?.signboard).toBe('right-arrow')
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'right-lane')?.signboard).toBe('left-arrow')
  })

  it('rejects a cone moved into the emergency shoulder', () => {
    const scene = createScene('right-lane')
    scene[0] = { ...scene[0], x: 420 }

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain('Right shoulder must remain clear for emergency access.')
  })

  it('requires a 3-cone buffer and 5-cone taper upstream', () => {
    const scene = createScene('right-lane').filter(
      (point) => point.id !== 'buffer-2' && point.id !== 'taper-5',
    )

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain(
      'Buffer zone requires 3 cones: 1 anchor and 2 additional cones.',
    )
    expect(result.findings).toContain('Standard SOP requires exactly 5 taper cones.')
  })

  it('requires the anchor and downstream lead 10 ft from the truck', () => {
    const scene = createScene('right-lane').map((point) =>
      point.id === 'anchor' || point.id === 'lead' ? { ...point, y: point.y + 20 } : point,
    )

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain('Anchor cone must be 10 ft behind the SSP truck.')
    expect(result.findings).toContain(
      'Lead downstream cone must be 10 ft ahead of the truck on the skip line.',
    )
  })

  it('requires downstream cones at 40 ft intervals on the skip line', () => {
    const scene = createScene('right-lane')
    scene[9] = { ...scene[9], y: 610 }

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain(
      'Downstream cones must continue straight on the skip line at 40 ft intervals.',
    )
  })

  it('enforces minimum upstream spacing in modified mode', () => {
    const scene = createScene('shoulder')
    scene[1] = { ...scene[1], y: 430 }

    const result = auditScene('shoulder', 'modified', scene)

    expect(result.findings).toContain('Upstream cone spacing must be at least 40 ft.')
  })

  it('accepts more taper cones and wider downstream spacing in enhanced mode', () => {
    const scene = setDownstreamSpacing(setRightLaneTaperCount(createScene('right-lane'), 7), 80)

    const result = auditScene('right-lane', 'modified', scene)

    expect(result.status).toBe('compliant')
  })

  it('flags fewer than 8 rear cones as an SOP violation', () => {
    const scene = createScene('right-lane').filter((point) => point.id !== 'taper-5')

    const result = auditScene('right-lane', 'violate', scene)

    expect(result.findings).toContain(
      'SOP violation: fewer than 8 cones protect the rear upstream area.',
    )
  })

  it('flags rear taper spacing below 40 ft as an SOP violation', () => {
    const scene = createScene('right-lane').map((point) =>
      point.id === 'taper-1' ? { ...point, y: 387 } : point,
    )

    const result = auditScene('right-lane', 'violate', scene)

    expect(result.status).toBe('warning')
    expect(result.findings).toContain(
      'SOP violation: rear taper cones are separated by less than 40 ft.',
    )
  })
})