import type { Vec2 } from '../../geometry/vec'
import { add, perp, scale } from '../../geometry/vec'
import type { RealizedOpening, WallSolid } from '../../geometry/wallSolids'
import type { Opening, Room, Wall } from '../../model/types'
import type { DerivedRoom } from '../../store/derived'
import type { Theme2D } from '../../theme/theme2d'
import { FLOOR_IDS, floorSpec } from '../../catalog/palette'
import { roomTypeSpec } from '../../catalog/roomTypes'

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
 * The ONE furniture symbol placement transform (SVG syntax), shared by
 * WorldLayers, exportPlanSvg, and the InteractionOverlay ghost: trailing
 * scale(-1 1) = reflection across item-local x=0 BEFORE the rotation (SVG
 * lists apply right-to-left) — world = T·R·S(-1,1). Per-instance size
 * scaling is a separate inner group at the call sites that need it.
 */
export const furnitureTransform = (
  x: number,
  y: number,
  rotation: number,
  mirrored: boolean | undefined,
): string =>
  `translate(${x} ${y}) rotate(${(rotation * 180) / Math.PI})${mirrored ? ' scale(-1 1)' : ''}`

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

/**
 * Room label lines (0.8.0) — ONE source for the WorldLayers / exportPlanSvg
 * styling twins (they must never fork). Title = name, else the KNOWN room
 * type's display name, else the 'Room' sentinel; the small type line
 * appears only when a name AND a known type would otherwise both be lost.
 * Unknown/absent roomType ids render no badge (open-registry fallback).
 */
export function roomLabelLines(room: Room): { title: string; typeLine: string | null } {
  const typeName = roomTypeSpec(room.roomType)?.name ?? null
  if (room.name) {
    // a name that IS the type name (room "Bathroom" typed bathroom) must
    // not print twice
    return { title: room.name, typeLine: typeName !== room.name ? typeName : null }
  }
  return { title: typeName ?? 'Room', typeLine: null }
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

export type DoorGlyph = NonNullable<OpeningSymbol['door']>

/**
 * Door leaf + swing arc from a wall-local (u, v) → world mapping — THE one
 * source of the arc geometry, shared by openingSymbol (realized openings)
 * and the place-opening tool's pre-click ghost (which maps u/v from raw
 * node arithmetic instead of a WallSolid). Parameterizing the mapping is
 * what keeps the EMPIRICALLY PINNED sweep flags from ever forking.
 */
export function doorGlyph(
  pt: (u: number, v: number) => Vec2,
  u0: number,
  u1: number,
  hinge: 'a' | 'b',
  swing: 'front' | 'back',
  half: number,
): DoorGlyph {
  const width = u1 - u0
  const hingeU = hinge === 'a' ? u0 : u1
  const farU = hinge === 'a' ? u1 : u0
  // leaf drawn open 90°: from the hinge jamb corner, perpendicular to
  // the wall on the swing side ('front' = +perp of a→b)
  const swingSign = swing === 'front' ? 1 : -1
  const vJamb = swingSign * half
  const hingePt = pt(hingeU, vJamb)
  const leafEnd = pt(hingeU, vJamb + swingSign * width)
  const far = pt(farU, vJamb)
  // Empirically pinned by TWO user checks (M2 y-down, M6 y-up): the
  // y-flip mirrors both the sweep sense AND the leaf side, so the
  // original value stands. Do not re-derive from theory — check the
  // rendered arc.
  const sweep: 0 | 1 = (hinge === 'a') === (swing === 'front') ? 0 : 1
  return { leaf: line(hingePt, leafEnd), arc: { from: leafEnd, to: far, r: width, sweep } }
}

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
    out.door = doorGlyph(
      (u, v) => worldPoint(solid, u, v),
      u0,
      u1,
      model.hinge,
      model.swing,
      half,
    )
  }
  return out
}
