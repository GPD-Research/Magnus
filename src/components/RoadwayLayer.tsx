import type { LineGeometry, PolygonGeometry, RoadFeature, RoadScene } from '../domain/roadScene'

interface RoadwayLayerProps {
  scene: RoadScene
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

export function RoadwayLayer({ scene }: RoadwayLayerProps) {
  const orderedFeatures = [...scene.features].sort((first, second) => first.layer - second.layer)

  return (
    <g className="roadway-data-layer" data-source-type={scene.source.type}>
      <defs>
        <pattern id="roadSurfacePattern" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill="#343b3d" />
          <circle cx="4" cy="5" r="0.55" fill="#485052" opacity=".45" />
          <circle cx="14" cy="12" r="0.45" fill="#202628" opacity=".55" />
        </pattern>
        <marker id="flowArrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M 7 3.5 L 0 0 L 0 7 Z" fill="#dce3da" />
        </marker>
      </defs>
      <rect width={scene.viewport.width} height={scene.viewport.height} fill="#202728" />
      {orderedFeatures.map((feature) => (
        <path
          className={`road-feature road-feature-${feature.kind}`}
          d={featurePath(feature)}
          data-layer={feature.layer}
          data-geometry-type={feature.geometry.type}
          data-osm-id={feature.properties.osmId}
          key={feature.id}
          strokeWidth={feature.properties.renderWidthFeet}
        />
      ))}
      <text className="flow-label" x="42" y="28">DOWNSTREAM</text>
      <text className="flow-label" x="46" y="742">UPSTREAM</text>
    </g>
  )
}