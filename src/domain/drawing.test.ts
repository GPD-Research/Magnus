import { describe, expect, it } from 'vitest'
import { sampleStrokePoint, strokeExpiresAt, strokePoints, type DrawingStroke } from './drawing'

describe('drawing strokes', () => {
  it('samples long pointer movements into ten-foot vector segments', () => {
    const points = sampleStrokePoint([{ x: 0, y: 0 }], { x: 0, y: 25 })

    expect(points).toEqual([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 }])
  })

  it('keeps the final pointer position as a short closing segment', () => {
    const points = sampleStrokePoint([{ x: 0, y: 0 }], { x: 25, y: 0 }, true)

    expect(points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 25, y: 0 }])
  })

  it('serializes sampled points for an SVG polyline', () => {
    const stroke: DrawingStroke = {
      id: 'stroke-1',
      points: [{ x: 2, y: 4 }, { x: 12, y: 14 }],
      color: '#ffffff',
      widthFeet: 4,
      createdAt: 1,
      persistence: 'persistent',
    }

    expect(strokePoints(stroke)).toBe('2,4 12,14')
  })

  it('expires temporary strokes from pointer-up time only', () => {
    const stroke: DrawingStroke = {
      id: 'temporary-1',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      color: '#ffffff',
      widthFeet: 2,
      createdAt: 5_000,
      persistence: 'temporary',
      lifetimeSeconds: 15,
    }

    expect(strokeExpiresAt(stroke)).toBe(20_000)
    expect(strokeExpiresAt({ ...stroke, persistence: 'persistent' })).toBeNull()
  })
})
