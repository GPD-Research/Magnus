export type DrawingPersistence = 'persistent' | 'temporary'

export interface DrawingPoint {
  x: number
  y: number
}

export interface DrawingStroke {
  id: string
  points: DrawingPoint[]
  color: string
  widthFeet: number
  createdAt: number
  persistence: DrawingPersistence
  lifetimeSeconds?: number
}

export function sampleStrokePoint(
  points: DrawingPoint[],
  target: DrawingPoint,
  finish = false,
  segmentLength = 10,
): DrawingPoint[] {
  const start = points.at(-1)
  if (!start) return [target]
  const deltaX = target.x - start.x
  const deltaY = target.y - start.y
  const distance = Math.hypot(deltaX, deltaY)
  if (distance === 0) return points

  const samples = [...points]
  for (let travelled = segmentLength; travelled <= distance; travelled += segmentLength) {
    const ratio = travelled / distance
    samples.push({ x: start.x + deltaX * ratio, y: start.y + deltaY * ratio })
  }
  const last = samples.at(-1) ?? start
  if (finish && Math.hypot(target.x - last.x, target.y - last.y) > 0.01) samples.push(target)
  return samples
}

export function strokePoints(stroke: DrawingStroke): string {
  return stroke.points.map((point) => `${point.x},${point.y}`).join(' ')
}

export function strokeExpiresAt(stroke: DrawingStroke): number | null {
  return stroke.persistence === 'temporary'
    ? stroke.createdAt + (stroke.lifetimeSeconds ?? 10) * 1_000
    : null
}
