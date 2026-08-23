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

export interface RoadRelativePlacement extends RoadSectionTransform {
  distanceAlongRoad: number
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

export function roadRelativePlacement(
  feature: RoadFeature,
  anchor: { x: number; y: number },
  longitudinalOffset: number,
  lateralOffset: number,
): RoadRelativePlacement | null {
  if (feature.kind !== 'road-surface' || feature.geometry.type !== 'LineString') return null
  const segments = feature.geometry.coordinates.slice(0, -1).flatMap((start, index) => {
    const end = feature.geometry.type === 'LineString' ? feature.geometry.coordinates[index + 1] : undefined
    if (!end) return []
    const deltaX = end[0] - start[0]
    const deltaY = end[1] - start[1]
    const length = Math.hypot(deltaX, deltaY)
    return length > 0 ? [{ start, end, deltaX, deltaY, length }] : []
  })
  if (segments.length === 0) return null

  let cumulativeLength = 0
  let anchorDistance = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const segment of segments) {
    const progress = Math.max(0, Math.min(1,
      ((anchor.x - segment.start[0]) * segment.deltaX + (anchor.y - segment.start[1]) * segment.deltaY)
        / (segment.length * segment.length),
    ))
    const x = segment.start[0] + segment.deltaX * progress
    const y = segment.start[1] + segment.deltaY * progress
    const distance = Math.hypot(anchor.x - x, anchor.y - y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      anchorDistance = cumulativeLength + segment.length * progress
    }
    cumulativeLength += segment.length
  }

  const distanceAlongRoad = anchorDistance - longitudinalOffset
  let segmentStartDistance = 0
  let segment = segments[0]
  if (distanceAlongRoad > 0) {
    for (const candidate of segments) {
      segment = candidate
      if (distanceAlongRoad <= segmentStartDistance + candidate.length) break
      segmentStartDistance += candidate.length
    }
  }
  if (!segment) return null
  const progress = (distanceAlongRoad - segmentStartDistance) / segment.length
  const centerX = segment.start[0] + segment.deltaX * progress
  const centerY = segment.start[1] + segment.deltaY * progress
  const lateralX = -segment.deltaY / segment.length
  const lateralY = segment.deltaX / segment.length

  return {
    x: centerX + lateralX * lateralOffset,
    y: centerY + lateralY * lateralOffset,
    rotation: Math.atan2(segment.deltaY, segment.deltaX) * (180 / Math.PI) + 90,
    distanceAlongRoad,
  }
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