export interface Vector2 {
  x: number
  y: number
}

export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

export type RoadLineKind = 'left-fog' | 'right-fog' | 'shoulder-edge' | 'skip-line'
export type EquipmentShape = 'circle' | 'square' | 'rectangle' | 'truck'
export type SignboardPattern = 'left-arrow' | 'split-arrow' | 'right-arrow' | 'double-diamonds'

export interface RoadLine {
  id: string
  kind: RoadLineKind
  points: Vector2[]
}

export interface EquipmentPrimitive {
  id: string
  catalogId?: string
  label: string
  shape: EquipmentShape
  position: Vector2
  size: Vector2
  rotation: number
  color: string
  signboard?: SignboardPattern
}

export interface TemplateSource {
  title: string
  publisher: string
  url?: string
  revision?: string
}

export interface SceneTemplateDocument {
  version: 1
  name: string
  units: 'feet'
  gridSize: 10
  flow: 'bottom-to-top'
  sources: TemplateSource[]
  lines: RoadLine[]
  equipment: EquipmentPrimitive[]
}

export const identityMatrix = (): Matrix3 => [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]

export const translationMatrix = (x: number, y: number): Matrix3 => [
  1, 0, x,
  0, 1, y,
  0, 0, 1,
]

export const rotationMatrix = (degrees: number): Matrix3 => {
  const radians = (degrees * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [
    cosine, -sine, 0,
    sine, cosine, 0,
    0, 0, 1,
  ]
}

export function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
    left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
    left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
    left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
    left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
    left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
    left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ]
}

export function transformPoint(matrix: Matrix3, point: Vector2): Vector2 {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + matrix[2],
    y: matrix[3] * point.x + matrix[4] * point.y + matrix[5],
  }
}

export function equipmentMatrix(equipment: EquipmentPrimitive): Matrix3 {
  return multiplyMatrices(
    translationMatrix(equipment.position.x, equipment.position.y),
    rotationMatrix(equipment.rotation),
  )
}

export function snapToGrid(point: Vector2, gridSize = 10): Vector2 {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  }
}

export function createRightLaneTemplate(): SceneTemplateDocument {
  const cones: Vector2[] = [
    { x: 320, y: 310 },
    { x: 320, y: 350 },
    { x: 320, y: 390 },
    { x: 340, y: 430 },
    { x: 370, y: 470 },
    { x: 390, y: 510 },
    { x: 420, y: 550 },
    { x: 440, y: 590 },
    { x: 320, y: 210 },
    { x: 320, y: 170 },
    { x: 320, y: 130 },
  ]

  return {
    version: 1,
    name: 'Single right lane closure',
    units: 'feet',
    gridSize: 10,
    flow: 'bottom-to-top',
    sources: [
      {
        title: 'Manual on Uniform Traffic Control Devices',
        publisher: 'Federal Highway Administration',
        revision: '11th Edition, 2023',
        url: 'https://mutcd.fhwa.dot.gov/',
      },
      {
        title: 'VDOT SSP operating procedure',
        publisher: 'Virginia Department of Transportation',
        revision: 'Agency-controlled source; verify before approval',
      },
    ],
    lines: [
      { id: 'left-fog', kind: 'left-fog', points: [{ x: 80, y: 20 }, { x: 80, y: 680 }] },
      { id: 'skip-1', kind: 'skip-line', points: [{ x: 200, y: 20 }, { x: 200, y: 680 }] },
      { id: 'skip-2', kind: 'skip-line', points: [{ x: 320, y: 20 }, { x: 320, y: 680 }] },
      { id: 'right-fog', kind: 'right-fog', points: [{ x: 440, y: 20 }, { x: 440, y: 680 }] },
      { id: 'shoulder-edge', kind: 'shoulder-edge', points: [{ x: 520, y: 20 }, { x: 520, y: 680 }] },
    ],
    equipment: [
      {
        id: 'ssp-truck',
        catalogId: 'ssp-truck',
        label: 'SSP truck',
        shape: 'truck',
        position: { x: 380, y: 260 },
        size: { x: 60, y: 80 },
        rotation: 0,
        color: '#f1f3ef',
        signboard: 'left-arrow',
      },
      ...cones.map((position, index): EquipmentPrimitive => ({
        id: index === 0 ? 'anchor-cone' : `cone-${index + 1}`,
        catalogId: 'cone',
        label: index === 0 ? 'Anchor cone' : index < 8 ? 'Upstream cone' : 'Downstream cone',
        shape: 'circle',
        position,
        size: { x: 12, y: 12 },
        rotation: 0,
        color: '#ed6a24',
      })),
    ],
  }
}