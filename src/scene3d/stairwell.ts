import { CATALOG } from '../catalog'
import { pointInPolygon } from '../geometry/polygon'
import { triangulate, type Triangulation } from '../geometry/triangulate'
import type { LevelDoc } from '../model/types'
import type { DerivedRoom } from '../store/derived'
import type { Vec2 } from '../geometry/vec'

/**
 * Stairwell carves (0.13.0) — DERIVED, never stored: a storey connector's
 * footprint rect punches through the ceiling of its own level and the
 * floor slab of the level above. Everything here is pure plan-space math;
 * the 3D layer memoizes per (room, wells).
 */

/** Footprint rects (plan-space corner rings) of every storey-connector
 * instance on the level. */
export function stairwellRects(doc: LevelDoc): Vec2[][] {
  const rects: Vec2[][] = []
  for (const f of Object.values(doc.furniture)) {
    if (!CATALOG[f.catalogItemId]?.connectsLevels) continue
    const hw = f.size.w / 2
    const hd = f.size.d / 2
    const cos = Math.cos(f.rotation)
    const sin = Math.sin(f.rotation)
    rects.push(
      [
        { x: -hw, y: -hd },
        { x: hw, y: -hd },
        { x: hw, y: hd },
        { x: -hw, y: hd },
      ].map((p) => ({
        x: f.x + p.x * cos - p.y * sin,
        y: f.y + p.x * sin + p.y * cos,
      })),
    )
  }
  return rects
}

/**
 * The wells that apply to a room: every rect corner inside the outer
 * polygon and none inside a wall-island hole. Straddling rects are
 * SKIPPED (earcut cannot take a hole crossing the boundary) — a stair
 * poking through a wall keeps the slab intact rather than corrupting the
 * triangulation.
 */
export function applicableWells(room: DerivedRoom, wells: readonly Vec2[][]): Vec2[][] {
  return wells.filter(
    (rect) =>
      rect.every((c) => pointInPolygon(c, room.polygon)) &&
      !room.holePolygons.some((hole) => rect.some((c) => pointInPolygon(c, hole))),
  )
}

/**
 * Room floor triangulation with its applicable wells carved. Null when no
 * well applies — callers keep the BAKED room.floor (identity-stable, the
 * derived-reference rule).
 */
export function carveRoomTriangulation(
  room: DerivedRoom,
  wells: readonly Vec2[][],
): { tri: Triangulation; holes: Vec2[][] } | null {
  const holes = applicableWells(room, wells)
  if (!holes.length) return null
  return {
    tri: triangulate(room.polygon, [...room.holePolygons, ...holes]),
    holes,
  }
}
