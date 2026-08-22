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
      return <><path {...common} d={`M ${-halfWidth} ${halfLength * .65} L ${-width * .18} ${-halfLength} H ${width * .18} L ${halfWidth} ${halfLength * .65} Z`} /><path d={`M ${-width * .34} 0 H ${width * .34}`} className="catalog-cone-band" /><path d={`M ${-halfWidth} ${halfLength} H ${halfWidth}`} className="catalog-cone-base" /></>
    case 'barrel':
      return <><circle r={halfWidth} fill="#161b1a" /><circle r={width * .38} fill="#c9cecc" /><circle r={width * .26} fill={definition.color} /></>
    case 'flare':
      return <><circle r={Math.max(width, 2)} fill="#d93528" className="catalog-flare" /><path d="M -1.5 0 H 1.5 M 0 -1.5 V 1.5" className="catalog-detail" /></>
    case 'gas-can':
      return <><path {...common} d={`M ${-halfWidth} ${halfLength} V ${-length * .25} Q ${-halfWidth} ${-halfLength} ${-width * .2} ${-halfLength} H ${width * .25} Q ${halfWidth} ${-halfLength} ${halfWidth} ${-length * .22} V ${halfLength} Z`} /><path d={`M ${-width * .18} ${-halfLength} V ${-length * .28} H ${width * .18} V ${-halfLength} M ${width * .3} ${-length * .3} L ${halfWidth} ${-length * .48}`} className="catalog-detail" /></>
    case 'floor-jack':
      return <><path {...common} d={`M ${-halfWidth} ${halfLength} L ${-width * .3} ${-halfLength * .35} H ${width * .3} L ${halfWidth} ${halfLength} Z`} /><circle cx={-width * .34} cy={halfLength * .72} r={width * .12} fill="#252b29" /><circle cx={width * .34} cy={halfLength * .72} r={width * .12} fill="#252b29" /><path d={`M 0 ${-halfLength * .2} L ${width * .42} ${-halfLength}`} className="catalog-detail" /></>
    case 'tool-bag':
      return <><rect {...common} x={-halfWidth} y={-length * .28} width={width} height={length * .78} rx={width * .12} /><path d={`M ${-width * .24} ${-length * .28} V ${-halfLength} H ${width * .24} V ${-length * .28}`} className="catalog-detail" /></>
    case 'compressor':
      return <><rect {...common} x={-width * .36} y={-length * .28} width={width * .72} height={length * .62} rx={width * .3} /><circle cx={-width * .3} cy={halfLength * .42} r={width * .15} fill="#252b29" /><circle cx={width * .3} cy={halfLength * .42} r={width * .15} fill="#252b29" /><path d={`M ${-width * .2} ${-length * .28} V ${-halfLength} H ${width * .2} V ${-length * .28}`} className="catalog-detail" /></>
    case 'tire':
      return <><circle r={halfWidth} fill="#202524" stroke="#111817" strokeWidth=".7" /><circle r={width * .24} fill="#737b78" stroke="#111817" strokeWidth=".5" /></>
    case 'debris-area':
      return <><rect x={-halfWidth} y={-halfLength} width={width} height={length} fill="rgba(155,161,159,.28)" stroke="#343b39" strokeWidth=".7" strokeDasharray="2 1" /><path d={`M ${-halfWidth} ${-halfLength * .35} L ${-width * .15} ${halfLength} M ${-width * .12} ${-halfLength} L ${width * .22} ${halfLength} M ${width * .24} ${-halfLength} L ${halfWidth} ${halfLength * .35}`} className="catalog-detail" /></>
    case 'diamond-sign':
    case 'debris':
      return <><rect {...common} x={-halfWidth} y={-halfLength} width={width} height={length} transform="rotate(45) scale(.7)" /><text className="catalog-label" textAnchor="middle" y="1.5">{definition.glyph === 'debris' ? 'DEBRIS' : 'SCENE'}</text></>
    case 'person':
      return <><circle {...common} cy={-length * .3} r={width * .28} /><path d={`M 0 ${-length * .05} V ${length * .3} M 0 ${length * .05} L ${-halfWidth} ${length * .15} M 0 ${length * .05} L ${halfWidth} ${length * .15} M 0 ${length * .3} L ${-halfWidth * .7} ${halfLength} M 0 ${length * .3} L ${halfWidth * .7} ${halfLength}`} className="catalog-person" /></>
    case 'injured-person':
      return <><circle {...common} cy={-length * .34} r={width * .22} /><path d={`M 0 ${-length * .13} V ${length * .28} M 0 0 L ${-halfWidth} ${length * .12} M 0 0 L ${halfWidth} ${length * .12} M 0 ${length * .28} L ${-halfWidth * .65} ${halfLength} M 0 ${length * .28} L ${halfWidth * .65} ${halfLength}`} className="catalog-person" /><path className="catalog-blood" d={`M ${width * .3} ${-length * .18} C ${width * .1} ${length * .02} ${width * .12} ${length * .17} ${width * .3} ${length * .17} C ${width * .48} ${length * .17} ${width * .5} ${length * .02} ${width * .3} ${-length * .18} Z`} /></>
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
    case 'tanker':
      return <>
        <rect {...common} x={-halfWidth} y={length * .22} width={width} height={length * .28} rx="1" />
        <rect {...common} x={-width * .42} y={-halfLength} width={width * .84} height={length * .7} rx={width * .42} />
        <path d={`M ${-width * .42} ${-length * .15} H ${width * .42} M ${-width * .42} ${length * .18} H ${width * .42}`} className="catalog-detail" />
        <g className="catalog-hazmat" transform={`translate(0 ${-length * .04}) rotate(45)`}>
          <rect x={-width * .23} y={-width * .23} width={width * .46} height={width * .46} />
          <text transform="rotate(-45)" textAnchor="middle" y={width * .09}>!</text>
        </g>
      </>
    case 'tow-truck':
      return <><VehicleBody width={width} length={length} color={definition.color} /><path d={`M ${-width * .38} ${length * .02} H ${width * .38} V ${length * .38} H ${-width * .38} Z M 0 ${length * .04} V ${length * .3} M ${-width * .28} ${length * .32} L 0 ${length * .18} L ${width * .28} ${length * .32}`} className="catalog-tow-rig" /><LightBar width={width} color="#efbd20" /></>
    case 'heavy-tow':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .42} y={-length * .08} width={width * .84} height={length * .38} fill="none" className="catalog-detail" /><path d={`M 0 ${-length * .02} V ${length * .38} M ${-width * .34} ${length * .3} L 0 ${length * .08} L ${width * .34} ${length * .3}`} className="catalog-tow-rig" /><LightBar width={width} color="#efbd20" /></>
    case 'tma-crash':
      return <><VehicleBody width={width} length={length * .72} color={definition.color} /><path d={`M ${-halfWidth} ${length * .2} H ${halfWidth} L ${width * .34} ${halfLength} H ${-width * .34} Z M ${-width * .28} ${length * .28} L ${width * .28} ${length * .42} M ${width * .28} ${length * .28} L ${-width * .28} ${length * .42}`} className="catalog-attenuator" /><LightBar width={width} color="#efbd20" /></>
    case 'tma-cone':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .42} y={-length * .02} width={width * .84} height={length * .42} fill="#444c49" stroke="#151c1b" strokeWidth=".6" />{[-.25, 0, .25].map((x) => <g key={x} transform={`translate(${width * x} ${length * .13}) scale(.7)`}><path fill="#ed6a24" d="M -1 1 L -.35 -1 H .35 L 1 1 Z" /></g>)}<circle cx={-width * .22} cy={length * .31} r={width * .1} fill="#ed6a24" stroke="#c9cecc" strokeWidth=".5" /><circle cx={width * .22} cy={length * .31} r={width * .1} fill="#ed6a24" stroke="#c9cecc" strokeWidth=".5" /><LightBar width={width} color="#efbd20" /></>
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
      return <><VehicleBody width={width} length={length} color={definition.color} /><path d={`M ${-width * .28} ${-length * .38} V ${length * .4} M ${width * .28} ${-length * .38} V ${length * .4}`} className="catalog-police-stripe" /><LightBar width={width} color="#2d67ae" /></>
    case 'suv':
    case 'ssp-truck':
      return <><VehicleBody width={width} length={length} color={definition.color} /><rect x={-width * .4} y="-1" width={width * .8} height="2" fill="#efc227" /></>
    case 'tractor':
    case 'pump-truck':
    case 'sedan':
      return <VehicleBody width={width} length={length} color={definition.color} />
    case 'vehicle-fire':
      return <>
        <VehicleBody width={width} length={length} color={definition.color} />
        <g className="catalog-flames" transform={`translate(0 ${-length * .08})`}>
          <path d={`M ${-width * .36} ${length * .23} C ${-width * .5} 0 ${-width * .12} ${-length * .08} ${-width * .2} ${-length * .34} C ${width * .02} ${-length * .2} ${width * .08} ${-length * .5} ${width * .28} ${-length * .62} C ${width * .48} ${-length * .22} ${width * .5} ${length * .08} ${width * .32} ${length * .23} Z`} />
          <path className="catalog-flame-core" d={`M ${-width * .08} ${length * .18} C ${-width * .2} 0 ${width * .02} ${-length * .13} ${width * .08} ${-length * .3} C ${width * .28} ${-length * .02} ${width * .24} ${length * .12} ${width * .12} ${length * .18} Z`} />
        </g>
      </>
    case 'motorcycle':
      return <><g transform="rotate(90)"><circle cx={0} cy={-length * .32} r={width * .2} fill="none" stroke="#151c1b" strokeWidth=".8" /><circle cx={0} cy={length * .32} r={width * .2} fill="none" stroke="#151c1b" strokeWidth=".8" /><path d={`M 0 ${-length * .2} L ${-width * .28} 0 L 0 ${length * .2} L ${width * .28} 0 Z M ${-width * .28} 0 H ${width * .28}`} stroke={definition.color} strokeWidth="1.2" fill="none" /></g></>
    case 'tool':
      return <><circle {...common} r={halfWidth} /><path d={`M ${-halfWidth * .6} ${halfLength * .6} L ${halfWidth * .6} ${-halfLength * .6} M ${-halfWidth * .6} ${-halfLength * .6} L ${halfWidth * .6} ${halfLength * .6}`} className="catalog-detail" /></>
  }
}

function LightBar({ width, color }: { width: number; color: string }) {
  return <rect x={-width * .38} y={-1} width={width * .76} height="2" fill={color} stroke="#151c1b" strokeWidth=".25" />
}

function VehicleBody({ width, length, color }: { width: number; length: number; color: string }) {
  return <><rect x={-width / 2} y={-length / 2} width={width} height={length} rx={Math.min(2, width * .2)} fill={color} stroke="#151c1b" strokeWidth=".7" /><path d={`M ${-width * .38} ${-length * .22} H ${width * .38} M ${-width * .38} ${length * .25} H ${width * .38}`} className="catalog-detail" /></>
}
