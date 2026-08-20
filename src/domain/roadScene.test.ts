import { describe, expect, it } from 'vitest'
import { createDevelopmentRoadScene } from './roadScene'

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

    expect(rightSkip?.geometry.coordinates[0]?.[0]).toBe(270)
    expect(rightFog?.geometry.coordinates[0]?.[0]).toBe(390)
  })
})