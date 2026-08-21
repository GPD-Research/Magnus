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

export function RoadwayLayer({
  scene,
  visibility,
  selectionEnabled = false,
  selectedFeatureId,
  onSelectFeature,
}: RoadwayLayerProps) {
  const orderedFeatures = scene.features
    .filter((feature) => visibility[roadLayerForFeature(feature)])
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
      <rect width={scene.viewport.width} height={scene.viewport.height} fill="#202728" />
      {orderedFeatures.map((feature) => {
        const selectable = selectionEnabled
          && feature.kind === 'road-surface'
          && feature.geometry.type === 'LineString'
        const selected = selectedFeatureId === feature.id
        const label = feature.properties.name ?? `${feature.properties.highway?.replaceAll('_', ' ') ?? 'Road'} section ${feature.properties.osmId ?? feature.id}`
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
              strokeWidth={feature.properties.renderWidthFeet}
              strokeDasharray={feature.kind === 'skip-line'
                ? `${ROADWAY_DIMENSIONS_FEET.skipStripeLength} ${ROADWAY_DIMENSIONS_FEET.skipGapLength}`
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