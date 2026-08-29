import {
  ROADWAY_DIMENSIONS_FEET,
  roadLayerForFeature,
  type LineGeometry,
  type PolygonGeometry,
  type RoadFeature,
  type RoadLayerVisibility,
  type RoadScene,
} from '../domain/roadScene'

interface RoadwayLayerProps {
  scene: RoadScene
  visibility: RoadLayerVisibility
  selectionEnabled?: boolean
  selectedFeatureId?: string | null
  onSelectFeature?: (feature: RoadFeature) => void
}

function linePath(geometry: LineGeometry): string {
  return geometry.coordinates
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ')
}

function polygonPath(geometry: PolygonGeometry): string {
  return geometry.coordinates
    .map((ring) => `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`)
    .join(' ')
}

function featurePath(feature: RoadFeature): string {
  return feature.geometry.type === 'Polygon'
    ? polygonPath(feature.geometry)
    : linePath(feature.geometry)
}

function featureMidpoint(feature: RoadFeature): readonly [number, number] {
  const points = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates
  if (points.length === 0) return [0, 0]
  if (feature.geometry.type === 'Polygon') {
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }
  const segmentLengths = points.slice(1).map(([x, y], index) => Math.hypot(x - points[index][0], y - points[index][1]))
  const halfway = segmentLengths.reduce((sum, length) => sum + length, 0) / 2
  let travelled = 0
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index]
    if (travelled + length >= halfway) {
      const ratio = length === 0 ? 0 : (halfway - travelled) / length
      return [
        points[index][0] + (points[index + 1][0] - points[index][0]) * ratio,
        points[index][1] + (points[index + 1][1] - points[index][1]) * ratio,
      ]
    }
    travelled += length
  }
  return points.at(-1) ?? [0, 0]
}

function labelAnchor(feature: RoadFeature, focus: { x: number; y: number }): readonly [number, number] {
  const points = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates[0]
    : feature.geometry.coordinates
  if (points.length === 0) return [focus.x, focus.y]
  if (feature.geometry.type === 'Polygon') {
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    return [
      Math.min(Math.max(focus.x, Math.min(...xs)), Math.max(...xs)),
      Math.min(Math.max(focus.y - 35, Math.min(...ys)), Math.max(...ys)),
    ]
  }
  let nearest = featureMidpoint(feature)
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index += 1) {
    const [startX, startY] = points[index]
    const [endX, endY] = points[index + 1]
    const deltaX = endX - startX
    const deltaY = endY - startY
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    const ratio = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
      ((focus.x - startX) * deltaX + (focus.y - startY) * deltaY) / lengthSquared,
    ))
    const candidate: readonly [number, number] = [startX + deltaX * ratio, startY + deltaY * ratio]
    const distance = Math.hypot(focus.x - candidate[0], focus.y - candidate[1])
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return [nearest[0], nearest[1] - 24]
}

function roadwayLabel(feature: RoadFeature): string | null {
  const properties = feature.properties
  const formatReference = (value: string) => value.split(';').map((part) => part.trim()).filter(Boolean).join(' / ')
  const exit = properties.junctionReference ? `Exit ${formatReference(properties.junctionReference)}` : null
  const destination = properties.destinationReference ? `to ${formatReference(properties.destinationReference)}` : null
  const primary = properties.reference ? formatReference(properties.reference) : properties.name
  return [primary, exit, destination].filter(Boolean).join(' · ') || null
}

function labelFeatures(scene: RoadScene, focus: { x: number; y: number }): RoadFeature[] {
  const nearestByLabel = new Map<string, { feature: RoadFeature; distance: number }>()
  for (const feature of scene.features) {
    const label = roadwayLabel(feature)
    if (feature.kind !== 'road-surface' || label === null) continue
    const [x, y] = labelAnchor(feature, focus)
    const distance = Math.hypot(focus.x - x, focus.y - y)
    const current = nearestByLabel.get(label)
    if (!current || distance < current.distance) nearestByLabel.set(label, { feature, distance })
  }
  return [...nearestByLabel.values()].map(({ feature }) => feature)
}

export function RoadwayLabels({
  scene,
  focus,
}: {
  scene: RoadScene
  focus: { x: number; y: number }
}) {
  return (
    <g className="roadway-label-layer" aria-label="Highway labels">
      {labelFeatures(scene, focus).map((feature) => {
        const [x, y] = labelAnchor(feature, focus)
        return <text className="roadway-label" x={x} y={y} key={`label-${feature.id}`} textAnchor="middle">{roadwayLabel(feature)}</text>
      })}
    </g>
  )
}

export function RoadwayLayer({
  scene,
  visibility,
  selectionEnabled = false,
  selectedFeatureId,
  onSelectFeature,
}: RoadwayLayerProps) {
  const orderedFeatures = scene.features
     .filter((feature) => feature.kind !== 'ramp-gore' && visibility[roadLayerForFeature(feature)])
    .sort((first, second) => first.layer - second.layer)

  return (
    <g className="roadway-data-layer" data-source-type={scene.source.type}>
      <defs>
        <pattern id="roadSurfacePattern" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#343b3d" />
          <circle cx="1.5" cy="2" r="0.18" fill="#485052" opacity=".45" />
          <circle cx="4.5" cy="4" r="0.15" fill="#202628" opacity=".55" />
        </pattern>
        <marker id="flowArrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M 7 3.5 L 0 0 L 0 7 Z" fill="#dce3da" />
        </marker>
        <marker id="mergeArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M 8 4 L 0 0.5 L 2.2 4 L 0 7.5 Z" fill="#f5f6ee" />
        </marker>
        <pattern id="goreStripePattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <rect width="4" height="8" fill="#f5f6ee" />
          <rect x="4" width="4" height="8" fill="#343b3d" />
        </pattern>
      </defs>
      <rect width={scene.viewport.width} height={scene.viewport.height} fill="#56624d" />
      {orderedFeatures.map((feature) => {
        const selectable = selectionEnabled
          && feature.kind === 'road-surface'
          && feature.geometry.type === 'LineString'
        const selected = selectedFeatureId === feature.id
        const isElevated = feature.properties.bridge === true || feature.layer > 0
        const label = feature.properties.name ?? `${feature.properties.highway?.replaceAll('_', ' ') ?? 'Road'} section ${feature.properties.osmId ?? feature.id}`
        const baseStrokeWidth = feature.properties.renderWidthFeet ?? 0
        const displayOpacity = isElevated && feature.kind === 'road-surface' ? 0.62 : 1
        const displayStroke = isElevated && feature.kind === 'road-surface' ? '#7c8b88' : undefined
        return (
          <g className={`road-feature-group${selectable ? ' section-selectable' : ''}`} key={feature.id}>
            <path
              className={`road-feature road-feature-${feature.kind}${selected ? ' section-selected' : ''}`}
              d={featurePath(feature)}
              id={feature.id}
              data-bridge={feature.properties.bridge}
              data-highway={feature.properties.highway}
              data-layer={feature.layer}
              data-geometry-type={feature.geometry.type}
              data-osm-id={feature.properties.osmId}
              strokeWidth={baseStrokeWidth}
              style={{
                strokeWidth: baseStrokeWidth,
                opacity: displayOpacity,
                stroke: displayStroke,
              }}
              strokeDasharray={feature.kind === 'skip-line'
                ? `${ROADWAY_DIMENSIONS_FEET.skipStripeLength} ${ROADWAY_DIMENSIONS_FEET.skipGapLength}`
                : feature.kind === 'auxiliary-lane-line'
                  ? `${ROADWAY_DIMENSIONS_FEET.auxiliaryStripeLength} ${ROADWAY_DIMENSIONS_FEET.auxiliaryGapLength}`
                  : undefined}
            />
            {selectable && (
              <path
                aria-label={label}
                className="road-section-hit-area"
                d={featurePath(feature)}
                onClick={(event) => { event.stopPropagation(); onSelectFeature?.(feature) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectFeature?.(feature)
                  }
                }}
                role="button"
                strokeWidth={Math.max(feature.properties.renderWidthFeet ?? 0, 24)}
                tabIndex={0}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}