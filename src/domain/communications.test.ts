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
    const { messages } = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, agencies: ['vsp', 'fire'] })
    expect(messages[2].text).toBe('Show me on scene at northbound exit 155 in the main lanes blocking the right lane with an accident. Fire department and VSP on scene.')
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
      { channel: 'TOC', text: 'Please respond to an accident blocking the right lane at northbound exit 155 in the main lanes.' },
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
    const fire = advanceCommunications(first.state, { ...scene, agencies: ['vsp', 'fire'] })
    expect(fire.messages[0].text).toBe('SSP970 to 95 Control, fire now on scene.')
    const gone = advanceCommunications(fire.state, { ...scene, agencies: ['vsp'] })
    expect(gone.messages[0].text).toBe('SSP970 to 95 Control, fire has departed.')
    const tree = advanceCommunications(gone.state, { ...scene, agencies: ['vsp', 'tree-removal'] })
    expect(tree.messages[0].text).toBe('SSP970 to 95 Control, tree removal workers on scene.')
    const clear = advanceCommunications(tree.state, { ...scene, sspOnScene: false })
    expect(clear.messages).toEqual([
      { channel: 'SSP', text: "SSP970 to 95 Control, scene clear, I'm clear." },
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

describe('footprint-based call-outs', () => {
  const car = (lanes: number[], shoulders: ('left' | 'right')[] = []) =>
    ({ kind: 'vehicle' as const, noun: ['car', 'cars'] as [string, string], lanes, shoulders })
  const tree = (lanes: number[], shoulders: ('left' | 'right')[]) =>
    ({ kind: 'tree' as const, noun: ['downed tree', 'downed trees'] as [string, string], lanes, shoulders })
  const callOut = (overrides: Partial<CommunicationsScene>) =>
    advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, hazards: NO_HAZARDS, ...overrides }).messages

  it('reports a shoulder-only car without "blocking" and skips the VSP request', () => {
    const messages = callOut({ sceneHazards: [car([], ['right'])] })
    expect(messages[2].text).toBe("Show me out at northbound exit 155 in the main lanes on the right shoulder with a car. I'll advise.")
    expect(messages[3].text).toBe('Copy.')
  })

  it('names only the travel lanes when a car overlaps a lane and a shoulder', () => {
    expect(callOut({ sceneHazards: [car([2], ['right'])] })[2].text)
      .toBe("Show me out at northbound exit 155 in the main lanes with a car blocking the right lane. I'll advise. Send VSP.")
    expect(callOut({ sceneHazards: [car([0], ['left'])] })[2].text)
      .toContain('with a car blocking the left lane.')
    expect(callOut({ sceneHazards: [car([1, 2])] })[2].text)
      .toContain('with a car blocking the center and right lanes.')
  })

  it('counts and lists objects and keeps the shoulder for a downed tree', () => {
    const trailer = { kind: 'vehicle' as const, noun: ['tractor trailer', 'tractor trailers'] as [string, string], lanes: [], shoulders: ['right' as const] }
    expect(callOut({ sceneHazards: [car([], ['right']), car([], ['right']), trailer], agencies: ['ems', 'fire'] })[2].text)
      .toBe('Show me out at northbound exit 155 in the main lanes on the right shoulder with two cars and a tractor trailer. EMS and fire department on scene.')
    expect(callOut({ sceneHazards: [tree([2], ['right'])] })[2].text)
      .toContain('with a downed tree blocking the right lane and the right shoulder.')
  })

  it('sends the crash/disabled finding as a later update, once per change', () => {
    const onScene = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, hazards: NO_HAZARDS, sceneHazards: [car([2])] })
    const disabled = advanceCommunications(onScene.state, { ...scene, hazards: NO_HAZARDS, sceneHazards: [car([2])], incidentNature: 'disabled' })
    expect(disabled.messages).toEqual([
      { channel: 'SSP', text: 'SSP970 to 95 Control, vehicle is disabled.' },
      { channel: 'TOC', text: 'Copy.' },
    ])
    expect(advanceCommunications(disabled.state, { ...scene, hazards: NO_HAZARDS, sceneHazards: [car([2])], incidentNature: 'disabled' }).messages).toEqual([])
    const crash = advanceCommunications(disabled.state, { ...scene, hazards: NO_HAZARDS, sceneHazards: [car([2]), car([1])], incidentNature: 'accident' })
    expect(crash.messages[0].text).toBe('SSP970 to 95 Control, vehicles were in a crash.')
  })

  it('phrases the TOC dispatch from the same footprint data', () => {
    const messages = callOut({ mode: 'toc-dispatched', sspOnScene: false, sceneHazards: [car([2])] })
    expect(messages[2].text).toBe('Please respond to a car blocking the right lane at northbound exit 155 in the main lanes.')
  })

  it('lets TOC name the finding at dispatch and then skips the SSP update', () => {
    const known = (hazards: ReturnType<typeof car>[], nature: 'accident' | 'disabled') =>
      callOut({ mode: 'toc-dispatched', sspOnScene: false, sceneHazards: hazards, incidentNature: nature, natureSource: 'toc-dispatch' })
    expect(known([car([2])], 'accident')[2].text).toBe('Please respond to a blocking accident at northbound exit 155 in the main lanes.')
    expect(known([car([], ['right'])], 'disabled')[2].text).toBe('Please respond to a disabled car on the right shoulder at northbound exit 155 in the main lanes.')
    expect(known([car([], ['right'])], 'accident')[2].text).toBe('Please respond to an accident on the right shoulder at northbound exit 155 in the main lanes.')
    const dispatched = advanceCommunications(INITIAL_COMMUNICATIONS_STATE, { ...scene, hazards: NO_HAZARDS, mode: 'toc-dispatched', sspOnScene: false, sceneHazards: [car([2])], incidentNature: 'accident', natureSource: 'toc-dispatch' })
    const arrived = advanceCommunications(dispatched.state, { ...scene, hazards: NO_HAZARDS, mode: 'toc-dispatched', sceneHazards: [car([2])], incidentNature: 'accident', natureSource: 'toc-dispatch' })
    expect(arrived.messages.map((message) => message.text)).not.toContainEqual(expect.stringContaining('crash'))
  })
})
