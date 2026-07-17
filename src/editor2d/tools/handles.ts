import type { FurnitureInstance } from '../../model/types'
import type { Vec2 } from '../../geometry/vec'
import { add, rotate } from '../../geometry/vec'
import { pointInPolygon } from '../../geometry/polygon'

/** Rotate-handle geometry — shared by the select tool and SelectionLayer. */
export const HANDLE_OFFSET_PX = 24
export const HANDLE_RADIUS_PX = 9

export function rotateHandlePos(f: FurnitureInstance, pxToWorld: number): Vec2 {
  const local: Vec2 = { x: 0, y: -(f.size.d / 2 + HANDLE_OFFSET_PX * pxToWorld) }
  return add({ x: f.x, y: f.y }, rotate(local, f.rotation))
}

/**
 * Room rotation pivot (0.8.0): the area centroid, EXCEPT when it falls
 * outside the polygon (L-shapes) — then the guaranteed-interior label
 * anchor. Handle and rotation math MUST share this choice, or the handle
 * orbits the pivot instead of following the cursor.
 */
export function roomPivot(r: {
  polygon: readonly Vec2[]
  centroid: Vec2
  labelAnchor: Vec2
}): Vec2 {
  return pointInPolygon(r.centroid, r.polygon) ? r.centroid : r.labelAnchor
}

/** Room rotate handle: fixed px offset from the pivot, same front-side
 * data−y convention as the furniture handle. */
export function roomRotateHandlePos(pivot: Vec2, pxToWorld: number): Vec2 {
  return { x: pivot.x, y: pivot.y - HANDLE_OFFSET_PX * 1.5 * pxToWorld }
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
