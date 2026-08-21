import type { EquipmentDefinition } from '../domain/equipmentCatalog'

interface SceneEquipmentGlyphProps {
  definition: EquipmentDefinition
}

export function SceneEquipmentGlyph({ definition }: SceneEquipmentGlyphProps) {
  const width = definition.width
  const length = definition.length
  const halfWidth = width / 2
  const halfLength = length / 2
  const common = { fill: definition.color, stroke: '#151c1b', strokeWidth: 0.7 }

  switch (definition.glyph) {
    case 'cone':
      return <><path {...common} d={`M ${-halfWidth} ${halfLength} L ${-width * .18} ${-halfLength} H ${width * .18} L ${halfWidth} ${halfLength} Z`} /><path d={`M ${-halfWidth} ${halfLength} H ${halfWidth}`} className="catalog-detail" /></>
    case 'flare':
      return <><circle r={Math.max(width, 2)} fill="#d93528" className="catalog-flare" /><path d="M -1.5 0 H 1.5 M 0 -1.5 V 1.5" className="catalog-detail" /></>
    case 'diamond-sign':
    case 'debris':
      return <><rect {...common} x={-halfWidth} y={-halfLength} width={width} height={length} transform="rotate(45) scale(.7)" /><text className="catalog-label" textAnchor="middle" y="1.5">{definition.glyph === 'debris' ? 'DEBRIS' : 'SCENE'}</text></>
    case 'person':
      return <><circle {...common} cy={-length * .3} r={width * .28} /><path d={`M 0 ${-length * .05} V ${length * .3} M 0 ${length * .05} L ${-halfWidth} ${length * .15} M 0 ${length * .05} L ${halfWidth} ${length * .15} M 0 ${length * .3} L ${-halfWidth * .7} ${halfLength} M 0 ${length * .3} L ${halfWidth * .7} ${halfLength}`} className="catalog-person" /></>
    case 'helipad':
      return <><circle r={halfWidth} fill="rgba(210,64,53,.08)" stroke="#d24035" strokeWidth="2" /><text className="helipad-h" textAnchor="middle" y={width * .18}>H</text><text className="helipad-label" textAnchor="middle" y={halfLength + 5}>HELICOPTER LANDING ZONE</text></>
    case 'airplane':
      return <><path {...common} d={`M 0 ${-halfLength} L ${width * .12} ${-length * .08} L ${halfWidth} ${length * .12} L ${width * .45} ${length * .25} L ${width * .1} ${length * .12} L ${width * .08} ${halfLength} L ${-width * .08} ${halfLength} L ${-width * .1} ${length * .12} L ${-width * .3} ${length * .2} L ${-width * .42} ${length * .05} L ${-width * .12} ${-length * .08} Z`} /><path d={`M ${-width * .3} ${length * .2} L ${-width * .48} ${length * .38}`} className="catalog-damage" /></>
    case 'deer':
      return <><ellipse {...common} rx={halfWidth} ry={length * .28} /><circle {...common} cx={halfWidth * .8} cy={-length * .25} r={width * .2} /><path d={`M ${-width * .3} ${length * .2} L ${-halfWidth} ${halfLength} M ${width * .15} ${length * .2} L ${halfWidth} ${halfLength}`} className="catalog-detail" /></>
    case 'jackknife':
      return <><rect {...common} x={-width * .12} y={-halfLength} width={width * .24} height={length * .62} rx="1" /><g transform={`translate(0 ${length * .2}) rotate(-58)`}><rect {...common} x={-width * .12} y={-length * .32} width={width * .24} height={length * .64} rx="1" /></g></>
    case 'tractor-trailer':
    case 'car-hauler':
      return <><rect {...common} x={-halfWidth} y={-halfLength} width={width} height={length * .7} rx="1" /><rect {...common} x={-halfWidth} y={length * .22} width={width} height={length * .28} rx="1" /><path d={`M ${-halfWidth} ${length * .2} H ${halfWidth}`} className="catalog-detail" /></>
    case 'trailer':
      return <><rect {...common} x={-halfWidth} y={-halfLength} width={width} height={length} rx="1" /><path d={`M ${-halfWidth} ${-length * .22} H ${halfWidth} M ${-halfWidth} ${length * .22} H ${halfWidth}`} className="catalog-detail" /></>
    case 'ladder-truck':
      return <><VehicleBody width={width} length={length} color={definition.color} /><path d={`M ${-width * .28} ${-length * .35} V ${length * .25} M 0 ${-length * .35} V ${length * .25} M ${width * .28} ${-length * .35} V ${length * .25} M ${-width * .35} ${-length * .3} H ${width * .35} M ${-width * .35} ${-length * .12} H ${width * .35} M ${-width * .35} ${length * .06} H ${width * .35} M ${-width * .35} ${length * .24} H ${width * .35}`} className="catalog-ladder" /></>
    case 'bus':
      return <><VehicleBody width={width} length={length} color={definition.color} /><path d={`M ${-width * .35} ${-length * .32} H ${width * .35} M ${-width * .35} ${-length * .15} H ${width * .35} M ${-width * .35} ${length * .02} H ${width * .35} M ${-width * .35} ${length * .19} H ${width * .35}`} className="catalog-detail" /></>
    case 'pickup':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .36} y={length * .08} width={width * .72} height={length * .3} fill="none" className="catalog-detail" /></>
    case 'ambulance':
      return <><VehicleBody width={width} length={length} color={definition.color} /><path d={`M ${-width * .25} 0 H ${width * .25} M 0 ${-width * .25} V ${width * .25}`} className="catalog-medical" /></>
    case 'cruiser':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .38} y="-1" width={width * .76} height="2" fill="#4b82b6" /></>
    case 'suv':
    case 'ssp-truck':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .4} y="-1" width={width * .8} height="2" fill="#efc227" /></>
    case 'tractor':
    case 'pump-truck':
    case 'sedan':
      return <VehicleBody width={width} length={length} color={definition.color} />
    case 'tool':
      return <><circle {...common} r={halfWidth} /><path d={`M ${-halfWidth * .6} ${halfLength * .6} L ${halfWidth * .6} ${-halfLength * .6} M ${-halfWidth * .6} ${-halfLength * .6} L ${halfWidth * .6} ${halfLength * .6}`} className="catalog-detail" /></>
  }
}

function VehicleBody({ width, length, color }: { width: number; length: number; color: string }) {
  return <><rect x={-width / 2} y={-length / 2} width={width} height={length} rx={Math.min(2, width * .2)} fill={color} stroke="#151c1b" strokeWidth=".7" /><path d={`M ${-width * .38} ${-length * .22} H ${width * .38} M ${-width * .38} ${length * .25} H ${width * .38}`} className="catalog-detail" /></>
}
