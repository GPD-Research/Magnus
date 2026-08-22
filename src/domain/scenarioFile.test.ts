import { describe, expect, it } from 'vitest'
import { createDevelopmentRoadScene } from './roadScene'
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
  radioEvents: [],
  roadScene: createDevelopmentRoadScene(),
  locationRequest: { highway: 'I-95', direction: 'northbound', referenceType: 'exit', reference: '166A' },
  resolvedLocation: null,
  roadLayerVisibility: { roadGeometry: true, barriers: true, trafficFlow: true, highwayLabels: true },
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

  it('rejects unsupported and incomplete files', () => {
    expect(() => parsePortableScenario('{"version":1}')).toThrow('Unsupported Magnus scene file')
    expect(() => parsePortableScenario('{"kind":"magnus-scene","version":2,"state":{}}')).toThrow('incomplete')
  })
})