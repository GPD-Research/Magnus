import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Circle, Map, MonitorUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  QUICK_ACKNOWLEDGEMENTS,
  insertNode,
  moveNode,
  neighbourSpeaker,
  nextSpeaker,
  removeNode,
  updateNode,
  type Conversation,
  type ConversationNode,
} from '../domain/conversation'
import { MARGIN, rowsFor, serpentinePath } from '../domain/serpentine'
import './ConversationFlow.css'

interface ConversationFlowProps {
  conversation: Conversation
  onChange: (conversation: Conversation) => void
  onRegenerate: () => void
  recording: boolean
  onToggleRecording: () => void
  onSwitchToScene: () => void
  onDisplay: () => void
  /** Unit / origin / finding selectors rendered by the app so they share its state. */
  fields: ReactNode
}

export function ConversationFlow({ conversation, onChange, onRegenerate, recording, onToggleRecording, onSwitchToScene, onDisplay, fields }: ConversationFlowProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 900, height: 600 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [positions, setPositions] = useState<{ x: number; y: number }[]>([])
  const [draftText, setDraftText] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [connector, setConnector] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  const nodes = conversation.nodes
  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const rows = rowsFor(nodes.length, size.height)
  const pathD = useMemo(() => serpentinePath(size.width, size.height, rows), [size, rows])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // Nodes sit at equal arc-length intervals: first at the start, last at the arrowhead.
  useLayoutEffect(() => {
    // Positions come from the rendered path length, so they are measured after layout.
    const path = pathRef.current
    if (!path) return
    const total = path.getTotalLength()
    const count = nodes.length
    setPositions(nodes.map((_, index) => {
      const t = count === 1 ? 0 : index / (count - 1)
      const point = path.getPointAtLength(total * t)
      return { x: point.x, y: point.y }
    }))
  }, [nodes, pathD])

  // Selecting a node scrolls its bubble into view and draws the connector between them.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selected) { setConnector(null); return }
    const index = nodes.indexOf(selected)
    const bubble = transcriptRef.current?.querySelector<HTMLElement>(`[data-node-id="${selected.id}"]`)
    const canvas = canvasRef.current
    const position = positions[index]
    if (!bubble || !canvas || !position) { setConnector(null); return }
    bubble.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const frame = window.requestAnimationFrame(() => {
      const canvasBox = canvas.getBoundingClientRect()
      const bubbleBox = bubble.getBoundingClientRect()
      setConnector({ x1: position.x, y1: position.y, x2: canvasBox.width, y2: bubbleBox.top + bubbleBox.height / 2 - canvasBox.top })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selected, positions, nodes])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (!selected) return
      const index = nodes.indexOf(selected)
      if (event.key === 'ArrowLeft' && event.altKey) onChange(moveNode(conversation, selected.id, index - 1))
      else if (event.key === 'ArrowRight' && event.altKey) onChange(moveNode(conversation, selected.id, index + 1))
      else if (event.key === 'ArrowLeft') setSelectedId(nodes[Math.max(0, index - 1)]?.id ?? null)
      else if (event.key === 'ArrowRight') setSelectedId(nodes[Math.min(nodes.length - 1, index + 1)]?.id ?? null)
      else if (event.key === 'Delete' || event.key === 'Backspace') onChange(removeNode(conversation, selected.id))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, nodes, conversation, onChange])

  function addCall(text = '', speaker = nextSpeaker(conversation, selectedId), kind: ConversationNode['kind'] = 'custom') {
    const result = insertNode(conversation, selectedId ?? nodes[nodes.length - 1]?.id ?? null, speaker, text, kind)
    onChange(result.conversation)
    setSelectedId(result.node.id)
    if (!text) setDraftText('')
  }

  function commitDraft() {
    if (selected && draftText !== null && draftText !== selected.text) onChange(updateNode(conversation, selected.id, { text: draftText }))
    setDraftText(null)
  }

  // Press on a node and release on another to move it there along the path.
  function dropOn(index: number) {
    if (dragId && nodes[index]?.id !== dragId) onChange(moveNode(conversation, dragId, index))
    setDragId(null)
  }

  return (
    <section className="conversation-flow" aria-label="Conversation flow">
      <div className="conversation-toolbar">
        {fields}
        <div className="conversation-actions">
          <button type="button" className={`record-toggle${recording ? ' recording' : ''}`} onClick={onToggleRecording} aria-pressed={recording} title="While recording, scene changes add calls to the timeline">
            <Circle size={12} fill="currentColor" /> {recording ? 'Recording' : 'Record'}
          </button>
          <button type="button" onClick={onRegenerate} title="Rebuild the skeleton from the scene; your edits are kept"><RotateCcw size={13} /> Regenerate</button>
          <button type="button" onClick={() => addCall()}><Plus size={13} /> Add call</button>
          <div className="quick-acks" aria-label="Quick acknowledgements">
            {QUICK_ACKNOWLEDGEMENTS.map((text) => (
              <button type="button" key={text} onClick={() => addCall(text, selected ? neighbourSpeaker(selected.speaker) : nextSpeaker(conversation, null), 'ack')}>{text}</button>
            ))}
          </div>
          <button type="button" onClick={onDisplay} title="Open large classroom display"><MonitorUp size={13} /> Display</button>
        </div>
      </div>
      <div className="conversation-body">
        <div className="conversation-canvas" ref={canvasRef}>
          <svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label="Timeline">
            <defs>
              <marker id="flow-arrow" markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M 0 0 L 12 6 L 0 12 z" className="flow-arrowhead" />
              </marker>
            </defs>
            <path ref={pathRef} d={pathD} className="flow-path" markerEnd="url(#flow-arrow)" />
            {connector && <line {...connector} className="flow-connector" />}
            {nodes.map((node, index) => {
              const position = positions[index]
              if (!position) return null
              const rowIndex = rows > 1 ? Math.round((position.y - MARGIN) / ((size.height - MARGIN * 2) / (rows - 1))) : 0
              const labelAbove = rowIndex % 2 === 0
              return (
                <g
                  key={node.id}
                  className={`flow-node speaker-${node.speaker.toLowerCase()}${node.id === selectedId ? ' selected' : ''}${node.recorded ? ' recorded' : ''}${node.pinned ? ' pinned' : ''}`}
                  transform={`translate(${position.x} ${position.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.speaker}: ${node.text || '(empty)'}`}
                  onPointerDown={() => setDragId(node.id)}
                  onPointerUp={() => dropOn(index)}
                  onClick={() => setSelectedId(node.id)}
                  onDoubleClick={() => onChange(updateNode(conversation, node.id, { speaker: neighbourSpeaker(node.speaker) }))}
                >
                  <circle r={node.id === selectedId ? 15 : 12} />
                  <text className="flow-node-speaker" textAnchor="middle" dy="0.35em">{node.speaker === 'SSP' ? 'S' : 'T'}</text>
                  <text className="flow-node-label" textAnchor="middle" y={labelAbove ? -24 : 34}>
                    {node.order + 1}. {node.text.length > 28 ? `${node.text.slice(0, 27)}…` : node.text || '…'}
                  </text>
                </g>
              )
            })}
          </svg>
          {nodes.length === 0 && (
            <p className="flow-empty">Set the origin and finding, then press Regenerate to prefill the exchange from the scene — or Add call to write it yourself.</p>
          )}
        </div>
        <div className="conversation-transcript" ref={transcriptRef} aria-label="Radio transcript">
          <div className="radio-log conversation-log">
            {nodes.map((node) => {
              const editing = node.id === selectedId && draftText !== null
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  className={`radio-event radio-event-${node.speaker.toLowerCase()}${node.id === selectedId ? ' selected' : ''}`}
                  onClick={() => setSelectedId(node.id)}
                  onDoubleClick={() => { setSelectedId(node.id); setDraftText(node.text) }}
                >
                  <span>{node.order + 1} · {node.speaker}{node.recorded ? ' · recorded' : node.edited ? ' · edited' : ''}</span>
                  {editing ? (
                    <textarea
                      autoFocus
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      onBlur={commitDraft}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commitDraft() }
                        if (event.key === 'Escape') setDraftText(null)
                      }}
                    />
                  ) : (
                    <p>{node.text || <i>Double-click to type this call</i>}</p>
                  )}
                  {node.id === selectedId && !editing && (
                    <div className="radio-event-tools">
                      <button type="button" title="Edit text" onClick={(event) => { event.stopPropagation(); setDraftText(node.text) }}>Edit</button>
                      <button type="button" title="Swap speaker" onClick={(event) => { event.stopPropagation(); onChange(updateNode(conversation, node.id, { speaker: neighbourSpeaker(node.speaker) })) }}>{neighbourSpeaker(node.speaker)}</button>
                      <button type="button" title="Move earlier" onClick={(event) => { event.stopPropagation(); onChange(moveNode(conversation, node.id, node.order - 1)) }}><ChevronLeft size={12} /></button>
                      <button type="button" title="Move later" onClick={(event) => { event.stopPropagation(); onChange(moveNode(conversation, node.id, node.order + 1)) }}><ChevronRight size={12} /></button>
                      <button type="button" title="Remove call" onClick={(event) => { event.stopPropagation(); onChange(removeNode(conversation, node.id)) }}><Trash2 size={12} /></button>
                    </div>
                  )}
                  {node.id === selectedId && (
                    <input
                      className="radio-event-note"
                      placeholder="Teaching note"
                      value={node.note ?? ''}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onChange(updateNode(conversation, node.id, { note: event.target.value }))}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <button type="button" className="view-switch" onClick={onSwitchToScene} title="Back to the roadway scene" aria-label="Switch to roadway scene">
        <Map size={30} />
      </button>
    </section>
  )
}
