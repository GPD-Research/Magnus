import { describe, expect, it } from 'vitest'
import { createReferenceRoadScene } from './roadScene'
import { DEFAULT_TOC_INCIDENT_DETAILS } from './communications'
import { createPortableScenario, parsePortableScenario, type PortableScenarioState } from './scenarioFile'

const state: PortableScenarioState = {
  scenario: 'right-lane',
  sceneVisible: true,
  sceneOrigin: { x: 10, y: 20 },
  sceneRotation: 12,
  mapRotation: 45,
  mode: 'gospel',
  laneCount: 3,
  points: [],
  trucks: [],
  deployedEquipment: [],
  drawingStrokes: [{ id: 'stroke-1', points: [{ x: 10, y: 20 }, { x: 20, y: 30 }], color: '#ffffff', widthFeet: 4, createdAt: 1, persistence: 'persistent' }],
  radioEvents: [],
  incidentType: 'crash',
  tocIncidentDetails: DEFAULT_TOC_INCIDENT_DETAILS,
  roadScene: createReferenceRoadScene(),
  locationRequest: { highway: 'I-95', direction: 'northbound', referenceType: 'exit', reference: '166A' },
  resolvedLocation: null,
  roadLayerVisibility: { roadGeometry: true, barriers: true, trafficFlow: true, highwayLabels: true, drawings: true },
  sceneZoom: 1.25,
}

describe('portable scenario files', () => {
  it('round trips reconstructable Version 2 scene state', () => {
    const document = createPortableScenario(state, '5.0.0', '2026-08-20T00:00:00.000Z')
    expect(parsePortableScenario(JSON.stringify(document))).toEqual(document)
  })

  it('defaults Version 2 files saved before view rotation to north-up', () => {
    const document = createPortableScenario(state, '5.0.0', '2026-08-20T00:00:00.000Z')
    const serialized = JSON.stringify({ ...document, state: { ...document.state, mapRotation: undefined } })
    expect(parsePortableScenario(serialized).state.mapRotation).toBe(0)
  })

  it('defaults truck direction and asset type in older Version 2 files', () => {
    const document = createPortableScenario({ ...state, trucks: [{ id: 'ssp-truck-1', label: 'SSP Truck 1', x: 1, y: 2, rotation: 0, assetType: 'ssp-truck', signboard: 'left-arrow' }] }, '5.0.0')
    const legacyTruck = { ...document.state.trucks[0], rotation: undefined, assetType: undefined }
    const parsed = parsePortableScenario(JSON.stringify({ ...document, state: { ...document.state, trucks: [legacyTruck] } }))
    expect(parsed.state.trucks[0]).toMatchObject({ rotation: 0, assetType: 'ssp-truck' })
  })

  it('defaults files saved before drawing support to an empty visible drawing layer', () => {
    const document = createPortableScenario(state, '5.0.0', '2026-08-20T00:00:00.000Z')
    const serialized = JSON.stringify({
      ...document,
      state: {
        ...document.state,
        drawingStrokes: undefined,
        roadLayerVisibility: { ...document.state.roadLayerVisibility, drawings: undefined },
      },
    })

    expect(parsePortableScenario(serialized).state.drawingStrokes).toEqual([])
    expect(parsePortableScenario(serialized).state.roadLayerVisibility.drawings).toBe(true)
  })

  it('defaults files saved before incident selection to crash', () => {
    const document = createPortableScenario(state, '5.0.0', '2026-08-20T00:00:00.000Z')
    const serialized = JSON.stringify({ ...document, state: { ...document.state, incidentType: undefined } })

    expect(parsePortableScenario(serialized).state.incidentType).toBe('crash')
    expect(parsePortableScenario(serialized).state.tocIncidentDetails).toEqual(DEFAULT_TOC_INCIDENT_DETAILS)
  })

  it('migrates release-candidate reference geometry labels', () => {
    const document = createPortableScenario(state, '5.0.0-rc.1')
    const legacyScene = {
      ...document.state.roadScene,
      source: { ...document.state.roadScene.source, type: 'development-fixture' },
    }
    const serialized = JSON.stringify({
      ...document,
      state: {
        ...document.state,
        roadScene: legacyScene,
        resolvedLocation: {
          request: document.state.locationRequest,
          scene: legacyScene,
          source: 'development-preview',
          message: 'Legacy fallback',
        },
      },
    })

    const parsed = parsePortableScenario(serialized).state
    expect(parsed.roadScene.source.type).toBe('reference-layout')
    expect(parsed.resolvedLocation?.source).toBe('reference-layout')
    expect(parsed.resolvedLocation?.scene.source.type).toBe('reference-layout')
  })

  it('rejects unsupported and incomplete files', () => {
    expect(() => parsePortableScenario('{"version":1}')).toThrow('Unsupported Magnus scene file')
    expect(() => parsePortableScenario('{"kind":"magnus-scene","version":2,"state":{}}')).toThrow('incomplete')
  })
})