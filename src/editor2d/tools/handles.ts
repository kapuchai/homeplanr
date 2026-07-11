import type { FurnitureInstance } from '../../model/types'
import type { Vec2 } from '../../geometry/vec'
import { add, rotate } from '../../geometry/vec'

/** Rotate-handle geometry — shared by the select tool and SelectionLayer. */
export const HANDLE_OFFSET_PX = 24
export const HANDLE_RADIUS_PX = 9

export function rotateHandlePos(f: FurnitureInstance, pxToWorld: number): Vec2 {
  const local: Vec2 = { x: 0, y: -(f.size.d / 2 + HANDLE_OFFSET_PX * pxToWorld) }
  return add({ x: f.x, y: f.y }, rotate(local, f.rotation))
}
