import type { LineGeometry, RoadFeature, RoadScene } from './roadScene'

export interface RoadSectionTransform {
  x: number
  y: number
  rotation: number
}

export interface RoadPlacement extends RoadSectionTransform {
  featureId: string
  distance: number
  lanes: number
}

export function selectableRoadSections(scene: RoadScene): RoadFeature[] {
  return scene.features.filter(
    (feature) => feature.kind === 'road-surface' && feature.geometry.type === 'LineString',
  )
}

export function roadSectionLabel(feature: RoadFeature): string {
  const name = feature.properties.name?.trim()
  const normalizedName = name === '' ? undefined : name
  const roadType = feature.properties.highway?.replaceAll('_', ' ')
  const identifier = feature.properties.osmId ? `OSM ${feature.properties.osmId}` : feature.id
  return [normalizedName ?? roadType ?? 'Road section', `layer ${feature.layer}`, identifier].join(' · ')
}

export function roadSectionTransform(feature: RoadFeature): RoadSectionTransform | null {
  if (feature.kind !== 'road-surface' || feature.geometry.type !== 'LineString') return null
  return centerSegmentTransform(feature.geometry)
}

export function nearestRoadPlacement(
  scene: RoadScene,
  point: { x: number; y: number },
): RoadPlacement | null {
  let nearest: RoadPlacement | null = null
  for (const feature of selectableRoadSections(scene)) {
    if (feature.geometry.type !== 'LineString') continue
    for (let index = 0; index < feature.geometry.coordinates.length - 1; index += 1) {
      const start = feature.geometry.coordinates[index]
      const end = feature.geometry.coordinates[index + 1]
      if (!start || !end) continue
      const deltaX = end[0] - start[0]
      const deltaY = end[1] - start[1]
      const lengthSquared = deltaX * deltaX + deltaY * deltaY
      if (lengthSquared === 0) continue
      const progress = Math.max(0, Math.min(1,
        ((point.x - start[0]) * deltaX + (point.y - start[1]) * deltaY) / lengthSquared,
      ))
      const x = start[0] + deltaX * progress
      const y = start[1] + deltaY * progress
      const distance = Math.hypot(point.x - x, point.y - y)
      if (!nearest || distance < nearest.distance) {
        nearest = {
          featureId: feature.id,
          x,
          y,
          rotation: Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 90,
          distance,
          lanes: feature.properties.lanes ?? 3,
        }
      }
    }
  }
  return nearest
}

function centerSegmentTransform(geometry: LineGeometry): RoadSectionTransform | null {
  if (geometry.coordinates.length < 2) return null
  const centerIndex = Math.floor((geometry.coordinates.length - 1) / 2)
  const start = geometry.coordinates[centerIndex]
  const end = geometry.coordinates[centerIndex + 1]
  if (!start || !end) return null
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]

  return {
    x: (start[0] + end[0]) / 2,
    y: (start[1] + end[1]) / 2,
    rotation: Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 90,
  }
}