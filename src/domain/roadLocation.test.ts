import { describe, expect, it } from 'vitest'
import {
  createLocationPreviewScene,
  normalizeHighway,
  resolveRoadLocation,
  type RoadLocationRequest,
} from './roadLocation'

const request: RoadLocationRequest = {
  highway: 'I 95',
  direction: 'northbound',
  referenceType: 'exit',
  reference: '166',
}

describe('road location resolution', () => {
  it('normalizes human-friendly Virginia highway aliases', () => {
    expect(normalizeHighway('i 95')).toBe('I-95')
    expect(normalizeHighway('Rt 28')).toBe('Route 28')
  })

  it('creates a feet-based interchange preview with a 12 ft exit ramp', () => {
    const scene = createLocationPreviewScene(request)
    const ramp = scene.features.find((feature) => feature.id === 'preview-exit-ramp-surface')

    expect(scene.coordinateSystem.displayUnits).toBe('feet')
    expect(scene.viewport.width).toBe(122)
    expect(ramp?.properties.renderWidthFeet).toBe(12)
    expect(scene.source.dataset).toContain('I-95 Northbound Exit 166')
  })

  it('prefers a valid live map scene over preview geometry', async () => {
    const compiledScene = {
      ...createLocationPreviewScene(request),
      source: {
        type: 'osm-pbf' as const,
        dataset: 'nova-highways',
        generatedAt: '2026-08-20T00:00:00.000Z',
        attribution: 'OpenStreetMap contributors',
      },
    }

    let requestedPath = ''
    const result = await resolveRoadLocation(request, (path) => {
      requestedPath = path
      return Promise.resolve(compiledScene)
    })

    expect(result.source).toBe('live-map')
    expect(result.scene.source.type).toBe('osm-pbf')
    expect(requestedPath).toBe('/api/road-scenes/resolve?highway=I-95&direction=northbound&referenceType=exit&reference=166')
  })

  it('falls back explicitly when compiled geometry is unavailable', async () => {
    const result = await resolveRoadLocation(request, () => Promise.reject(new Error('missing')))

    expect(result.source).toBe('development-preview')
    expect(result.message).toContain('missing')
    expect(result.message).toContain('scale-accurate development preview')
  })

  it('provides a layered Mixing Bowl acceptance preview for I-95 northbound MM 170', () => {
    const scene = createLocationPreviewScene({
      highway: 'I-95',
      direction: 'northbound',
      referenceType: 'mile-marker',
      reference: '170',
    })

    expect(scene.viewport.width).toBe(220)
    expect(scene.features.filter((feature) => feature.kind === 'road-surface' && feature.layer > 0)).toHaveLength(2)
    expect(scene.features.some((feature) => feature.properties.name?.includes('Capital Beltway'))).toBe(true)
  })
})