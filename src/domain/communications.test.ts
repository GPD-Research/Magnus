import { describe, expect, it } from 'vitest'
import {
  INITIAL_COMMUNICATIONS_STATE,
  NO_HAZARDS,
  advanceCommunications,
  controllerFor,
  incidentPhrase,
  type CommunicationsScene,
} from './communications'

const scene: CommunicationsScene = {
  unit: 'SSP970',
  mode: 'ssp-discovered',
  highway: 'I-95',
  direction: 'northbound',
  referenceType: 'exit',
  reference: '155',
  scenario: 'right-lane',
  travelLanes: 3,
  sspOnScene: true,
  hazards: { ...NO_HAZARDS, crashedVehicles: 1 },
  agencies: [],
}

describe('controllerFor', () => {
  it('splits I-95 between 95 Control and Stafford Control at exit 148', () => {
    expect(controllerFor('I-95', '155')).toBe('95 Control')
    expect(controllerFor('I-95', '148')).toBe('95 Control')
    expect(controllerFor('I-95', '147.5')).toBe('Stafford Control')
    expect(controllerFor('I-95', '130')).toBe('Stafford Control')
  })

  it('uses a single controller per route elsewhere and falls back on the route number', () => {
    expect(controllerFor('I-66', '52')).toBe('66 Control')
    expect(controllerFor('I-495', '177')).toBe('495 Control')
    expect(controllerFor('I-395', '')).toBe('395 Control')
    expect(controllerFor('Route 7', '12')).toBe('7 Control')
  })
})

describe('advanceCommunications', () => {
  it('stays silent until an SSP truck and a reportable hazard are both on scene', () => {
    expect(advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, hazards: NO_HAZARDS }).messages).toEqual([])
    expect(advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, sspOnScene: false }).messages).toEqual([])
  })

  it('builds the SSP-discovered call-out with a VSP request off the shoulder', () => {
    const { state, messages } = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, scene)
    expect(messages).toEqual([
      { channel: 'SSP', text: 'SSP970 to 95 Control?' },
      { channel: 'TOC', text: 'SSP970, go ahead.' },
      { channel: 'SSP', text: "Show me on scene at northbound exit 155 in the main lanes blocking the right lane with an accident. I'll advise. Send VSP." },
      { channel: 'TOC', text: 'Copy. VSP en route.' },
    ])
    expect(state).toEqual({ phase: 'on-scene', agencies: [] })
  })

  it('folds agencies already drawn into the call-out and skips the VSP request', () => {
    const { messages } = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, agencies: ['vsp', 'fire-rescue'] })
    expect(messages[2].text).toBe('Show me on scene at northbound exit 155 in the main lanes blocking the right lane with an accident. Fire and rescue plus VSP already on scene.')
    expect(messages[3].text).toBe('Copy.')
  })

  it('does not request VSP for a shoulder scene', () => {
    const { messages } = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, scenario: 'shoulder', hazards: { ...NO_HAZARDS, disabledVehicles: 1 } })
    expect(messages[2].text).toBe("Show me on scene at northbound exit 155 in the main lanes on the right shoulder with a disabled vehicle. I'll advise.")
    expect(messages[3].text).toBe('Copy.')
  })

  it('opens from TOC when dispatched, then continues as discovered once on scene', () => {
    const dispatched = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, mode: 'toc-dispatched', sspOnScene: false })
    expect(dispatched.messages).toEqual([
      { channel: 'TOC', text: '95 Control to SSP970?' },
      { channel: 'SSP', text: 'SSP970.' },
      { channel: 'TOC', text: 'I show an accident blocking the right lane at northbound exit 155 in the main lanes.' },
      { channel: 'SSP', text: 'Show me en route.' },
    ])
    expect(dispatched.state.phase).toBe('dispatched')
    const arrived = advanceCommunications(dispatched.state, { ...scene, mode: 'toc-dispatched' })
    expect(arrived.messages[0].text).toBe('SSP970 to 95 Control?')
    expect(arrived.messages).toHaveLength(4)
  })

  it('reports agencies on first arrival and last departure only, then clears', () => {
    const onScene = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, scene).state
    const first = advanceCommunications(onScene, { ...scene, agencies: ['vsp'] })
    expect(first.messages).toEqual([
      { channel: 'SSP', text: 'SSP970 to 95 Control, VSP now on scene.' },
      { channel: 'TOC', text: 'Copy.' },
    ])
    expect(advanceCommunications(first.state, { ...scene, agencies: ['vsp'] }).messages).toEqual([])
    const fire = advanceCommunications(first.state, { ...scene, agencies: ['vsp', 'fire-rescue'] })
    expect(fire.messages[0].text).toBe('SSP970 to 95 Control, fire and rescue now on scene.')
    const gone = advanceCommunications(fire.state, { ...scene, agencies: ['vsp'] })
    expect(gone.messages[0].text).toBe('SSP970 to 95 Control, fire and rescue have cleared.')
    const tree = advanceCommunications(gone.state, { ...scene, agencies: ['vsp', 'tree-removal'] })
    expect(tree.messages[0].text).toBe('SSP970 to 95 Control, tree removal workers on scene.')
    const clear = advanceCommunications(tree.state, { ...scene, sspOnScene: false })
    expect(clear.messages).toEqual([
      { channel: 'SSP', text: 'SSP970 to 95 Control, show me clear.' },
      { channel: 'TOC', text: 'Copy.' },
    ])
    expect(clear.state.phase).toBe('cleared')
  })

  it('uses the configured unit and Stafford Control south of exit 148', () => {
    const { messages } = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, unit: 'IMC601', reference: '133' })
    expect(messages[0].text).toBe('IMC601 to Stafford Control?')
    expect(messages[1].text).toBe('IMC601, go ahead.')
  })
})

describe('incidentPhrase', () => {
  it('describes the mix of reportable hazards', () => {
    expect(incidentPhrase({ ...NO_HAZARDS, crashedVehicles: 3 })).toBe('an accident involving 3 vehicles')
    expect(incidentPhrase({ ...NO_HAZARDS, tractorTrailerFires: 1 })).toBe('a tractor-trailer fire')
    expect(incidentPhrase({ ...NO_HAZARDS, debris: 2, downedTrees: 1 })).toBe('debris and a downed tree')
    expect(incidentPhrase({ ...NO_HAZARDS, crashedVehicles: 1, disabledVehicles: 1, vehicleFires: 1 })).toBe('an accident, a disabled vehicle and a vehicle fire')
  })
})
