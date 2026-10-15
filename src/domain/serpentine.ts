/** Geometry for the conversation timeline: a serpentine path sized to its pane. */
const ROW_HEIGHT_MIN = 110
export const MARGIN = 48

/** Serpentine path: horizontal rows alternating direction, joined by semicircles, arrowhead at the end. */
export function serpentinePath(width: number, height: number, rows: number): string {
  const rowGap = (height - MARGIN * 2) / Math.max(1, rows - 1)
  const radius = rows > 1 ? rowGap / 2 : 0
  const left = MARGIN + radius
  const right = width - MARGIN - radius
  let d = `M ${left} ${MARGIN}`
  for (let row = 0; row < rows; row += 1) {
    const y = MARGIN + row * rowGap
    const goingRight = row % 2 === 0
    d += ` L ${goingRight ? right : left} ${y}`
    if (row < rows - 1) {
      const nextY = y + rowGap
      d += goingRight ? ` A ${radius} ${radius} 0 0 1 ${right} ${nextY}` : ` A ${radius} ${radius} 0 0 0 ${left} ${nextY}`
    }
  }
  return d
}

export function rowsFor(nodeCount: number, height: number): number {
  const byHeight = Math.max(1, Math.floor((height - MARGIN * 2) / ROW_HEIGHT_MIN) + 1)
  const wanted = Math.max(1, Math.ceil(nodeCount / 6))
  return Math.min(byHeight, Math.max(wanted, Math.min(byHeight, 3)))
}

