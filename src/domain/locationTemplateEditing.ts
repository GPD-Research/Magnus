import type { Position, RoadFeature } from './roadScene'

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface EndpointRef {
  featureId: string
  end: 'start' | 'end'
  point: Position
}

function distance(a: Position, b: Position): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function nearestPointOnPolyline(points: Position[], click: Position): {
  index: number
  point: Position
  distance: number
} {
  let best = { index: 0, point: points[0], distance: Number.POSITIVE_INFINITY }
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index]
    const [x2, y2] = points[index + 1]
    const dx = x2 - x1
    const dy = y2 - y1
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((click[0] - x1) * dx + (click[1] - y1) * dy) / lengthSquared))
    const point: Position = [x1 + dx * t, y1 + dy * t]
    const pointDistance = distance(click, point)
    if (pointDistance < best.distance) best = { index, point, distance: pointDistance }
  }
  return best
}

/** Splits a LineString feature into two at the nearest point on its path to `click`. */
export function splitFeatureAt(feature: RoadFeature, click: Position): [RoadFeature, RoadFeature] | null {
  if (feature.geometry.type !== 'LineString') return null
  const points = feature.geometry.coordinates
  if (points.length < 2) return null
  const nearest = nearestPointOnPolyline(points, click)
  const firstPoints = [...points.slice(0, nearest.index + 1), nearest.point]
  const secondPoints = [nearest.point, ...points.slice(nearest.index + 1)]
  if (firstPoints.length < 2 || secondPoints.length < 2) return null
  const suffix = Math.random().toString(36).slice(2, 8)
  return [
    { ...feature, id: `${feature.id}-a-${suffix}`, geometry: { type: 'LineString', coordinates: firstPoints } },
    { ...feature, id: `${feature.id}-b-${suffix}`, geometry: { type: 'LineString', coordinates: secondPoints } },
  ]
}

/** Merges two LineString features end-to-end, snapping the shared join point to their midpoint. */
export function joinFeatures(a: RoadFeature, aEnd: 'start' | 'end', b: RoadFeature, bEnd: 'start' | 'end'): RoadFeature | null {
  if (a.geometry.type !== 'LineString' || b.geometry.type !== 'LineString') return null
  let pointsA = [...a.geometry.coordinates]
  let pointsB = [...b.geometry.coordinates]
  if (aEnd === 'start') pointsA = pointsA.reverse()
  if (bEnd === 'end') pointsB = pointsB.reverse()
  const lastA = pointsA.at(-1)
  const firstB = pointsB[0]
  if (!lastA || !firstB) return null
  const joinPoint: Position = [(lastA[0] + firstB[0]) / 2, (lastA[1] + firstB[1]) / 2]
  const merged = [...pointsA.slice(0, -1), joinPoint, ...pointsB.slice(1)]
  return { ...a, id: `${a.id}-joined-${Math.random().toString(36).slice(2, 8)}`, geometry: { type: 'LineString', coordinates: merged } }
}

/**
 * Rounds a sharp interior vertex into a flattened quadratic bezier arc (entrance/exit ramp radii).
 * The corner is trimmed by `radiusFeet` (capped to half of each adjacent segment) on both sides.
 */
export function roundVertex(feature: RoadFeature, vertexIndex: number, radiusFeet: number, segments = 12): RoadFeature | null {
  if (feature.geometry.type !== 'LineString') return null
  const points = feature.geometry.coordinates
  if (vertexIndex <= 0 || vertexIndex >= points.length - 1) return null
  const prev = points[vertexIndex - 1]
  const curr = points[vertexIndex]
  const next = points[vertexIndex + 1]
  const toPrevLength = distance(curr, prev)
  const toNextLength = distance(curr, next)
  const trim = Math.min(radiusFeet, toPrevLength / 2, toNextLength / 2)
  if (trim <= 0.1 || toPrevLength === 0 || toNextLength === 0) return null
  const p0: Position = [curr[0] + ((prev[0] - curr[0]) / toPrevLength) * trim, curr[1] + ((prev[1] - curr[1]) / toPrevLength) * trim]
  const p2: Position = [curr[0] + ((next[0] - curr[0]) / toNextLength) * trim, curr[1] + ((next[1] - curr[1]) / toNextLength) * trim]
  const arc: Position[] = []
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * curr[0] + t * t * p2[0]
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * curr[1] + t * t * p2[1]
    arc.push([x, y])
  }
  const coordinates = [...points.slice(0, vertexIndex), ...arc, ...points.slice(vertexIndex + 2)]
  return { ...feature, geometry: { type: 'LineString', coordinates } }
}

/**
 * Generates a parallel offset polyline using the angle-bisector ("miter") method: each vertex is
 * pushed along the averaged normal of its adjacent segments, scaled so the perpendicular distance
 * to each original segment stays `distanceFeet`. Sharp corners clamp their miter length to avoid spikes.
 * Left/right follow the same convention as the spatial-core ribbon/offset code: left = rotate the
 * forward tangent by (-dy, dx).
 */
export function offsetPolyline(points: Position[], distanceFeet: number, side: 'left' | 'right'): Position[] {
  if (points.length < 2) return points
  const segmentNormal = (a: Position, b: Position): Position => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy) || 1
    const tangent: Position = [dx / length, dy / length]
    return side === 'left' ? [-tangent[1], tangent[0]] : [tangent[1], -tangent[0]]
  }
  return points.map((point, index) => {
    const normals: Position[] = []
    if (index > 0) normals.push(segmentNormal(points[index - 1], point))
    if (index < points.length - 1) normals.push(segmentNormal(point, points[index + 1]))
    const sumX = normals.reduce((sum, normal) => sum + normal[0], 0)
    const sumY = normals.reduce((sum, normal) => sum + normal[1], 0)
    const length = Math.hypot(sumX, sumY) || 1
    const averaged: Position = [sumX / length, sumY / length]
    const cosHalfAngle = normals.length === 2
      ? Math.max(0.35, normals[0][0] * averaged[0] + normals[0][1] * averaged[1])
      : 1
    const miterScale = 1 / cosHalfAngle
    return [point[0] + averaged[0] * distanceFeet * miterScale, point[1] + averaged[1] * distanceFeet * miterScale]
  })
}

export function moveEndpoint(feature: RoadFeature, end: 'start' | 'end', point: Position): RoadFeature | null {
  if (feature.geometry.type !== 'LineString') return null
  const coordinates = [...feature.geometry.coordinates]
  if (coordinates.length === 0) return null
  if (end === 'start') coordinates[0] = point
  else coordinates[coordinates.length - 1] = point
  return { ...feature, geometry: { type: 'LineString', coordinates } }
}

export function listEndpoints(features: RoadFeature[]): EndpointRef[] {
  const endpoints: EndpointRef[] = []
  for (const feature of features) {
    if (feature.geometry.type !== 'LineString') continue
    const coordinates = feature.geometry.coordinates
    if (coordinates.length < 2) continue
    endpoints.push({ featureId: feature.id, end: 'start', point: coordinates[0] })
    endpoints.push({ featureId: feature.id, end: 'end', point: coordinates.at(-1)! })
  }
  return endpoints
}

/** Finds the nearest endpoint within `radiusFeet`, excluding endpoints belonging to `excludeFeatureId`. */
export function findSnapPoint(
  endpoints: EndpointRef[],
  point: Position,
  radiusFeet: number,
  excludeFeatureId?: string,
): Position | null {
  let best: { point: Position; distance: number } | null = null
  for (const endpoint of endpoints) {
    if (endpoint.featureId === excludeFeatureId) continue
    const candidateDistance = distance(point, endpoint.point)
    if (candidateDistance <= radiusFeet && (!best || candidateDistance < best.distance)) {
      best = { point: endpoint.point, distance: candidateDistance }
    }
  }
  return best?.point ?? null
}

function clipSegmentToBox(a: Position, b: Position, box: BoundingBox): [Position, Position] | null {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const checks: [number, number][] = [
    [-dx, a[0] - box.minX],
    [dx, box.maxX - a[0]],
    [-dy, a[1] - box.minY],
    [dy, box.maxY - a[1]],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]]
}

/** Clips a polyline against a box, splitting into multiple pieces wherever it exits/re-enters. */
function clipPolylineToBox(points: Position[], box: BoundingBox): Position[][] {
  const pieces: Position[][] = []
  let current: Position[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const clipped = clipSegmentToBox(points[index], points[index + 1], box)
    if (!clipped) {
      if (current.length >= 2) pieces.push(current)
      current = []
      continue
    }
    if (current.length === 0) current.push(clipped[0])
    current.push(clipped[1])
  }
  if (current.length >= 2) pieces.push(current)
  return pieces
}

function lerpAtX(a: Position, b: Position, x: number): Position {
  const t = (x - a[0]) / (b[0] - a[0])
  return [x, a[1] + t * (b[1] - a[1])]
}

function lerpAtY(a: Position, b: Position, y: number): Position {
  const t = (y - a[1]) / (b[1] - a[1])
  return [a[0] + t * (b[0] - a[0]), y]
}

function clipEdge(points: Position[], inside: (point: Position) => boolean, intersect: (a: Position, b: Position) => Position): Position[] {
  const output: Position[] = []
  for (let index = 0; index < points.length; index += 1) {
    const curr = points[index]
    const prev = points[(index - 1 + points.length) % points.length]
    const currInside = inside(curr)
    const prevInside = inside(prev)
    if (currInside) {
      if (!prevInside) output.push(intersect(prev, curr))
      output.push(curr)
    } else if (prevInside) {
      output.push(intersect(prev, curr))
    }
  }
  return output
}

/** Sutherland-Hodgman polygon clip against an axis-aligned box. */
function clipPolygonToBox(ring: Position[], box: BoundingBox): Position[] {
  let points = ring
  points = clipEdge(points, (p) => p[0] >= box.minX, (a, b) => lerpAtX(a, b, box.minX))
  points = clipEdge(points, (p) => p[0] <= box.maxX, (a, b) => lerpAtX(a, b, box.maxX))
  points = clipEdge(points, (p) => p[1] >= box.minY, (a, b) => lerpAtY(a, b, box.minY))
  points = clipEdge(points, (p) => p[1] <= box.maxY, (a, b) => lerpAtY(a, b, box.maxY))
  return points
}

/**
 * Crops every feature to inside the box: polylines split wherever they cross the boundary (cut
 * endpoints simply terminate at the box edge), polygons are clipped closed via Sutherland-Hodgman.
 */
export function cropFeaturesToBoundingBox(features: RoadFeature[], box: BoundingBox): RoadFeature[] {
  const result: RoadFeature[] = []
  for (const feature of features) {
    if (feature.geometry.type === 'LineString') {
      const pieces = clipPolylineToBox(feature.geometry.coordinates, box)
      pieces.forEach((coordinates, index) => {
        result.push({
          ...feature,
          id: pieces.length > 1 ? `${feature.id}-crop-${index}` : feature.id,
          geometry: { type: 'LineString', coordinates },
        })
      })
    } else {
      const ring = clipPolygonToBox(feature.geometry.coordinates[0] ?? [], box)
      if (ring.length >= 3) {
        result.push({ ...feature, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } })
      }
    }
  }
  return result
}

export function polylineLengthFeet(points: Position[]): number {
  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) total += distance(points[index], points[index + 1])
  return total
}
