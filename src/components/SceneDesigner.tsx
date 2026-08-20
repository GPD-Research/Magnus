import { useState } from 'react'
import {
  Circle,
  Download,
  Grid3X3,
  MousePointer2,
  RectangleHorizontal,
  Save,
  Square,
  TrafficCone,
  Truck,
  Waypoints,
  X,
} from 'lucide-react'
import {
  createRightLaneTemplate,
  snapToGrid,
  type EquipmentPrimitive,
  type EquipmentShape,
  type RoadLineKind,
  type SceneTemplateDocument,
  type SignboardPattern,
  type Vector2,
} from '../domain/sceneTemplate'
import './SceneDesigner.css'

type DesignerTool = 'select' | 'line' | 'cone' | EquipmentShape

interface SceneDesignerProps {
  onClose: () => void
  onSave: (template: SceneTemplateDocument) => void
}

const tools: { id: DesignerTool; label: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select / move', icon: MousePointer2 },
  { id: 'line', label: 'Road line', icon: Waypoints },
  { id: 'cone', label: 'Cone', icon: TrafficCone },
  { id: 'truck', label: 'SSP truck', icon: Truck },
  { id: 'square', label: 'Square equipment', icon: Square },
  { id: 'circle', label: 'Circle equipment', icon: Circle },
  { id: 'rectangle', label: 'Rectangle equipment', icon: RectangleHorizontal },
]

const lineColors: Record<RoadLineKind, string> = {
  'left-fog': '#e5ca35',
  'right-fog': '#f3f4ee',
  'shoulder-edge': '#73807d',
  'skip-line': '#f3f4ee',
}

const signboardPaths: Record<SignboardPattern, string> = {
  'left-arrow': 'M 10 0 H -10 M -10 0 L -4 -5 M -10 0 L -4 5',
  'split-arrow': 'M 0 6 V -6 M 0 -1 L -7 -7 M 0 -1 L 7 -7',
  'right-arrow': 'M -10 0 H 10 M 10 0 L 4 -5 M 10 0 L 4 5',
  'double-diamonds': 'M -13 0 L -8 -5 L -3 0 L -8 5 Z M 3 0 L 8 -5 L 13 0 L 8 5 Z',
}

function equipmentDefaults(shape: DesignerTool, position: Vector2): EquipmentPrimitive {
  const normalizedShape: EquipmentShape = shape === 'cone' ? 'circle' : shape as EquipmentShape
  return {
    id: `${shape}-${crypto.randomUUID()}`,
    label: shape === 'cone' ? 'Traffic cone' : shape === 'truck' ? 'SSP truck' : 'DOT equipment',
    shape: normalizedShape,
    position,
    size:
      shape === 'truck'
        ? { x: 60, y: 90 }
        : shape === 'rectangle'
          ? { x: 40, y: 20 }
          : { x: 16, y: 16 },
    rotation: 0,
    color: shape === 'cone' ? '#ed6a24' : shape === 'truck' ? '#f1f3ef' : '#2e7d62',
    signboard: shape === 'truck' ? 'left-arrow' : undefined,
  }
}

export function SceneDesigner({ onClose, onSave }: SceneDesignerProps) {
  const [template, setTemplate] = useState(createRightLaneTemplate)
  const [tool, setTool] = useState<DesignerTool>('select')
  const [lineKind, setLineKind] = useState<RoadLineKind>('skip-line')
  const [lineStart, setLineStart] = useState<Vector2 | null>(null)
  const [selectedId, setSelectedId] = useState<string>('ssp-truck')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const selected = template.equipment.find((item) => item.id === selectedId)

  function eventPoint(event: React.PointerEvent<SVGSVGElement>): Vector2 {
    const bounds = event.currentTarget.getBoundingClientRect()
    return snapToGrid({
      x: ((event.clientX - bounds.left) / bounds.width) * 600,
      y: ((event.clientY - bounds.top) / bounds.height) * 700,
    })
  }

  function updateEquipment(id: string, updates: Partial<EquipmentPrimitive>) {
    setTemplate((current) => ({
      ...current,
      equipment: current.equipment.map((item) =>
        item.id === id ? { ...item, ...updates } : item,
      ),
    }))
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget && tool === 'select') return
    const point = eventPoint(event)

    if (tool === 'line') {
      if (!lineStart) {
        setLineStart(point)
        return
      }
      setTemplate((current) => ({
        ...current,
        lines: [
          ...current.lines,
          { id: `line-${crypto.randomUUID()}`, kind: lineKind, points: [lineStart, point] },
        ],
      }))
      setLineStart(null)
      return
    }

    if (tool !== 'select') {
      const equipment = equipmentDefaults(tool, point)
      setTemplate((current) => ({
        ...current,
        equipment: [...current.equipment, equipment],
      }))
      setSelectedId(equipment.id)
      setTool('select')
      return
    }

    setSelectedId('')
  }

  function exportTemplate() {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${template.name.toLowerCase().replaceAll(' ', '-')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <section className="designer-shell" aria-label="Scene template designer">
      <header className="designer-header">
        <div>
          <span>Vector template authoring</span>
          <input
            aria-label="Template name"
            value={template.name}
            onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))}
          />
        </div>
        <div className="designer-status"><Grid3X3 size={14} /> 10 FT GRID <b>·</b> FLOW ↑ DOWNSTREAM</div>
        <button type="button" onClick={exportTemplate}><Download size={15} /> Export JSON</button>
        <button className="designer-save" type="button" onClick={() => onSave(template)}><Save size={15} /> Save template</button>
        <button className="designer-close" type="button" title="Close designer" onClick={onClose}><X size={18} /></button>
      </header>

      <div className="designer-body">
        <nav className="designer-tools" aria-label="Drawing tools">
          {tools.map(({ id, label, icon: Icon }) => (
            <button className={tool === id ? 'active' : ''} type="button" title={label} key={id} onClick={() => { setTool(id); setLineStart(null) }}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
          {tool === 'line' && (
            <label className="line-kind-control">
              Line type
              <select value={lineKind} onChange={(event) => setLineKind(event.target.value as RoadLineKind)}>
                <option value="left-fog">Left fog line</option>
                <option value="right-fog">Right fog line</option>
                <option value="shoulder-edge">Shoulder edge</option>
                <option value="skip-line">Skip line</option>
              </select>
              <small>{lineStart ? 'Select end point' : 'Select start point'}</small>
            </label>
          )}
        </nav>

        <div className="designer-canvas-wrap">
          <svg
            className="designer-canvas"
            viewBox="0 0 600 700"
            aria-label="10 foot scene design grid"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={(event) => {
              if (draggingId) updateEquipment(draggingId, { position: eventPoint(event) })
            }}
            onPointerUp={() => setDraggingId(null)}
            onPointerLeave={() => setDraggingId(null)}
          >
            <defs>
              <pattern id="minorGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 H 0 V 10" /></pattern>
              <pattern id="majorGrid" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#minorGrid)" /><path d="M 50 0 H 0 V 50" /></pattern>
            </defs>
            <rect className="designer-grid-hit" width="600" height="700" fill="url(#majorGrid)" />
            <g className="designer-flow"><path d="M 34 650 V 585 M 34 585 L 27 598 M 34 585 L 41 598" /><text x="18" y="670">UPSTREAM</text><text x="12" y="572">DOWNSTREAM</text></g>
            {template.lines.map((line) => (
              <polyline
                className={`template-line ${line.kind}`}
                key={line.id}
                points={line.points.map((point) => `${point.x},${point.y}`).join(' ')}
                stroke={lineColors[line.kind]}
              />
            ))}
            {lineStart && <circle className="line-start" cx={lineStart.x} cy={lineStart.y} r="4" />}
            {template.equipment.map((item) => (
              <g
                className={selectedId === item.id ? 'designer-equipment selected' : 'designer-equipment'}
                key={item.id}
                transform={`translate(${item.position.x} ${item.position.y}) rotate(${item.rotation})`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setSelectedId(item.id)
                  if (tool === 'select') setDraggingId(item.id)
                }}
              >
                {item.shape === 'circle' && <circle r={item.size.x / 2} fill={item.color} />}
                {item.shape === 'square' && <rect x={-item.size.x / 2} y={-item.size.y / 2} width={item.size.x} height={item.size.y} fill={item.color} />}
                {item.shape === 'rectangle' && <rect x={-item.size.x / 2} y={-item.size.y / 2} width={item.size.x} height={item.size.y} fill={item.color} />}
                {item.shape === 'truck' && (
                  <g>
                    <rect className="designer-truck" x={-item.size.x / 2} y={-item.size.y / 2} width={item.size.x} height={item.size.y} />
                    <path className="designer-truck-lines" d={`M ${-item.size.x / 2} -8 H ${item.size.x / 2} M ${-item.size.x / 2} 20 H ${item.size.x / 2}`} />
                    <rect className="designer-signboard" x="-22" y={item.size.y / 2 - 13} width="44" height="9" />
                    {item.signboard && <path className="designer-sign-symbol" d={signboardPaths[item.signboard]} transform={`translate(0 ${item.size.y / 2 - 8.5}) scale(.75)`} />}
                  </g>
                )}
                <rect className="equipment-selection" x={-item.size.x / 2 - 4} y={-item.size.y / 2 - 4} width={item.size.x + 8} height={item.size.y + 8} />
              </g>
            ))}
          </svg>
          <div className="designer-scale">Each minor square = 10 ft</div>
        </div>

        <aside className="designer-inspector">
          <div className="inspector-heading"><span>Properties</span><b>{selected ? 'OBJECT' : 'SCENE'}</b></div>
          {selected ? (
            <>
              <label>Label<input value={selected.label} onChange={(event) => updateEquipment(selected.id, { label: event.target.value })} /></label>
              <div className="inspector-grid">
                <label>X (ft)<input type="number" step="10" value={selected.position.x} onChange={(event) => updateEquipment(selected.id, { position: snapToGrid({ ...selected.position, x: Number(event.target.value) }) })} /></label>
                <label>Y (ft)<input type="number" step="10" value={selected.position.y} onChange={(event) => updateEquipment(selected.id, { position: snapToGrid({ ...selected.position, y: Number(event.target.value) }) })} /></label>
                <label>Width<input type="number" step="10" value={selected.size.x} onChange={(event) => updateEquipment(selected.id, { size: { ...selected.size, x: Number(event.target.value) } })} /></label>
                <label>Length<input type="number" step="10" value={selected.size.y} onChange={(event) => updateEquipment(selected.id, { size: { ...selected.size, y: Number(event.target.value) } })} /></label>
              </div>
              <label>Rotation<select value={selected.rotation} onChange={(event) => updateEquipment(selected.id, { rotation: Number(event.target.value) })}><option value="0">0°</option><option value="15">15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>
              {selected.shape === 'truck' && <label>Signboard<select value={selected.signboard} onChange={(event) => updateEquipment(selected.id, { signboard: event.target.value as SignboardPattern })}><option value="left-arrow">Left arrow</option><option value="split-arrow">Split arrow</option><option value="right-arrow">Right arrow</option><option value="double-diamonds">Double diamonds</option></select></label>}
              <label>Color<input className="color-input" type="color" value={selected.color} onChange={(event) => updateEquipment(selected.id, { color: event.target.value })} /></label>
              <button className="delete-object" type="button" onClick={() => { setTemplate((current) => ({ ...current, equipment: current.equipment.filter((item) => item.id !== selected.id) })); setSelectedId('') }}>Delete object</button>
            </>
          ) : (
            <div className="scene-summary"><p>{template.lines.length} roadway lines</p><p>{template.equipment.length} equipment objects</p><p>Origin: upper-left</p><p>Traffic vector: bottom → top</p><h3>Source record</h3>{template.sources.map((source) => <p key={source.title}><b>{source.publisher}</b><br />{source.title}<br /><small>{source.revision}</small></p>)}</div>
          )}
        </aside>
      </div>
    </section>
  )
}