export type ScenarioType =
  | 'shoulder'
  | 'right-lane'
  | 'left-lane'
  | 'center-lane'
  | 'two-right-lanes'
  | 'two-left-lanes'
  | 'all-lanes'
  | 'lane-shift'
  | 'ramp-closure'
export type ComplianceMode = 'gospel' | 'modified' | 'violate'

export interface ScenarioDefinition {
  id: ScenarioType
  label: string
  heading: string
  mutcdApplication: string
  truckOffsetX: number
  signboard: 'left-arrow' | 'right-arrow' | 'split-arrow' | 'ramp-blocked' | 'incident-ahead' | 'double-diamonds'
}

export const SCENARIO_CATALOG: ScenarioDefinition[] = [
  { id: 'shoulder', label: 'Shoulder closure', heading: 'Standard shoulder closure', mutcdApplication: 'Shoulder work', truckOffsetX: 12, signboard: 'left-arrow' },
  { id: 'right-lane', label: 'Right lane closure', heading: 'Single right lane closure', mutcdApplication: 'Right lane closed', truckOffsetX: 0, signboard: 'left-arrow' },
  { id: 'left-lane', label: 'Left lane closure', heading: 'Single left lane closure', mutcdApplication: 'Left lane closed', truckOffsetX: -24, signboard: 'right-arrow' },
  { id: 'center-lane', label: 'Center lane closure', heading: 'Center lane closure', mutcdApplication: 'Interior lane closed', truckOffsetX: -12, signboard: 'split-arrow' },
  { id: 'two-right-lanes', label: 'Two right lanes', heading: 'Two right lanes closed', mutcdApplication: 'Multiple-lane closure', truckOffsetX: -12, signboard: 'left-arrow' },
  { id: 'two-left-lanes', label: 'Two left lanes', heading: 'Two left lanes closed', mutcdApplication: 'Multiple-lane closure', truckOffsetX: -12, signboard: 'right-arrow' },
  { id: 'all-lanes', label: 'All lanes closure', heading: 'All travel lanes closed', mutcdApplication: 'Full roadway closure', truckOffsetX: -12, signboard: 'double-diamonds' },
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
  mode: ComplianceMode
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

const SPACING_TOLERANCE = 0.15
const MINIMUM_CONE_SPACING = RIGHT_LANE_STANDARD.coneSpacing * (1 - SPACING_TOLERANCE)
const MAXIMUM_UPSTREAM_SPACING = RIGHT_LANE_STANDARD.coneSpacing * (1 + SPACING_TOLERANCE)
const MAXIMUM_DOWNSTREAM_SPACING = RIGHT_LANE_STANDARD.coneSpacing * 2 * (1 + SPACING_TOLERANCE)

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
  'left-lane': createLaneClosureTemplate(30, 18),
  'center-lane': createLaneClosureTemplate(30, 42),
  'two-right-lanes': createLaneClosureTemplate(30, 54, 10),
  'two-left-lanes': createLaneClosureTemplate(42, 18, 10),
  'all-lanes': createAllLanesTemplate(),
  'lane-shift': createLaneShiftTemplate(),
  'ramp-closure': createRampClosureTemplate(),
}

function createLaneClosureTemplate(openBoundaryX: number, closedBoundaryX: number, taperCount = 5): ScenePoint[] {
  const taper = Array.from({ length: taperCount }, (_, index): ScenePoint => {
    const progress = (index + 1) / taperCount
    return {
      id: `taper-${index + 1}`,
      x: openBoundaryX + (closedBoundaryX - openBoundaryX) * progress,
      y: 402 + index * RIGHT_LANE_STANDARD.coneSpacing,
      role: 'taper',
    }
  })
  return [
    { id: 'anchor', x: openBoundaryX, y: 282, role: 'anchor' },
    { id: 'buffer-1', x: openBoundaryX, y: 322, role: 'buffer' },
    { id: 'buffer-2', x: openBoundaryX, y: 362, role: 'buffer' },
    ...taper,
    { id: 'lead', x: openBoundaryX, y: 238, role: 'perimeter' },
    { id: 'perimeter-1', x: openBoundaryX, y: 198, role: 'perimeter' },
    { id: 'perimeter-2', x: openBoundaryX, y: 158, role: 'perimeter' },
  ]
}

function createAllLanesTemplate(): ScenePoint[] {
  const laneStartX = 18
  const laneWidth = 12
  const conesPerLane = 4
  const cones = Array.from({ length: 3 * conesPerLane }, (_, index): ScenePoint => {
    const laneIndex = Math.floor(index / conesPerLane)
    const positionInLane = index % conesPerLane
    return {
      id: index === 0 ? 'anchor' : `buffer-${index}`,
      x: laneStartX + laneIndex * laneWidth + (laneWidth * (positionInLane + 0.5)) / conesPerLane,
      y: RIGHT_LANE_STANDARD.truck.y + RIGHT_LANE_STANDARD.truck.halfLength + RIGHT_LANE_STANDARD.anchorGap,
      role: index === 0 ? 'anchor' : 'buffer',
    }
  })
  return cones
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

function coneSpacings(points: ScenePoint[], descending = false): number[] {
  const ordered = [...points].sort((first, second) =>
    descending ? second.y - first.y : first.y - second.y,
  )
  return ordered.slice(1).map((point, index) => Math.abs(point.y - ordered[index].y))
}

function pointsMatchTemplate(points: ScenePoint[], expected: ScenePoint[]): boolean {
  if (points.length !== expected.length) return false
  return expected.every((target) => {
    const actual = points.find((point) => point.id === target.id)
    return actual
      && Math.abs(actual.x - target.x) <= RIGHT_LANE_STANDARD.coneSpacing * SPACING_TOLERANCE
      && Math.abs(actual.y - target.y) <= RIGHT_LANE_STANDARD.coneSpacing * SPACING_TOLERANCE
  })
}

export function createScene(scenario: ScenarioType): ScenePoint[] {
  return templates[scenario].map((point) => ({ ...point }))
}

export function auditScene(
  scenario: ScenarioType,
  _mode: ComplianceMode,
  points: ScenePoint[],
): AuditResult {
  const findings: string[] = []
  const expected = templates[scenario]
  const upstream = points.filter((point) => point.role !== 'perimeter')
  const downstream = points.filter((point) => point.role === 'perimeter')
  const minimumUpstream = scenario === 'shoulder' ? 4 : scenario === 'all-lanes' ? 12 : 8

  if (scenario !== 'all-lanes' && downstream.length === 0) {
    findings.push('At least one downstream cone is required in front of the SSP truck.')
  }
  if (upstream.length < minimumUpstream) {
    findings.push(
      scenario === 'all-lanes'
        ? 'All-lanes closures require at least 12 cones across the travel lanes.'
        : scenario === 'shoulder'
        ? 'Shoulder closures require at least 4 upstream cones behind the SSP truck.'
        : 'Lane closures require at least 8 upstream cones behind the SSP truck.',
    )
  }
  if (scenario !== 'all-lanes' && coneSpacings(upstream).some((spacing) => spacing < MINIMUM_CONE_SPACING)) {
    findings.push('Upstream cone spacing is less than the 40 ft SOP standard.')
  }
  if (scenario !== 'all-lanes' && coneSpacings(upstream).some((spacing) => spacing > MAXIMUM_UPSTREAM_SPACING)) {
    findings.push('Upstream cone spacing exceeds the strict 40 ft SOP standard.')
  }
  if (scenario !== 'all-lanes' && coneSpacings(downstream, true).some((spacing) => spacing < MINIMUM_CONE_SPACING)) {
    findings.push('Downstream cone spacing is less than the 40 ft SOP standard.')
  }
  if (scenario !== 'all-lanes' && coneSpacings(downstream, true).some((spacing) => spacing > MAXIMUM_DOWNSTREAM_SPACING)) {
    findings.push('Downstream cone spacing exceeds the 80 ft Extended Safety maximum.')
  }

  if (findings.length > 0) {
    return { status: 'violation', title: 'Action required', findings, mode: 'violate' }
  }
  if (!pointsMatchTemplate(points, expected)) {
    return {
      status: 'compliant',
      title: 'Extended Safety',
      findings: ['Modified cone placement remains within active SOP limits.'],
      mode: 'modified',
    }
  }
  return {
    status: 'compliant',
    title: 'Setup compliant',
    findings: ['All active SOP checks pass.'],
    mode: 'gospel',
  }
}