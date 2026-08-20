import type { LineGeometry, RoadFeature, RoadScene } from './roadScene'

export interface RoadSectionTransform {
  x: number
  y: number
  rotation: number
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