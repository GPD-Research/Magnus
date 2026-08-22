export const MIN_SCENE_ZOOM = 0.5
export const MAX_SCENE_ZOOM = 10_000
export const SCENE_ZOOM_FACTOR = 1.25
export const DEFAULT_VISIBLE_SCENE_WIDTH_FEET = 500
export const MIN_VISIBLE_SCENE_WIDTH_FEET = 40

export interface SceneViewport {
  width: number
  height: number
}

export interface SceneViewBox extends SceneViewport {
  x: number
  y: number
}

export function clampSceneZoom(zoom: number, maximum = MAX_SCENE_ZOOM): number {
  return Math.min(maximum, Math.max(MIN_SCENE_ZOOM, zoom))
}

export function sceneZoomForVisibleWidth(
  viewport: SceneViewport,
  displayViewport: SceneViewport,
  visibleWidth: number,
): number {
  const fittedView = centeredSceneViewBox(viewport, 1, displayViewport)
  return clampSceneZoom(fittedView.width / visibleWidth)
}

export function visibleSceneWidth(
  viewport: SceneViewport,
  displayViewport: SceneViewport,
  zoom: number,
): number {
  const fittedView = centeredSceneViewBox(viewport, 1, displayViewport)
  return fittedView.width / clampSceneZoom(zoom)
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

export function scenePointToLocal(
  point: { x: number; y: number },
  transform: { x: number; y: number; rotation: number },
  anchor: { x: number; y: number },
): { x: number; y: number } {
  const radians = (-transform.rotation * Math.PI) / 180
  const translatedX = point.x - transform.x
  const translatedY = point.y - transform.y
  return {
    x: translatedX * Math.cos(radians) - translatedY * Math.sin(radians) + anchor.x,
    y: translatedX * Math.sin(radians) + translatedY * Math.cos(radians) + anchor.y,
  }
}