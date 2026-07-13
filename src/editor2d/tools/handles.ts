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

/** Corner sign pairs, index-stable: 0=(−,−) 1=(+,−) 2=(+,+) 3=(−,+). */
export const RESIZE_CORNERS: readonly Vec2[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
]

export const RESIZE_HANDLE_RADIUS_PX = 7

/** World positions of the four corner resize handles (M9). Mirror is
 * geometry-symmetric — corner POSITIONS ignore it; only the drag math
 * unmirrors. */
export function resizeHandlePositions(f: FurnitureInstance): Vec2[] {
  return RESIZE_CORNERS.map((c) =>
    add({ x: f.x, y: f.y }, rotate({ x: (c.x * f.size.w) / 2, y: (c.y * f.size.d) / 2 }, f.rotation)),
  )
}
