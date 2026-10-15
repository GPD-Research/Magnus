import { describe, expect, it } from 'vitest'
import { NO_HAZARDS, type CommunicationsScene } from './communications'
import { buildConversation, insertNode, moveNode, normalizeConversation, recordSceneChange, removeNode, updateNode } from './conversation'

const car = { kind: 'vehicle' as const, noun: ['car', 'cars'] as [string, string], lanes: [2], shoulders: [] }
const scene: CommunicationsScene = {
  unit: 'SSP970', mode: 'ssp-discovered', highway: 'I-95', direction: 'northbound', referenceType: 'exit', reference: '155',
  scenario: 'right-lane', travelLanes: 3, sspOnScene: true, hazards: NO_HAZARDS, sceneHazards: [car], agencies: [],
}
const texts = (nodes: { text: string }[]) => nodes.map((node) => node.text)

describe('buildConversation', () => {
  it('prefills the SSP-discovered skeleton with every acknowledgement as its own node', () => {
    const { conversation } = buildConversation(scene)
    expect(texts(conversation.nodes)).toEqual([
      'SSP970 to 95 Control?',
      'SSP970, go ahead.',
      "Show me out at northbound exit 155 in the main lanes with a car blocking the right lane. I'll advise. Send VSP.",
      'Copy. VSP en route.',
    ])
    expect(conversation.nodes.map((node) => node.kind)).toEqual(['hail', 'ack', 'report', 'ack'])
    expect(conversation.nodes.map((node) => node.order)).toEqual([0, 1, 2, 3])
  })

  it('prefills dispatch, arrival, SSP finding and agency arrivals in order', () => {
    const { conversation } = buildConversation({ ...scene, mode: 'toc-dispatched', incidentNature: 'disabled', natureSource: 'ssp-update', agencies: ['vsp', 'ems'], service: 'tire-change' })
    expect(texts(conversation.nodes)).toEqual([
      '95 Control to SSP970?',
      'SSP970.',
      'Please respond to a car blocking the right lane at northbound exit 155 in the main lanes. EMS and VSP already on scene.',
      'Show me en route.',
      'SSP970 to 95 Control?',
      'SSP970, go ahead.',
      'Show me on scene at northbound exit 155 in the main lanes with a car blocking the right lane. EMS and VSP on scene.',
      'Copy.',
      'SSP970 to 95 Control, vehicle is disabled.',
      'Copy.',
      'SSP970 to 95 Control, I performed a tire change.',
      'Copy.',
    ])
    expect(conversation.nodes[2].kind).toBe('dispatch')
    expect(conversation.nodes[8].trigger).toEqual({ type: 'finding', nature: 'disabled', source: 'ssp-update' })
    expect(conversation.nodes[10]).toMatchObject({ kind: 'service', trigger: { type: 'service', service: 'tire-change' } })
    const discovered = buildConversation({ ...scene, agencies: ['ems'] })
    expect(texts(discovered.conversation.nodes).slice(2, 6)).toEqual([
      "Show me out at northbound exit 155 in the main lanes with a car blocking the right lane. I'll advise. Send VSP.",
      'Copy. VSP en route.',
      'SSP970 to 95 Control, EMS now on scene.',
      'Copy.',
    ])
  })

  it('folds a TOC-known finding into the dispatch and sends no SSP update', () => {
    const { conversation } = buildConversation({ ...scene, mode: 'toc-dispatched', incidentNature: 'accident', natureSource: 'toc-dispatch' })
    expect(conversation.nodes[2].text).toBe('Please respond to a blocking accident at northbound exit 155 in the main lanes.')
    expect(texts(conversation.nodes).some((text) => text.includes('crash'))).toBe(false)
  })

  it('keeps edited, pinned and suppressed lines across a regenerate', () => {
    let { conversation } = buildConversation(scene)
    conversation = updateNode(conversation, conversation.nodes[1].id, { text: 'SSP970?' })
    conversation = insertNode(conversation, conversation.nodes[3].id, 'SSP', '10-4.').conversation
    conversation = removeNode(conversation, conversation.nodes[0].id)
    const regenerated = buildConversation({ ...scene, agencies: ['tow'] }, conversation).conversation
    expect(texts(regenerated.nodes)).toEqual([
      'SSP970?',
      "Show me out at northbound exit 155 in the main lanes with a car blocking the right lane. I'll advise. Send VSP.",
      'Copy. VSP en route.',
      '10-4.',
      'SSP970 to 95 Control, tow is on scene.',
      'Copy.',
    ])
    expect(regenerated.suppressed).toEqual(['origin#0'])
  })
})

describe('recordSceneChange', () => {
  it('appends departures and the clearing call with their triggers', () => {
    const built = buildConversation({ ...scene, agencies: ['ems', 'fire'] })
    const left = recordSceneChange(built.conversation, built.state, { ...scene, agencies: ['fire'] })
    expect(texts(left.conversation.nodes).slice(-2)).toEqual(['SSP970 to 95 Control, EMS has departed.', 'Copy.'])
    expect(left.conversation.nodes.at(-2)).toMatchObject({ recorded: true, kind: 'update', trigger: { type: 'agency', group: 'ems', event: 'departed' } })
    const fire = recordSceneChange(left.conversation, left.state, { ...scene, agencies: [] })
    expect(fire.conversation.nodes.at(-2)?.text).toBe('SSP970 to 95 Control, fire has departed.')
    const clear = recordSceneChange(fire.conversation, fire.state, { ...scene, sceneHazards: [], sceneEmpty: true, agencies: [] })
    expect(texts(clear.conversation.nodes).slice(-2)).toEqual(["SSP970 to 95 Control, scene clear, I'm clear.", 'Copy.'])
    expect(clear.conversation.nodes.at(-2)?.kind).toBe('clear')
    expect(clear.state.phase).toBe('cleared')
  })

  it('regenerating after a recorded session does not duplicate the opening', () => {
    // Record from an empty conversation: the opening is recorded live, then an agency leaves.
    const live = recordSceneChange({ version: 1, nodes: [], suppressed: [] }, { phase: 'idle', agencies: [] }, { ...scene, agencies: ['ems'] })
    const left = recordSceneChange(live.conversation, live.state, scene)
    expect(left.conversation.nodes).toHaveLength(6)
    const regenerated = buildConversation(scene, left.conversation).conversation
    expect(texts(regenerated.nodes)).toEqual([
      'SSP970 to 95 Control?',
      'SSP970, go ahead.',
      "Show me out at northbound exit 155 in the main lanes with a car blocking the right lane. I'll advise. Send VSP.",
      'Copy. VSP en route.',
      'SSP970 to 95 Control, EMS has departed.',
      'Copy.',
    ])
    expect(buildConversation(scene, regenerated).conversation.nodes).toHaveLength(6)
  })

  it('does nothing when the scene change says nothing', () => {
    const built = buildConversation(scene)
    const same = recordSceneChange(built.conversation, built.state, scene)
    expect(same.conversation).toBe(built.conversation)
  })
})

describe('editing helpers', () => {
  it('moves and renumbers nodes and normalizes saved data', () => {
    const { conversation } = buildConversation(scene)
    const moved = moveNode(conversation, conversation.nodes[3].id, 0)
    expect(moved.nodes[0].text).toBe('Copy. VSP en route.')
    expect(moved.nodes.map((node) => node.order)).toEqual([0, 1, 2, 3])
    const restored = normalizeConversation(JSON.parse(JSON.stringify(moved)))
    expect(restored).toEqual(moved)
    expect(normalizeConversation({ nodes: [{ text: 'hi', trigger: { type: 'bogus' } }] }).nodes[0]).toMatchObject({ speaker: 'SSP', kind: 'custom', pinned: true, trigger: { type: 'manual' } })
    expect(normalizeConversation(null).nodes).toEqual([])
  })
})
