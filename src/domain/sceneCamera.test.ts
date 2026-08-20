import { describe, expect, it } from 'vitest'
import {
  MAX_SCENE_ZOOM,
  MIN_SCENE_ZOOM,
  centeredSceneViewBox,
  clampSceneZoom,
  clientToScenePoint,
} from './sceneCamera'

describe('scene camera', () => {
  it('centers a smaller view box when zooming in', () => {
    expect(centeredSceneViewBox({ width: 500, height: 760 }, 2)).toEqual({
      x: 125,
      y: 190,
      width: 250,
      height: 380,
    })
  })

  it('shows more context when zooming out and clamps its limits', () => {
    expect(centeredSceneViewBox({ width: 500, height: 760 }, 0.5)).toEqual({
      x: -250,
      y: -380,
      width: 1000,
      height: 1520,
    })
    expect(clampSceneZoom(0.1)).toBe(MIN_SCENE_ZOOM)
    expect(clampSceneZoom(5)).toBe(MAX_SCENE_ZOOM)
  })

  it('maps pointer positions through the active view box', () => {
    const point = clientToScenePoint(
      { x: 150, y: 200 },
      { left: 50, top: 50, width: 200, height: 300 },
      { x: 125, y: 190, width: 250, height: 380 },
    )

    expect(point).toEqual({ x: 250, y: 380 })
  })
})