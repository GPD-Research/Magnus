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
      </defs>
      <rect width={scene.viewport.width} height={scene.viewport.height} fill="#202728" />
      {orderedFeatures.map((feature) => {
        const selectable = selectionEnabled
          && feature.kind === 'road-surface'
          && feature.geometry.type === 'LineString'
        return (
        <path
          aria-label={selectable ? feature.properties.name ?? `Road section ${feature.properties.osmId ?? feature.id}` : undefined}
          className={`road-feature road-feature-${feature.kind}${selectable ? ' section-selectable' : ''}${selectedFeatureId === feature.id ? ' section-selected' : ''}`}
          d={featurePath(feature)}
          id={feature.id}
          data-layer={feature.layer}
          data-geometry-type={feature.geometry.type}
          data-osm-id={feature.properties.osmId}
          key={feature.id}
          onClick={selectable ? (event) => { event.stopPropagation(); onSelectFeature?.(feature) } : undefined}
          onKeyDown={selectable ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') onSelectFeature?.(feature)
          } : undefined}
          role={selectable ? 'button' : undefined}
          strokeWidth={feature.properties.renderWidthFeet}
          strokeDasharray={feature.kind === 'skip-line'
            ? `${ROADWAY_DIMENSIONS_FEET.skipStripeLength} ${ROADWAY_DIMENSIONS_FEET.skipGapLength}`
            : undefined}
          tabIndex={selectable ? 0 : undefined}
        />
        )
      })}
      {visibility.trafficFlow && (
        <>
          <text className="flow-label" x="5" y="28">DOWNSTREAM</text>
          <text className="flow-label" x="7" y="742">UPSTREAM</text>
        </>
      )}
    </g>
  )
}