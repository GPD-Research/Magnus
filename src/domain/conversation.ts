import {
  AGENCY_ORDER,
  INITIAL_COMMUNICATIONS_STATE,
  advanceCommunications,
  type AgencyGroup,
  type CommunicationsScene,
  type CommunicationsState,
  type IncidentNature,
  type RadioMessage,
  type ServiceRendered,
} from './communications'

export type Speaker = 'SSP' | 'TOC'
export type NodeKind = 'hail' | 'ack' | 'report' | 'dispatch' | 'en-route' | 'update' | 'finding' | 'service' | 'clear' | 'custom'

export type ConversationTrigger =
  | { type: 'origin' }
  | { type: 'arrival' }
  | { type: 'agency'; group: AgencyGroup; event: 'arrived' | 'departed' }
  | { type: 'finding'; nature: Exclude<IncidentNature, 'unknown'>; source: 'toc-dispatch' | 'ssp-update' }
  | { type: 'service'; service: Exclude<ServiceRendered, 'none'> }
  | { type: 'clear' }
  | { type: 'manual' }

export interface ConversationNode {
  id: string
  order: number
  speaker: Speaker
  text: string
  kind: NodeKind
  trigger: ConversationTrigger
  /** Position of this line within the lines its trigger produced (0 = first). */
  sequence: number
  edited: boolean
  pinned: boolean
  /** Appended while Record was on; regenerate keeps it like an edited node. */
  recorded?: boolean
  note?: string
}

export interface Conversation {
  version: 1
  nodes: ConversationNode[]
  /** Heuristic lines (trigger key + sequence) the instructor deleted; regenerate leaves them out. */
  suppressed: string[]
}

export const EMPTY_CONVERSATION: Conversation = { version: 1, nodes: [], suppressed: [] }

/** One-word calls that make up most of the traffic; offered as quick inserts. */
export const QUICK_ACKNOWLEDGEMENTS = ['Copy.', '10-4.', 'Disregard.', 'Go ahead.', 'Stand by.']

const SPEAKERS: Speaker[] = ['SSP', 'TOC']
const KINDS: NodeKind[] = ['hail', 'ack', 'report', 'dispatch', 'en-route', 'update', 'finding', 'service', 'clear', 'custom']

export function triggerKey(trigger: ConversationTrigger): string {
  switch (trigger.type) {
    case 'agency': return `agency:${trigger.group}:${trigger.event}`
    case 'finding': return `finding:${trigger.nature}:${trigger.source}`
    case 'service': return `service:${trigger.service}`
    default: return trigger.type
  }
}

function lineKey(node: Pick<ConversationNode, 'trigger' | 'sequence'>): string {
  return `${triggerKey(node.trigger)}#${node.sequence}`
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function renumber(nodes: ConversationNode[]): ConversationNode[] {
  return nodes.map((node, order) => (node.order === order ? node : { ...node, order }))
}

export function normalizeConversation(value: unknown): Conversation {
  if (!value || typeof value !== 'object') return EMPTY_CONVERSATION
  const raw = value as Partial<Conversation>
  if (!Array.isArray(raw.nodes)) return EMPTY_CONVERSATION
  const nodes = raw.nodes.flatMap((node): ConversationNode[] => {
    if (!node || typeof node !== 'object' || typeof node.text !== 'string') return []
    const trigger = normalizeTrigger(node.trigger)
    return [{
      id: typeof node.id === 'string' && node.id ? node.id : newId(),
      order: 0,
      speaker: SPEAKERS.includes(node.speaker) ? node.speaker : 'SSP',
      text: node.text,
      kind: KINDS.includes(node.kind) ? node.kind : 'custom',
      trigger,
      sequence: typeof node.sequence === 'number' ? node.sequence : 0,
      edited: node.edited === true,
      pinned: node.pinned === true || trigger.type === 'manual',
      ...(node.recorded ? { recorded: true } : {}),
      ...(typeof node.note === 'string' && node.note ? { note: node.note } : {}),
    }]
  })
  return {
    version: 1,
    nodes: renumber(nodes),
    suppressed: Array.isArray(raw.suppressed) ? raw.suppressed.filter((key): key is string => typeof key === 'string') : [],
  }
}

function normalizeTrigger(value: unknown): ConversationTrigger {
  if (!value || typeof value !== 'object') return { type: 'manual' }
  const trigger = value as Record<string, unknown>
  const groups: AgencyGroup[] = ['ems', 'fire', 'vsp', 'tow', 'tree-removal']
  switch (trigger.type) {
    case 'origin': case 'arrival': case 'clear': return { type: trigger.type }
    case 'agency':
      if (groups.includes(trigger.group as AgencyGroup) && (trigger.event === 'arrived' || trigger.event === 'departed')) {
        return { type: 'agency', group: trigger.group as AgencyGroup, event: trigger.event }
      }
      return { type: 'manual' }
    case 'finding':
      if ((trigger.nature === 'accident' || trigger.nature === 'disabled') && (trigger.source === 'toc-dispatch' || trigger.source === 'ssp-update')) {
        return { type: 'finding', nature: trigger.nature, source: trigger.source }
      }
      return { type: 'manual' }
    case 'service':
      if (typeof trigger.service === 'string' && trigger.service !== 'none' && ['tire-change', 'jump-start', 'traffic-control', 'added-coolant', 'performed-push'].includes(trigger.service)) {
        return { type: 'service', service: trigger.service as Exclude<ServiceRendered, 'none'> }
      }
      return { type: 'manual' }
    default: return { type: 'manual' }
  }
}

function kindOf(message: RadioMessage, trigger: ConversationTrigger): NodeKind {
  const text = message.text
  if (trigger.type === 'finding') return message.channel === 'SSP' ? 'finding' : 'ack'
  if (trigger.type === 'service') return message.channel === 'SSP' ? 'service' : 'ack'
  if (trigger.type === 'clear') return message.channel === 'SSP' ? 'clear' : 'ack'
  if (text.endsWith('?')) return 'hail'
  if (text.startsWith("Please respond")) return 'dispatch'
  if (text.startsWith("Show me en route")) return 'en-route'
  if (/^Show me (out|on scene)/.test(text)) return 'report'
  if (/^(Copy|10-4|Disregard)/.test(text) || text.endsWith(", go ahead.") || /^[A-Z]+\d*\.$/.test(text)) return 'ack'
  return trigger.type === 'agency' ? 'update' : 'custom'
}

function toNodes(messages: RadioMessage[], trigger: ConversationTrigger, recorded = false): ConversationNode[] {
  return messages.map((message, sequence) => ({
    id: newId(),
    order: 0,
    speaker: message.channel,
    text: message.text,
    kind: kindOf(message, trigger),
    trigger,
    sequence,
    edited: false,
    pinned: false,
    ...(recorded ? { recorded: true } : {}),
  }))
}

interface Step { trigger: ConversationTrigger; scene: CommunicationsScene }

/** Canonical scene sequence the skeleton is built from: origin → arrival → finding → each agency arriving. */
function skeletonSteps(scene: CommunicationsScene): Step[] {
  // Agencies already drawn are part of the opening (TOC names them at dispatch); the rest arrive one by one.
  const opening: AgencyGroup[] = scene.mode === 'toc-dispatched' ? AGENCY_ORDER.filter((group) => scene.agencies.includes(group)) : []
  const base: CommunicationsScene = { ...scene, sspOnScene: true, sceneEmpty: false, agencies: opening, incidentNature: 'unknown', injuries: 'none', transports: 0, service: 'none' }
  const steps: Step[] = []
  if (scene.mode === 'toc-dispatched') {
    const tocKnows = scene.natureSource === 'toc-dispatch' && scene.incidentNature && scene.incidentNature !== 'unknown'
    const known = tocKnows ? { incidentNature: scene.incidentNature, injuries: scene.injuries } : {}
    steps.push({ trigger: { type: 'origin' }, scene: { ...base, sspOnScene: false, ...known } })
    steps.push({ trigger: { type: 'arrival' }, scene: { ...base, ...known } })
  } else {
    steps.push({ trigger: { type: 'origin' }, scene: base })
  }
  const nature = scene.incidentNature
  if (nature && nature !== 'unknown' && scene.natureSource !== 'toc-dispatch') {
    steps.push({ trigger: { type: 'finding', nature, source: 'ssp-update' }, scene: { ...base, incidentNature: nature, injuries: scene.injuries } })
  }
  const present: AgencyGroup[] = [...opening]
  const natureScene = steps[steps.length - 1].scene
  for (const group of AGENCY_ORDER) {
    if (!scene.agencies.includes(group) || present.includes(group)) continue
    present.push(group)
    steps.push({ trigger: { type: 'agency', group, event: 'arrived' }, scene: { ...natureScene, agencies: [...present] } })
  }
  const service = scene.service
  if (service && service !== 'none') {
    steps.push({ trigger: { type: 'service', service }, scene: { ...steps[steps.length - 1].scene, service } })
  }
  return steps
}

/**
 * Prefills the skeleton conversation by replaying the radio reducer over the canonical scene
 * sequence. Edited, pinned and recorded nodes from `existing` survive; suppressed lines stay out.
 */
export function buildConversation(scene: CommunicationsScene, existing: Conversation = EMPTY_CONVERSATION): { conversation: Conversation; state: CommunicationsState } {
  let state = INITIAL_COMMUNICATIONS_STATE
  const generated: ConversationNode[] = []
  for (const step of skeletonSteps(scene)) {
    const result = advanceCommunications(state, step.scene)
    state = result.state
    generated.push(...toNodes(result.messages, step.trigger))
  }
  const suppressed = new Set(existing.suppressed)
  const generatedKeys = new Set(generated.map(lineKey))
  // Recorded lines the skeleton would produce anyway (an opening recorded live) are matched, not duplicated.
  const byKey = new Map(existing.nodes.filter((node) => !node.pinned && (!node.recorded || generatedKeys.has(lineKey(node)))).map((node) => [lineKey(node), node]))
  const kept = new Set<string>()
  const fresh: ConversationNode[] = []
  for (const node of generated) {
    const key = lineKey(node)
    if (suppressed.has(key)) continue
    const previous = byKey.get(key)
    if (previous) {
      kept.add(previous.id)
      fresh.push(previous.edited ? { ...previous, kind: node.kind } : { ...previous, text: node.text, speaker: node.speaker, kind: node.kind })
    } else {
      fresh.push(node)
    }
  }
  // Pinned/recorded nodes go back in after the node they followed in the previous conversation.
  const carried = existing.nodes.filter((node) => node.pinned || (node.recorded && !generatedKeys.has(lineKey(node))))
  for (const node of carried) {
    const index = existing.nodes.findIndex((candidate) => candidate.id === node.id)
    const anchor = [...existing.nodes.slice(0, index)].reverse().find((candidate) => fresh.some((placed) => placed.id === candidate.id))
    const at = anchor ? fresh.findIndex((placed) => placed.id === anchor.id) + 1 : fresh.length
    fresh.splice(at, 0, node)
  }
  return { conversation: { version: 1, nodes: renumber(fresh), suppressed: existing.suppressed }, state }
}

/**
 * Record mode: advances the reducer from the last recorded state and appends whatever the scene
 * change said, tagging each pair of lines with the trigger that produced it.
 */
export function recordSceneChange(
  conversation: Conversation,
  state: CommunicationsState,
  scene: CommunicationsScene,
): { conversation: Conversation; state: CommunicationsState } {
  const result = advanceCommunications(state, scene)
  if (result.messages.length === 0) return { conversation, state: result.state }
  const triggers = recordedTriggers(state, result.state, scene)
  const added: ConversationNode[] = []
  let cursor = 0
  for (const trigger of triggers) {
    const pair = result.messages.slice(cursor, cursor + 2)
    cursor += 2
    added.push(...toNodes(pair, trigger, true))
  }
  if (cursor < result.messages.length) {
    added.push(...toNodes(result.messages.slice(cursor), state.phase === 'idle' || state.phase === 'dispatched' ? { type: state.phase === 'dispatched' ? 'arrival' : 'origin' } : { type: 'manual' }, true))
  }
  return { conversation: { ...conversation, nodes: renumber([...conversation.nodes, ...added]) }, state: result.state }
}

/** Mirrors the on-scene branch of advanceCommunications, which emits two lines per event in this order. */
function recordedTriggers(before: CommunicationsState, after: CommunicationsState, scene: CommunicationsScene): ConversationTrigger[] {
  if (before.phase !== 'on-scene') return []
  const serviceTrigger: ConversationTrigger[] = scene.service && scene.service !== 'none' && scene.service !== before.service
    ? [{ type: 'service', service: scene.service }]
    : []
  if (after.phase === 'cleared') return [...serviceTrigger, { type: 'clear' }]
  const triggers: ConversationTrigger[] = []
  for (const group of AGENCY_ORDER) {
    const was = before.agencies.includes(group)
    const is = after.agencies.includes(group)
    if (is && !was) triggers.push({ type: 'agency', group, event: 'arrived' })
    if (was && !is) triggers.push({ type: 'agency', group, event: 'departed' })
  }
  if (after.nature && after.nature !== 'unknown' && (after.nature !== before.nature || after.injuries !== before.injuries || after.transports !== before.transports)) {
    triggers.push({ type: 'finding', nature: after.nature, source: scene.natureSource ?? 'ssp-update' })
  }
  return [...triggers, ...serviceTrigger]
}

export function insertNode(conversation: Conversation, afterId: string | null, speaker: Speaker, text = '', kind: NodeKind = 'custom'): { conversation: Conversation; node: ConversationNode } {
  const node: ConversationNode = { id: newId(), order: 0, speaker, text, kind, trigger: { type: 'manual' }, sequence: 0, edited: text.length > 0, pinned: true }
  const index = afterId ? conversation.nodes.findIndex((candidate) => candidate.id === afterId) : -1
  const nodes = [...conversation.nodes]
  nodes.splice(index === -1 ? nodes.length : index + 1, 0, node)
  return { conversation: { ...conversation, nodes: renumber(nodes) }, node }
}

export function updateNode(conversation: Conversation, id: string, updates: Partial<Pick<ConversationNode, 'text' | 'speaker' | 'note'>>): Conversation {
  return {
    ...conversation,
    nodes: conversation.nodes.map((node) => node.id === id
      ? { ...node, ...updates, edited: node.edited || updates.text !== undefined || updates.speaker !== undefined }
      : node),
  }
}

/** Removes a node; heuristic lines are remembered so a regenerate does not bring them back. */
export function removeNode(conversation: Conversation, id: string): Conversation {
  const node = conversation.nodes.find((candidate) => candidate.id === id)
  if (!node) return conversation
  const heuristic = !node.pinned && !node.recorded && node.trigger.type !== 'manual'
  return {
    ...conversation,
    nodes: renumber(conversation.nodes.filter((candidate) => candidate.id !== id)),
    suppressed: heuristic ? [...new Set([...conversation.suppressed, lineKey(node)])] : conversation.suppressed,
  }
}

export function moveNode(conversation: Conversation, id: string, toIndex: number): Conversation {
  const from = conversation.nodes.findIndex((node) => node.id === id)
  if (from === -1) return conversation
  const target = Math.max(0, Math.min(conversation.nodes.length - 1, toIndex))
  if (target === from) return conversation
  const nodes = [...conversation.nodes]
  const [node] = nodes.splice(from, 1)
  nodes.splice(target, 0, node)
  return { ...conversation, nodes: renumber(nodes) }
}

/** Speaker that would naturally follow the given node (or open the conversation). */
export function nextSpeaker(conversation: Conversation, afterId: string | null): Speaker {
  const previous = afterId ? conversation.nodes.find((node) => node.id === afterId) : conversation.nodes[conversation.nodes.length - 1]
  return previous?.speaker === 'SSP' ? 'TOC' : 'SSP'
}

export function neighbourSpeaker(speaker: Speaker): Speaker {
  return speaker === 'SSP' ? 'TOC' : 'SSP'
}
