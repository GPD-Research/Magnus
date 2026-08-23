import { describe, expect, it } from 'vitest'
import { nearestRoadPlacement, roadRelativePlacement, roadSectionTransform, selectableRoadSections } from './roadSection'
import type { RoadFeature, RoadScene } from './roadScene'

const scene: RoadScene = {
  version: 1,
  source: { type: 'osm-api', dataset: 'Mixing Bowl', generatedAt: 'live', attribution: 'OSM' },
  coordinateSystem: {
    worldCrs: 'LOCAL_ENU_FT_FROM_EPSG:4326',
    displayUnits: 'feet',
    origin: 'top-left',
    trafficFlow: 'bottom-to-top',
  },
  viewport: { width: 500, height: 500 },
  features: [
    {
      id: 'way-170-casing',
      kind: 'road-casing',
      layer: 2,
      geometry: { type: 'LineString', coordinates: [[100, 400], [200, 300]] },
      properties: { osmId: 170, highway: 'motorway_link', renderWidthFeet: 20 },
    },
    {
      id: 'way-170-surface',
      kind: 'road-surface',
      layer: 2,
      geometry: { type: 'LineString', coordinates: [[100, 400], [200, 300]] },
      properties: { osmId: 170, highway: 'motorway_link', renderWidthFeet: 12 },
    },
  ],
}

describe('road section selection', () => {
  it('offers each rendered road surface once without its casing', () => {
    expect(selectableRoadSections(scene).map((feature) => feature.id)).toEqual([
      'way-170-surface',
    ])
  })

  it('centers and aligns scene equipment with the selected road tangent', () => {
    expect(roadSectionTransform(scene.features[1])).toEqual({
      x: 150,
      y: 350,
      rotation: 45,
    })
    expect(roadSectionTransform(scene.features[0])).toBeNull()
  })

  it('projects placement onto the nearest roadway segment and follows its tangent', () => {
    expect(nearestRoadPlacement(scene, { x: 180, y: 360 })).toEqual({
      featureId: 'way-170-surface',
      x: 160,
      y: 340,
      rotation: 45,
      distance: Math.sqrt(800),
      lanes: 3,
    })
  })

  it('places longitudinal and lateral offsets against each local road tangent', () => {
    const curvedRoad: RoadFeature = {
      ...scene.features[1],
      geometry: {
        type: 'LineString',
        coordinates: [[100, 400], [100, 300], [120, 200], [180, 120]],
      },
    }

    expect(roadRelativePlacement(curvedRoad, { x: 100, y: 300 }, 40, 12)).toMatchObject({
      x: 112,
      y: 340,
      rotation: 0,
    })
    const curvedPlacement = roadRelativePlacement(curvedRoad, { x: 100, y: 300 }, -140, 12)
    expect(curvedPlacement?.rotation).toBeCloseTo(36.87, 2)
    expect(curvedPlacement?.x).toBeCloseTo(152.41, 2)
    expect(curvedPlacement?.y).toBeCloseTo(176.784, 3)
    expect(roadRelativePlacement(curvedRoad, { x: 100, y: 300 }, -400, 0)).toMatchObject({
      rotation: 36.86989764584402,
    })
    expect(roadRelativePlacement(curvedRoad, { x: 100, y: 300 }, -400, 0)?.y).toBeLessThan(120)
  })
})