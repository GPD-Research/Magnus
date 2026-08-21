export type ScenarioType =
  | 'shoulder'
  | 'right-lane'
  | 'left-lane'
  | 'center-lane'
  | 'two-right-lanes'
  | 'two-left-lanes'
  | 'lane-shift'
  | 'ramp-closure'
export type ComplianceMode = 'gospel' | 'modified' | 'violate'

export interface ScenarioDefinition {
  id: ScenarioType
  label: string
  heading: string
  mutcdApplication: string
  truckOffsetX: number
  signboard: 'left-arrow' | 'right-arrow' | 'split-arrow' | 'ramp-blocked'
}

export const SCENARIO_CATALOG: ScenarioDefinition[] = [
  { id: 'shoulder', label: 'Shoulder closure', heading: 'Standard shoulder closure', mutcdApplication: 'Shoulder work', truckOffsetX: 12, signboard: 'left-arrow' },
  { id: 'right-lane', label: 'Right lane closure', heading: 'Single right lane closure', mutcdApplication: 'Right lane closed', truckOffsetX: 0, signboard: 'left-arrow' },
  { id: 'left-lane', label: 'Left lane closure', heading: 'Single left lane closure', mutcdApplication: 'Left lane closed', truckOffsetX: -24, signboard: 'right-arrow' },
  { id: 'center-lane', label: 'Center lane closure', heading: 'Center lane closure', mutcdApplication: 'Interior lane closed', truckOffsetX: -12, signboard: 'split-arrow' },
  { id: 'two-right-lanes', label: 'Two right lanes', heading: 'Two right lanes closed', mutcdApplication: 'Multiple-lane closure', truckOffsetX: -12, signboard: 'left-arrow' },
  { id: 'two-left-lanes', label: 'Two left lanes', heading: 'Two left lanes closed', mutcdApplication: 'Multiple-lane closure', truckOffsetX: -24, signboard: 'right-arrow' },
  { id: 'lane-shift', label: 'Lane shift', heading: 'Temporary lane shift', mutcdApplication: 'Temporary alignment', truckOffsetX: 0, signboard: 'split-arrow' },
  { id: 'ramp-closure', label: 'Ramp closure', heading: 'Entrance or exit ramp closure', mutcdApplication: 'Ramp closed', truckOffsetX: 12, signboard: 'ramp-blocked' },
]

export function scenarioDefinition(scenario: ScenarioType): ScenarioDefinition {
  return SCENARIO_CATALOG.find((definition) => definition.id === scenario) ?? SCENARIO_CATALOG[1]
}

export function scenarioLateralOffset(scenario: ScenarioType, lanes = 3): number {
  const outerLaneOffset = Math.max(0, lanes - 3) * 6
  if (scenario === 'left-lane' || scenario === 'two-left-lanes') return -outerLaneOffset
  if (
    scenario === 'shoulder'
    || scenario === 'right-lane'
    || scenario === 'two-right-lanes'
    || scenario === 'ramp-closure'
  ) return outerLaneOffset
  return 0
}

export interface ScenePoint {
  id: string
  x: number
  y: number
  role: 'anchor' | 'buffer' | 'taper' | 'perimeter'
}

export interface AuditResult {
  status: 'compliant' | 'warning' | 'violation'
  title: string
  findings: string[]
}

export const RIGHT_LANE_STANDARD = {
  truck: { x: 48, y: 260, width: 8.5, length: 24, halfLength: 12, signboard: 'left-arrow' },
  roadCenterX: 36,
  skipLineX: 42,
  rightFogLineX: 54,
  anchorGap: 10,
  leadGap: 10,
  bufferConeCount: 3,
  taperConeCount: 5,
  coneSpacing: 40,
} as const

const POSITION_TOLERANCE = 4

const templates: Record<ScenarioType, ScenePoint[]> = {
  shoulder: [
    { id: 'anchor', x: 54, y: 282, role: 'anchor' },
    { id: 'taper-1', x: 58, y: 322, role: 'taper' },
    { id: 'taper-2', x: 62, y: 362, role: 'taper' },
    { id: 'taper-3', x: 66, y: 402, role: 'taper' },
    { id: 'lead', x: 54, y: 238, role: 'perimeter' },
    { id: 'perimeter-1', x: 54, y: 198, role: 'perimeter' },
    { id: 'perimeter-2', x: 54, y: 158, role: 'perimeter' },
  ],
  'right-lane': [
    { id: 'anchor', x: RIGHT_LANE_STANDARD.skipLineX, y: 282, role: 'anchor' },
    { id: 'buffer-1', x: RIGHT_LANE_STANDARD.skipLineX, y: 322, role: 'buffer' },
    { id: 'buffer-2', x: RIGHT_LANE_STANDARD.skipLineX, y: 362, role: 'buffer' },
    { id: 'taper-1', x: 44.4, y: 402, role: 'taper' },
    { id: 'taper-2', x: 46.8, y: 442, role: 'taper' },
    { id: 'taper-3', x: 49.2, y: 482, role: 'taper' },
    { id: 'taper-4', x: 51.6, y: 522, role: 'taper' },
    { id: 'taper-5', x: RIGHT_LANE_STANDARD.rightFogLineX, y: 562, role: 'taper' },
    { id: 'lead', x: RIGHT_LANE_STANDARD.skipLineX, y: 238, role: 'perimeter' },
    { id: 'perimeter-1', x: RIGHT_LANE_STANDARD.skipLineX, y: 198, role: 'perimeter' },
    { id: 'perimeter-2', x: RIGHT_LANE_STANDARD.skipLineX, y: 158, role: 'perimeter' },
  ],
  'left-lane': createLaneClosureTemplate(18, 30),
  'center-lane': createLaneClosureTemplate(30, 42),
  'two-right-lanes': createLaneClosureTemplate(30, 54, 7),
  'two-left-lanes': createLaneClosureTemplate(18, 42, 7),
  'lane-shift': createLaneShiftTemplate(),
  'ramp-closure': createRampClosureTemplate(),
}

function createLaneClosureTemplate(openBoundaryX: number, closedBoundaryX: number, taperCount = 5): ScenePoint[] {
  const taper = Array.from({ length: taperCount }, (_, index): ScenePoint => {
    const progress = (index + 1) / taperCount
    return {
      id: `taper-${index + 1}`,
      x: openBoundaryX + (closedBoundaryX - openBoundaryX) * progress,
      y: 362 + index * RIGHT_LANE_STANDARD.coneSpacing,
      role: 'taper',
    }
  })
  return [
    { id: 'anchor', x: openBoundaryX, y: 282, role: 'anchor' },
    { id: 'buffer-1', x: openBoundaryX, y: 322, role: 'buffer' },
    ...taper,
    { id: 'lead', x: openBoundaryX, y: 238, role: 'perimeter' },
    { id: 'perimeter-1', x: openBoundaryX, y: 198, role: 'perimeter' },
    { id: 'perimeter-2', x: openBoundaryX, y: 158, role: 'perimeter' },
  ]
}

function createLaneShiftTemplate(): ScenePoint[] {
  return [
    ...createLaneClosureTemplate(42, 54).map((point) => ({ ...point, id: `right-${point.id}` })),
    ...createLaneClosureTemplate(18, 30).map((point) => ({ ...point, id: `left-${point.id}`, y: point.y + 40 })),
  ]
}

function createRampClosureTemplate(): ScenePoint[] {
  return [
    { id: 'anchor', x: 54, y: 282, role: 'anchor' },
    { id: 'buffer-1', x: 58, y: 322, role: 'buffer' },
    { id: 'taper-1', x: 62, y: 362, role: 'taper' },
    { id: 'taper-2', x: 66, y: 402, role: 'taper' },
    { id: 'taper-3', x: 70, y: 442, role: 'taper' },
    { id: 'lead', x: 54, y: 238, role: 'perimeter' },
    { id: 'perimeter-1', x: 58, y: 198, role: 'perimeter' },
    { id: 'perimeter-2', x: 62, y: 158, role: 'perimeter' },
  ]
}

export function setRightLaneTaperCount(points: ScenePoint[], count: number): ScenePoint[] {
  const taperCount = Math.max(RIGHT_LANE_STANDARD.taperConeCount, Math.round(count))
  const firstTaperIndex = points.findIndex((point) => point.role === 'taper')
  const bufferEndY = Math.max(
    ...points
      .filter((point) => point.role === 'anchor' || point.role === 'buffer')
      .map((point) => point.y),
  )
  const taperWidth = RIGHT_LANE_STANDARD.rightFogLineX - RIGHT_LANE_STANDARD.skipLineX
  const taper = Array.from({ length: taperCount }, (_, index): ScenePoint => {
    const sequence = index + 1
    return {
      id: `taper-${sequence}`,
      x: RIGHT_LANE_STANDARD.skipLineX + (taperWidth * sequence) / taperCount,
      y: bufferEndY + RIGHT_LANE_STANDARD.coneSpacing * sequence,
      role: 'taper',
    }
  })
  const withoutTaper = points.filter((point) => point.role !== 'taper')

  return [
    ...withoutTaper.slice(0, firstTaperIndex),
    ...taper,
    ...withoutTaper.slice(firstTaperIndex),
  ]
}

export function setDownstreamSpacing(points: ScenePoint[], spacing: number): ScenePoint[] {
  const downstreamSpacing = Math.max(RIGHT_LANE_STANDARD.coneSpacing, Math.round(spacing))
  const downstream = points
    .filter((point) => point.role === 'perimeter')
    .sort((first, second) => second.y - first.y)
  const downstreamPositions = new Map(
    downstream.map((point, index) => [
      point.id,
      RIGHT_LANE_STANDARD.truck.y -
        RIGHT_LANE_STANDARD.truck.halfLength -
        RIGHT_LANE_STANDARD.leadGap -
        downstreamSpacing * index,
    ]),
  )

  return points.map((point) => ({
    ...point,
    y: downstreamPositions.get(point.id) ?? point.y,
  }))
}

function hasCompressedSpacing(points: ScenePoint[]): boolean {
  const ordered = [...points].sort((first, second) => first.y - second.y)
  return ordered.some(
    (point, index) =>
      index > 0 &&
      point.y - ordered[index - 1].y <
        RIGHT_LANE_STANDARD.coneSpacing - POSITION_TOLERANCE,
  )
}

function auditRightLane(points: ScenePoint[], mode: ComplianceMode): string[] {
  const findings: string[] = []
  const buffer = points.filter((point) => point.role === 'anchor' || point.role === 'buffer')
  const taper = points.filter((point) => point.role === 'taper')
  const downstream = points.filter((point) => point.role === 'perimeter')
  const upstream = [...buffer, ...taper]
  const anchor = points.find((point) => point.role === 'anchor')
  const lead = points.find((point) => point.id === 'lead')

  if (mode === 'violate') {
    if (upstream.length < RIGHT_LANE_STANDARD.bufferConeCount + RIGHT_LANE_STANDARD.taperConeCount) {
      findings.push('SOP violation: fewer than 8 cones protect the rear upstream area.')
    }
    if (hasCompressedSpacing(upstream)) {
      findings.push('SOP violation: rear taper cones are separated by less than 40 ft.')
    }
    return findings
  }

  if (buffer.length !== RIGHT_LANE_STANDARD.bufferConeCount) {
    findings.push('Buffer zone requires 3 cones: 1 anchor and 2 additional cones.')
  }

  if (
    (mode === 'gospel' && taper.length !== RIGHT_LANE_STANDARD.taperConeCount) ||
    (mode === 'modified' && taper.length < RIGHT_LANE_STANDARD.taperConeCount)
  ) {
    findings.push(
      mode === 'gospel'
        ? 'Standard SOP requires exactly 5 taper cones.'
        : 'Enhanced Safety requires at least 5 taper cones.',
    )
  }

  if (buffer.some((point) => Math.abs(point.x - RIGHT_LANE_STANDARD.skipLineX) > POSITION_TOLERANCE)) {
    findings.push('All 3 buffer cones must remain on the center/right skip line.')
  }

  if (anchor) {
    const expectedAnchorY =
      RIGHT_LANE_STANDARD.truck.y +
      RIGHT_LANE_STANDARD.truck.halfLength +
      RIGHT_LANE_STANDARD.anchorGap
    if (Math.abs(anchor.y - expectedAnchorY) > POSITION_TOLERANCE) {
      findings.push('Anchor cone must be 10 ft behind the SSP truck.')
    }
  }

  const orderedUpstream = [...upstream].sort((first, second) => first.y - second.y)
  const invalidUpstreamSpacing = orderedUpstream.some((point, index) => {
    if (index === 0) return false
    const spacing = point.y - orderedUpstream[index - 1].y
    return mode === 'gospel'
      ? Math.abs(spacing - RIGHT_LANE_STANDARD.coneSpacing) > POSITION_TOLERANCE
      : spacing < RIGHT_LANE_STANDARD.coneSpacing - POSITION_TOLERANCE
  })
  if (invalidUpstreamSpacing) {
    findings.push(
      mode === 'gospel'
        ? 'Buffer and taper cones must be spaced at 40 ft intervals.'
        : 'Enhanced Safety rear cone spacing cannot be less than 40 ft.',
    )
  }

  const fogLineCone = taper.reduce<ScenePoint | undefined>(
    (farthest, point) => (!farthest || point.y > farthest.y ? point : farthest),
    undefined,
  )
  if (
    fogLineCone &&
    Math.abs(fogLineCone.x - RIGHT_LANE_STANDARD.rightFogLineX) > POSITION_TOLERANCE
  ) {
    findings.push('The merge taper must terminate on the right shoulder fog line.')
  }

  if (points.some((point) => point.x > RIGHT_LANE_STANDARD.rightFogLineX + POSITION_TOLERANCE)) {
    findings.push('Right shoulder must remain clear for emergency access.')
  }

  if (lead) {
    const expectedLeadY =
      RIGHT_LANE_STANDARD.truck.y -
      RIGHT_LANE_STANDARD.truck.halfLength -
      RIGHT_LANE_STANDARD.leadGap
    if (
      Math.abs(lead.x - RIGHT_LANE_STANDARD.skipLineX) > POSITION_TOLERANCE ||
      Math.abs(lead.y - expectedLeadY) > POSITION_TOLERANCE
    ) {
      findings.push('Lead downstream cone must be 10 ft ahead of the truck on the skip line.')
    }
  } else {
    findings.push('Lead downstream cone is required.')
  }

  const orderedDownstream = downstream.sort((first, second) => second.y - first.y)
  const invalidDownstream = orderedDownstream.some((point, index) => {
    if (Math.abs(point.x - RIGHT_LANE_STANDARD.skipLineX) > POSITION_TOLERANCE) return true
    if (index === 0) return false
    const spacing = orderedDownstream[index - 1].y - point.y
    return mode === 'gospel'
      ? Math.abs(spacing - RIGHT_LANE_STANDARD.coneSpacing) > POSITION_TOLERANCE
      : spacing < RIGHT_LANE_STANDARD.coneSpacing - POSITION_TOLERANCE
  })
  if (invalidDownstream) {
    findings.push(
      mode === 'gospel'
        ? 'Downstream cones must continue straight on the skip line at 40 ft intervals.'
        : 'Enhanced Safety downstream spacing must be 40 ft or wider.',
    )
  }

  return findings
}

export function createScene(scenario: ScenarioType): ScenePoint[] {
  return templates[scenario].map((point) => ({ ...point }))
}

export function auditScene(
  scenario: ScenarioType,
  mode: ComplianceMode,
  points: ScenePoint[],
): AuditResult {
  const findings: string[] = []
  const expected = templates[scenario]

  if (scenario === 'right-lane') {
    findings.push(...auditRightLane(points, mode))
  } else if (points.length < expected.length) {
    findings.push(`${expected.length - points.length} required cone(s) missing.`)
  }

  if (mode === 'violate') {
    return {
      status: 'warning',
      title: findings.length > 0 ? 'SOP violations detected' : 'SOP violation mode active',
      findings:
        findings.length > 0
          ? findings
          : ['Current rear protection still meets the 8-cone and 40 ft minimums.'],
    }
  }

  if (mode === 'gospel') {
    const movedPoints = expected.filter((target) => {
      const actual = points.find((point) => point.id === target.id)
      return (
        !actual ||
        Math.abs(actual.x - target.x) > POSITION_TOLERANCE ||
        Math.abs(actual.y - target.y) > POSITION_TOLERANCE
      )
    })

    if (movedPoints.length > 0) {
      findings.push(`${movedPoints.length} cone(s) are outside locked SOP positions.`)
    }
  } else {
    const upstream = points
      .filter((point) => point.role !== 'perimeter')
      .sort((first, second) => first.y - second.y)

    if (upstream.some((point, index) => index > 0 && point.y - upstream[index - 1].y < 40)) {
      findings.push('Upstream cone spacing must be at least 40 ft.')
    }
  }

  return findings.length === 0
    ? { status: 'compliant', title: 'Setup compliant', findings: ['All active SOP checks pass.'] }
    : { status: 'violation', title: 'Action required', findings }
}