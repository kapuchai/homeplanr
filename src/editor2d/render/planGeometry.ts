import type { Vec2 } from '../../geometry/vec'
import { add, perp, scale } from '../../geometry/vec'
import type { RealizedOpening, WallSolid } from '../../geometry/wallSolids'
import type { Opening, Wall } from '../../model/types'
import type { DerivedRoom } from '../../store/derived'
import type { Theme2D } from '../../theme/theme2d'
import { FLOOR_IDS, floorSpec } from '../../catalog/palette'

/**
 * Pure plan-render geometry SHARED by the 2D editor (WorldLayers) and the
 * SVG/PNG exporter (src/export) — no React, no stores (type-only store
 * imports). Both consumers must draw from these helpers so the exported
 * plan can never drift from what the editor shows.
 */
export const polyPath = (poly: readonly Vec2[]): string =>
  poly.length ? `M ${poly.map((p) => `${p.x} ${p.y}`).join(' L ')} Z` : ''

/** World point from a wall-local (u, v) pair — same mapping the renderers use. */
export const worldPoint = (s: WallSolid, u: number, v: number): Vec2 =>
  add(add(s.frame.origin, scale(s.frame.dir, u)), scale(perp(s.frame.dir), v))

/**
 * Light tint of a floor color: mix(color, white, 0.55) — channels lerp
 * toward 255 (no hex literal here; lint:colors). Memoized per (id, theme).
 */
const floorTints = new WeakMap<Theme2D, Map<string, string>>()
function floorTint(floorId: string, theme: Theme2D): string {
  let byId = floorTints.get(theme)
  if (!byId) {
    byId = new Map()
    floorTints.set(theme, byId)
  }
  const hit = byId.get(floorId)
  if (hit) return hit
  const hex = floorSpec(floorId).color
  const mixed = [0, 1, 2]
    .map((i) => {
      const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
      return Math.round(c + (255 - c) * 0.55)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')
  const out = '#' + mixed
  byId.set(floorId, out)
  return out
}

export function roomFill(room: DerivedRoom, theme: Theme2D): string {
  const floorId = room.room.floorMaterialId
  if (floorId !== undefined && FLOOR_IDS.has(floorId)) return floorTint(floorId, theme)
  // id-hash pastel — unchanged so docs without floor materials render as before
  const roomId = room.roomId
  let h = 0
  for (let i = 0; i < roomId.length; i++) h = (h * 31 + roomId.charCodeAt(i)) >>> 0
  return theme.roomFills[h % theme.roomFills.length]!
}

export interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface OpeningSymbol {
  /** Paper mask over the wall fill (half thickness + 2mm overhang each side). */
  coverRect: Vec2[]
  /** Jamb ticks across the wall at both ends of the gap (u0 first). */
  jambs: [Line, Line]
  /** Window glazing: triple line along the gap (−half/2, 0, +half/2). */
  windowLines?: Line[]
  /** Door leaf drawn open 90° plus its swing arc. */
  door?: {
    leaf: Line
    arc: { from: Vec2; to: Vec2; r: number; sweep: 0 | 1 }
  }
}

const line = (a: Vec2, b: Vec2): Line => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })

/**
 * The plan symbol of one realized opening — exactly what OpeningsLayer and
 * WallsLayer draw (extracted verbatim; pinned by the exportPlanSvg parity
 * test against the pre-refactor constants).
 */
export function openingSymbol(
  solid: WallSolid,
  wall: Wall,
  realized: RealizedOpening,
  model: Opening,
): OpeningSymbol {
  const half = wall.thickness / 2
  const coverHalf = half + 0.002
  const { u0, u1 } = realized
  const out: OpeningSymbol = {
    coverRect: [
      worldPoint(solid, u0, -coverHalf),
      worldPoint(solid, u1, -coverHalf),
      worldPoint(solid, u1, coverHalf),
      worldPoint(solid, u0, coverHalf),
    ],
    jambs: [
      line(worldPoint(solid, u0, -half), worldPoint(solid, u0, half)),
      line(worldPoint(solid, u1, -half), worldPoint(solid, u1, half)),
    ],
  }
  if (realized.kind === 'window') {
    // triple line along the gap
    out.windowLines = [-half / 2, 0, half / 2].map((v) =>
      line(worldPoint(solid, u0, v), worldPoint(solid, u1, v)),
    )
  } else if (model.kind === 'door') {
    const width = u1 - u0
    const hingeU = model.hinge === 'a' ? u0 : u1
    const farU = model.hinge === 'a' ? u1 : u0
    // leaf drawn open 90°: from the hinge jamb corner, perpendicular to
    // the wall on the swing side ('front' = +perp of a→b)
    const swingSign = model.swing === 'front' ? 1 : -1
    const vJamb = swingSign * half
    const hinge = worldPoint(solid, hingeU, vJamb)
    const leafEnd = worldPoint(solid, hingeU, vJamb + swingSign * width)
    const far = worldPoint(solid, farU, vJamb)
    // Empirically pinned by TWO user checks (M2 y-down, M6 y-up): the
    // y-flip mirrors both the sweep sense AND the leaf side, so the
    // original value stands. Do not re-derive from theory — check the
    // rendered arc.
    const sweep: 0 | 1 = (model.hinge === 'a') === (model.swing === 'front') ? 0 : 1
    out.door = { leaf: line(hinge, leafEnd), arc: { from: leafEnd, to: far, r: width, sweep } }
  }
  return out
}
