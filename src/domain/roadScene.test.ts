import { describe, expect, it } from 'vitest'
import {
  ROADWAY_DIMENSIONS_FEET,
  createDevelopmentRoadScene,
  roadLayerForFeature,
} from './roadScene'

describe('road scene IPC contract', () => {
  it('orders bottom-to-top roadway features by structural layer', () => {
    const scene = createDevelopmentRoadScene()
    const layers = [...scene.features].sort((first, second) => first.layer - second.layer)

    expect(scene.coordinateSystem.trafficFlow).toBe('bottom-to-top')
    expect(layers[0]?.kind).toBe('road-casing')
    expect(layers.at(-1)?.kind).toBe('traffic-flow')
  })

  it('keeps the blocked right lane between the skip and fog lines', () => {
    const scene = createDevelopmentRoadScene()
    const rightSkip = scene.features.find((feature) => feature.id === 'right-center-skip')
    const rightFog = scene.features.find((feature) => feature.id === 'right-fog-line')

    expect(rightSkip?.geometry.type).toBe('LineString')
    expect(rightFog?.geometry.type).toBe('LineString')
    if (rightSkip?.geometry.type !== 'LineString' || rightFog?.geometry.type !== 'LineString') {
      throw new Error('Lane boundaries must be line geometry')
    }
    expect(rightSkip?.geometry.coordinates[0]?.[0]).toBe(42)
    expect(rightFog?.geometry.coordinates[0]?.[0]).toBe(54)
    expect(
      (rightFog?.geometry.coordinates[0]?.[0] ?? 0) -
        (rightSkip?.geometry.coordinates[0]?.[0] ?? 0),
    ).toBe(ROADWAY_DIMENSIONS_FEET.laneWidth)
  })

  it('uses one scene unit per foot for standard highway dimensions', () => {
    const scene = createDevelopmentRoadScene()
    const skipLines = scene.features.filter((feature) => feature.kind === 'skip-line')

    expect(scene.viewport).toEqual({ width: 72, height: 760 })
    expect(ROADWAY_DIMENSIONS_FEET).toMatchObject({
      laneWidth: 12,
      skipStripeLength: 10,
      skipGapLength: 30,
    })
    expect(skipLines.every((line) => line.properties.renderWidthFeet === 0.5)).toBe(true)
  })

  it('classifies rendered features into configurable map layers', () => {
    const scene = createDevelopmentRoadScene()
    const layers = Object.fromEntries(
      scene.features.map((feature) => [feature.id, roadLayerForFeature(feature)]),
    )

    expect(layers['mainline-surface']).toBe('roadGeometry')
    expect(layers['right-shoulder-edge']).toBe('barriers')
    expect(layers['flow-vector-center']).toBe('trafficFlow')
  })
})