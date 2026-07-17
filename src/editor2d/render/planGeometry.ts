import type { Vec2 } from '../../geometry/vec'
import { add, perp, scale } from '../../geometry/vec'
import type { RealizedOpening, WallSolid } from '../../geometry/wallSolids'
import type { Opening, Room, Wall } from '../../model/types'
import type { DerivedRoom } from '../../store/derived'
import type { Theme2D } from '../../theme/theme2d'
import { FLOOR_IDS, floorSpec } from '../../catalog/palette'
import { roomTypeSpec } from '../../catalog/roomTypes'
import { openingStyleSpec } from '../../catalog/openingStyles'

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

/** Ink roles — the styling vocabulary both twins map to strokes. */
export type OpeningInkRole = 'jamb' | 'leaf' | 'glazing' | 'track' | 'passage'

export type OpeningPrim =
  | { kind: 'line'; role: OpeningInkRole; line: Line; dashed?: boolean }
  | { kind: 'arc'; role: 'swing'; arc: { from: Vec2; to: Vec2; r: number; sweep: 0 | 1 } }

export interface OpeningSymbol {
  /** Paper mask over the wall fill (half thickness + 2mm overhang each side). */
  coverRect: Vec2[]
  /**
   * Style-dispatched, role-tagged ink (jambs + leaves/arcs/glazing/tracks).
   * TWO styling twins render it and must stay in agreement:
   * OpeningInkGlyph (editor layer, placement ghost, style cards) and
   * exportPlanSvg's ink emitter.
   */
  ink: OpeningPrim[]
}

const line = (a: Vec2, b: Vec2): Line => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })

export interface DoorGlyph {
  leaf: Line
  arc: { from: Vec2; to: Vec2; r: number; sweep: 0 | 1 }
}

/** The one SVG arc-path serialization of a swing arc (both styling twins). */
export const arcPath = (a: DoorGlyph['arc']): string =>
  `M ${a.from.x} ${a.from.y} A ${a.r} ${a.r} 0 0 ${a.sweep} ${a.to.x} ${a.to.y}`

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

/** The model fields opening ink depends on (ghosts fabricate this). */
export type OpeningInkModel =
  | { kind: 'door'; hinge: 'a' | 'b'; swing: 'front' | 'back'; style?: string }
  | { kind: 'window'; style?: string }

/** Fraction of the gap each sliding panel spans (they overlap mid-gap). */
const SLIDING_PANEL_FRACTION = 0.6
/** Dashed overhead-track depth for garage doors (m beyond the wall face). */
const GARAGE_TRACK_DEPTH = 0.45

/**
 * Style-dispatched opening ink from a wall-local (u, v) → world mapping —
 * THE one geometry source shared by placed openings (openingSymbol), the
 * place-opening ghost, and the catalog style cards. Unknown style ids
 * resolve to standard (open registry). Swing arcs are built ONLY through
 * doorGlyph — double doors compose two half-width calls, so the pinned
 * sweep flags flow through, never re-derived.
 */
export function openingInk(
  pt: (u: number, v: number) => Vec2,
  u0: number,
  u1: number,
  half: number,
  model: OpeningInkModel,
): OpeningPrim[] {
  const width = u1 - u0
  const ln = (role: OpeningInkRole, a: Vec2, b: Vec2, dashed?: boolean): OpeningPrim => ({
    kind: 'line',
    role,
    line: line(a, b),
    ...(dashed ? { dashed: true } : {}),
  })
  const swingPrims = (g: DoorGlyph): OpeningPrim[] => [
    { kind: 'line', role: 'leaf', line: g.leaf },
    { kind: 'arc', role: 'swing', arc: g.arc },
  ]
  const prims: OpeningPrim[] = [
    ln('jamb', pt(u0, -half), pt(u0, half)),
    ln('jamb', pt(u1, -half), pt(u1, half)),
  ]
  if (model.kind === 'window') {
    // v1: every window style shares the triple glazing line — full-height/
    // panorama/arched differ in dims and 3D, not in plan ink
    for (const v of [-half / 2, 0, half / 2]) prims.push(ln('glazing', pt(u0, v), pt(u1, v)))
    return prims
  }
  const style = openingStyleSpec('door', model.style).id
  const swingSign = model.swing === 'front' ? 1 : -1
  switch (style) {
    case 'sliding': {
      // two overlapping panels offset to either face; the ACTIVE panel
      // starts at the hinge end, on the swing side
      const span = width * SLIDING_PANEL_FRACTION
      const nearA: [number, number] = [u0, u0 + span]
      const nearB: [number, number] = [u1 - span, u1]
      const active = model.hinge === 'a' ? nearA : nearB
      const parked = model.hinge === 'a' ? nearB : nearA
      const v = swingSign * (half / 2)
      prims.push(ln('leaf', pt(active[0], v), pt(active[1], v)))
      prims.push(ln('leaf', pt(parked[0], -v), pt(parked[1], -v)))
      break
    }
    case 'double': {
      const mid = (u0 + u1) / 2
      prims.push(...swingPrims(doorGlyph(pt, u0, mid, 'a', model.swing, half)))
      prims.push(...swingPrims(doorGlyph(pt, mid, u1, 'b', model.swing, half)))
      break
    }
    case 'garage': {
      // closed panel across the gap + dashed overhead track into the room
      prims.push(ln('leaf', pt(u0, 0), pt(u1, 0)))
      const vNear = swingSign * half
      const vFar = swingSign * (half + GARAGE_TRACK_DEPTH)
      prims.push(ln('track', pt(u0, vNear), pt(u0, vFar), true))
      prims.push(ln('track', pt(u1, vNear), pt(u1, vFar), true))
      prims.push(ln('track', pt(u0, vFar), pt(u1, vFar), true))
      break
    }
    case 'passage': {
      // open pass-through: dashed face lines, no leaf, no arc
      prims.push(ln('passage', pt(u0, -half), pt(u1, -half), true))
      prims.push(ln('passage', pt(u0, half), pt(u1, half), true))
      break
    }
    default:
      // standard + balcony (the glazed distinction is 3D-only in plan)
      prims.push(...swingPrims(doorGlyph(pt, u0, u1, model.hinge, model.swing, half)))
  }
  return prims
}

/**
 * The plan symbol of one realized opening — exactly what OpeningsLayer and
 * WallsLayer draw (pinned by the exportPlanSvg parity test against the
 * pre-refactor constants).
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
  return {
    coverRect: [
      worldPoint(solid, u0, -coverHalf),
      worldPoint(solid, u1, -coverHalf),
      worldPoint(solid, u1, coverHalf),
      worldPoint(solid, u0, coverHalf),
    ],
    ink: openingInk(
      (u, v) => worldPoint(solid, u, v),
      u0,
      u1,
      half,
      model.kind === 'door'
        ? {
            kind: 'door',
            hinge: model.hinge,
            swing: model.swing,
            ...(model.style ? { style: model.style } : {}),
          }
        : { kind: 'window', ...(model.style ? { style: model.style } : {}) },
    ),
  }
}
