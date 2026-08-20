export const MIN_SCENE_ZOOM = 0.5
export const MAX_SCENE_ZOOM = 2.5
export const SCENE_ZOOM_STEP = 0.25

export interface SceneViewport {
  width: number
  height: number
}

export interface SceneViewBox extends SceneViewport {
  x: number
  y: number
}

export function clampSceneZoom(zoom: number): number {
  return Math.min(MAX_SCENE_ZOOM, Math.max(MIN_SCENE_ZOOM, zoom))
}

export function centeredSceneViewBox(
  viewport: SceneViewport,
  zoom: number,
  displayViewport: SceneViewport = viewport,
): SceneViewBox {
  const boundedZoom = clampSceneZoom(zoom)
  const sceneAspectRatio = viewport.width / viewport.height
  const displayAspectRatio = displayViewport.width / displayViewport.height
  const fittedWidth = displayAspectRatio > sceneAspectRatio
    ? viewport.height * displayAspectRatio
    : viewport.width
  const fittedHeight = displayAspectRatio > sceneAspectRatio
    ? viewport.height
    : viewport.width / displayAspectRatio
  const width = fittedWidth / boundedZoom
  const height = fittedHeight / boundedZoom

  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
  }
}

export function clientToScenePoint(
  client: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
  viewBox: SceneViewBox,
): { x: number; y: number } {
  return {
    x: viewBox.x + ((client.x - bounds.left) / bounds.width) * viewBox.width,
    y: viewBox.y + ((client.y - bounds.top) / bounds.height) * viewBox.height,
  }
}