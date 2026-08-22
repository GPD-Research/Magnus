import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBLE_SCENE_WIDTH_FEET,
  MAX_SCENE_ZOOM,
  MIN_VISIBLE_SCENE_WIDTH_FEET,
  MIN_SCENE_ZOOM,
  centeredSceneViewBox,
  clampSceneZoom,
  clientToScenePoint,
  sceneZoomForVisibleWidth,
  scenePointToLocal,
  visibleSceneWidth,
} from './sceneCamera'

describe('scene camera', () => {
  it('maps world points into a rotated scene coordinate system', () => {
    expect(scenePointToLocal(
      { x: 110, y: 100 },
      { x: 100, y: 100, rotation: 90 },
      { x: 36, y: 260 },
    )).toEqual({ x: 36, y: 250 })
  })
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
    expect(clampSceneZoom(50_000)).toBe(MAX_SCENE_ZOOM)
  })

  it('allows detailed inspection of large interchange scenes', () => {
    expect(clampSceneZoom(8)).toBe(8)
    expect(MAX_SCENE_ZOOM).toBe(10_000)
  })

  it('derives zoom from a physical visible width', () => {
    const scene = { width: 2_000, height: 4_000 }
    const display = { width: 1_000, height: 800 }
    const defaultZoom = sceneZoomForVisibleWidth(
      scene,
      display,
      DEFAULT_VISIBLE_SCENE_WIDTH_FEET,
    )
    const maximumZoom = sceneZoomForVisibleWidth(
      scene,
      display,
      MIN_VISIBLE_SCENE_WIDTH_FEET,
    )

    expect(visibleSceneWidth(scene, display, defaultZoom)).toBe(500)
    expect(visibleSceneWidth(scene, display, maximumZoom)).toBe(40)
  })

  it('fits a tall road scene to a wide display before zooming', () => {
    expect(centeredSceneViewBox(
      { width: 72, height: 760 },
      1,
      { width: 800, height: 600 },
    )).toEqual({
      x: -470.66666666666663,
      y: 0,
      width: 1013.3333333333333,
      height: 760,
    })

    expect(centeredSceneViewBox(
      { width: 72, height: 760 },
      2,
      { width: 800, height: 600 },
    )).toEqual({
      x: -217.33333333333331,
      y: 190,
      width: 506.66666666666663,
      height: 380,
    })
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