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
      'all-lanes',
      'lane-shift',
      'ramp-closure',
    ])
    expect(createScene('two-right-lanes').filter((point) => point.role === 'taper')).toHaveLength(10)
    expect(createScene('all-lanes')).toHaveLength(12)
    expect(createScene('lane-shift').length).toBeGreaterThan(createScene('right-lane').length)
    expect(createScene('left-lane').find((point) => point.id === 'anchor')?.x).toBe(30)
    expect(createScene('left-lane').find((point) => point.id === 'taper-5')?.x).toBe(18)
    expect(createScene('right-lane').find((point) => point.id === 'taper-5')?.x).toBe(54)
    expect(createScene('two-left-lanes').find((point) => point.id === 'anchor')?.x).toBe(42)
    expect(createScene('two-left-lanes').find((point) => point.id === 'taper-5')?.x).toBe(30)
    expect(createScene('two-left-lanes').find((point) => point.id === 'taper-10')?.x).toBe(18)
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'two-left-lanes')?.truckOffsetX).toBe(-12)
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'left-lane')?.signboard).toBe('right-arrow')
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'right-lane')?.signboard).toBe('left-arrow')
    expect(SCENARIO_CATALOG.find((scenario) => scenario.id === 'all-lanes')?.signboard).toBe('double-diamonds')
  })

  it('places four cones per lane in one all-lanes closure row', () => {
    const scene = createScene('all-lanes')

    expect(scene).toHaveLength(12)
    expect(new Set(scene.map((point) => point.y))).toEqual(new Set([282]))
    expect(scene.every((point) => point.role !== 'perimeter')).toBe(true)
    expect(scene.slice(0, 4).map((point) => point.x)).toEqual([19.5, 22.5, 25.5, 28.5])
    expect(auditScene('all-lanes', 'gospel', scene)).toMatchObject({
      status: 'compliant',
      mode: 'gospel',
    })
    expect(auditScene('all-lanes', 'gospel', scene.slice(0, 11)).findings).toContain(
      'All-lanes closures require at least 12 cones across the travel lanes.',
    )
  })

  it('uses three straight cones followed by five taper cones per closed lane', () => {
    for (const scenario of ['right-lane', 'left-lane', 'center-lane'] as const) {
      const scene = createScene(scenario)
      expect(scene.filter((point) => point.role === 'anchor' || point.role === 'buffer'))
        .toMatchObject([
          { id: 'anchor', y: 282 },
          { id: 'buffer-1', y: 322 },
          { id: 'buffer-2', y: 362 },
        ])
      expect(scene.filter((point) => point.role === 'taper')).toHaveLength(5)
      expect(scene.find((point) => point.id === 'taper-1')?.y).toBe(402)
      expect(scene.find((point) => point.id === 'taper-5')?.y).toBe(562)
    }

    const twoRight = createScene('two-right-lanes')
    expect(twoRight.filter((point) => point.role === 'taper')).toHaveLength(10)
    expect(twoRight.find((point) => point.id === 'taper-5')).toMatchObject({ x: 42, y: 562 })
    expect(twoRight.find((point) => point.id === 'taper-10')).toMatchObject({ x: 54, y: 762 })

    const twoLeft = createScene('two-left-lanes')
    expect(twoLeft.filter((point) => point.role === 'taper')).toHaveLength(10)
    expect(twoLeft.find((point) => point.id === 'taper-5')).toMatchObject({ x: 30, y: 562 })
    expect(twoLeft.find((point) => point.id === 'taper-10')).toMatchObject({ x: 18, y: 762 })
  })

  it('classifies a valid manually moved cone as Extended Safety', () => {
    const scene = createScene('right-lane')
    scene[0] = { ...scene[0], x: 420 }

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result).toMatchObject({ status: 'compliant', mode: 'modified', title: 'Extended Safety' })
  })

  it('requires at least 8 upstream cones for lane closures', () => {
    const scene = createScene('right-lane').filter((point) => point.id !== 'taper-5')

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain(
      'Lane closures require at least 8 upstream cones behind the SSP truck.',
    )
    expect(result.mode).toBe('violate')
  })

  it('requires at least 4 upstream cones for shoulder closures', () => {
    const scene = createScene('shoulder').filter((point) => point.id !== 'taper-3')

    const result = auditScene('shoulder', 'gospel', scene)

    expect(result.findings).toContain(
      'Shoulder closures require at least 4 upstream cones behind the SSP truck.',
    )
  })

  it('requires at least one downstream cone', () => {
    const scene = createScene('right-lane').filter((point) => point.role !== 'perimeter')

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result.findings).toContain(
      'At least one downstream cone is required in front of the SSP truck.',
    )
  })

  it('accepts downstream spacing up to 80 ft with a 15 percent placement margin', () => {
    const accepted = setDownstreamSpacing(createScene('right-lane'), 92)
    const rejected = setDownstreamSpacing(createScene('right-lane'), 93)

    expect(auditScene('right-lane', 'gospel', accepted)).toMatchObject({
      status: 'compliant',
      mode: 'modified',
    })
    expect(auditScene('right-lane', 'gospel', rejected).findings).toContain(
      'Downstream cone spacing exceeds the 80 ft Extended Safety maximum.',
    )
  })

  it('applies the 15 percent lower margin to downstream spacing', () => {
    const accepted = setDownstreamSpacing(createScene('right-lane'), 34)
    const rejected = createScene('right-lane').map((point) =>
      point.id === 'perimeter-1' ? { ...point, y: 205 } : point,
    )

    expect(auditScene('right-lane', 'gospel', accepted).status).toBe('compliant')
    expect(auditScene('right-lane', 'gospel', rejected).findings).toContain(
      'Downstream cone spacing is less than the 40 ft SOP standard.',
    )
  })

  it('accepts more taper cones and wider downstream spacing in enhanced mode', () => {
    const scene = setDownstreamSpacing(setRightLaneTaperCount(createScene('right-lane'), 7), 80)

    const result = auditScene('right-lane', 'modified', scene)

    expect(result.status).toBe('compliant')
  })

  it('allows extra upstream cones at strict 40 ft spacing as Extended Safety', () => {
    const scene = [
      ...createScene('right-lane'),
      { id: 'taper-6', x: 54, y: 602, role: 'taper' as const },
    ]

    const result = auditScene('right-lane', 'gospel', scene)

    expect(result).toMatchObject({ status: 'compliant', mode: 'modified', title: 'Extended Safety' })
  })

  it('keeps upstream spacing within 40 ft plus or minus the 15 percent margin', () => {
    const withSpacing = (spacing: number) => createScene('right-lane').map((point) => {
      if (point.role === 'perimeter') return point
      const index = ['anchor', 'buffer-1', 'buffer-2', 'taper-1', 'taper-2', 'taper-3', 'taper-4', 'taper-5'].indexOf(point.id)
      return { ...point, y: 282 + index * spacing }
    })

    expect(auditScene('right-lane', 'gospel', withSpacing(34)).status).toBe('compliant')
    expect(auditScene('right-lane', 'gospel', withSpacing(46)).status).toBe('compliant')
    expect(auditScene('right-lane', 'gospel', withSpacing(33)).findings).toContain(
      'Upstream cone spacing is less than the 40 ft SOP standard.',
    )
    expect(auditScene('right-lane', 'gospel', withSpacing(47)).findings).toContain(
      'Upstream cone spacing exceeds the strict 40 ft SOP standard.',
    )
  })

  it('ignores the selected training tab when classifying the live scene', () => {
    expect(auditScene('right-lane', 'violate', createScene('right-lane')).mode).toBe('gospel')
  })
})