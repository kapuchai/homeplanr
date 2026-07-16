import type { ProjectDocument, Wall } from '../../model/types'
import type { FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../../model/ids'
import type { DerivedGeometry } from '../../store/derived'
import type { DimensionPill } from '../session/interactionStore'
import type { WallSolid } from '../../geometry/wallSolids'
import type { DimensionLevel } from '../../store/appSettings'
import { formatLength, type UnitSystem } from '../../format/units'
import type { Vec2 } from '../../geometry/vec'
import { add, cross, dist, lerp, normalize, perp, rotate, scale, sub } from '../../geometry/vec'
import { segSegIntersection } from '../../geometry/segment'
import { pointInPolygonWithHoles } from '../../geometry/polygon'
import { PILL_H_PX, pillHalfExtentPx } from '../render/pillMetrics'

/**
 * Live drag measurements + permanent wall dimensions — PURE (type-only store
 * imports; callers snapshot everything into MeasureInput). Distances are
 * architectural: opening gaps end at the straight-core corner faces (never
 * node positions) and furniture rays hit wall FACES, not centerlines.
 */
export interface MeasureInput {
  doc: ProjectDocument
  derived: DerivedGeometry
  /** meters per screen px at current zoom. */
  pxToWorld: number
  units: UnitSystem
  /** Permanent dimension ladder (0.7.0) — any level that labels walls
   * suppresses the passive full-wall drag pills so the same wall length
   * never renders twice (B4). */
  dimensionLevel?: DimensionLevel
}

/** Furniture rays longer than this (m) measure nothing. */
export const MEASURE_MAX_DIST = 8
/** Pill anchor offset from the measured geometry, screen px. */
export const PILL_OFFSET_PX = 16
/** Gaps below this (m) are flush placements — suppressed. */
export const MIN_GAP = 0.005
/**
 * Visual gap between geometry and the pill BOX EDGE (screen px). Pills
 * are centered on their anchor, so the anchor offset must clear the box's
 * half-extent along the offset normal (half-WIDTH for vertical walls —
 * the 0.5.0 checklist caught side labels sitting on the wall when a flat
 * 16 px offset only cleared the half-height). 16 − 18/2 keeps horizontal
 * labels exactly where they were.
 */
const PILL_GAP_PX = PILL_OFFSET_PX - PILL_H_PX / 2

/** Anchor offset (px) that clears the pill box along unit normal n. */
const pillClearancePx = (text: string, n: Vec2): number =>
  pillHalfExtentPx(text, n) + PILL_GAP_PX

export function incidentWallIds(doc: ProjectDocument, nodeId: NodeId): WallId[] {
  const out: WallId[] = []
  for (const w of Object.values(doc.walls)) {
    if (w.a === nodeId || w.b === nodeId) out.push(w.id)
  }
  return out
}

/** World point from a wall-local (u, v) pair — same mapping the renderers use. */
const facePoint = (s: WallSolid, u: number, v: number): Vec2 =>
  add(add(s.frame.origin, scale(s.frame.dir, u)), scale(perp(s.frame.dir), v))

/**
 * Pills for an opening drag: its own width plus the free run to each
 * neighbor (adjacent realized opening, else the core end). Everything sits
 * on the wall face on the CURSOR's side.
 */
export function openingDragPills(
  m: MeasureInput,
  openingId: OpeningId,
  cursor: Vec2,
): DimensionPill[] {
  const op = m.doc.openings[openingId]
  const wall = op && m.doc.walls[op.wallId]
  const solid = op && m.derived.wallSolids[op.wallId]
  const core = op && m.derived.outlines.wallCores[op.wallId]
  if (!op || !wall || !solid || !core) return []
  const idx = solid.openings.findIndex((o) => o.openingId === openingId)
  const self = solid.openings[idx]
  if (!self) return [] // realization dropped it mid-drag

  const side = cross(solid.frame.dir, sub(cursor, solid.frame.origin)) >= 0 ? 1 : -1
  const vFace = (side * wall.thickness) / 2
  const n = scale(perp(solid.frame.dir), side)
  const off = (text: string) => scale(n, pillClearancePx(text, n) * m.pxToWorld)

  const widthText = formatLength(self.u1 - self.u0, m.units)
  const pills: DimensionPill[] = [
    {
      at: add(facePoint(solid, (self.u0 + self.u1) / 2, vFace), off(widthText)),
      text: widthText,
    },
  ]
  const prev = solid.openings[idx - 1]
  const next = solid.openings[idx + 1]
  const gaps: [number, number][] = [
    [prev ? Math.max(prev.u1, core[0]) : core[0], self.u0],
    [self.u1, next ? Math.min(next.u0, core[1]) : core[1]],
  ]
  for (const [u0, u1] of gaps) {
    const gap = u1 - u0
    if (gap < MIN_GAP) continue
    const from = facePoint(solid, u0, vFace)
    const to = facePoint(solid, u1, vFace)
    const text = formatLength(gap, m.units)
    pills.push({
      at: add(lerp(from, to, 0.5), off(text)),
      text,
      from,
      to,
    })
  }
  return pills
}

/**
 * Pills for a furniture drag: one clearance measurement per OBB edge
 * (edge-midpoint ray along the local axis, front = local −y per handles.ts,
 * nearest wall-face hit within MEASURE_MAX_DIST), plus one passive
 * full-length pill per unique wall hit — unless the dimension ladder already
 * labels every wall permanently (the clearance pills are the useful part).
 */
export function furnitureDragPills(m: MeasureInput, grabbedId: FurnitureId): DimensionPill[] {
  const f = m.doc.furniture[grabbedId]
  if (!f) return []
  const center: Vec2 = { x: f.x, y: f.y }
  const locals: Vec2[] = [
    { x: 0, y: -f.size.d / 2 }, // front
    { x: 0, y: f.size.d / 2 }, // back
    { x: -f.size.w / 2, y: 0 }, // left
    { x: f.size.w / 2, y: 0 }, // right
  ]
  const pills: DimensionPill[] = []
  const passiveByWall = new Map<WallId, DimensionPill>()

  for (const local of locals) {
    const arm = rotate(local, f.rotation)
    const dir = normalize(arm)
    if (dir.x === 0 && dir.y === 0) continue
    const edgeMid = add(center, arm)
    const rayEnd = add(edgeMid, scale(dir, MEASURE_MAX_DIST))
    const rMinX = Math.min(edgeMid.x, rayEnd.x)
    const rMaxX = Math.max(edgeMid.x, rayEnd.x)
    const rMinY = Math.min(edgeMid.y, rayEnd.y)
    const rMaxY = Math.max(edgeMid.y, rayEnd.y)

    let best: { d: number; hit: Vec2; wallId: WallId } | null = null
    for (const w of Object.values(m.doc.walls)) {
      const na = m.doc.nodes[w.a]
      const nb = m.doc.nodes[w.b]
      if (!na || !nb) continue
      const half = w.thickness / 2
      // coarse AABB reject before the exact face intersections
      if (
        Math.min(na.x, nb.x) - half > rMaxX ||
        Math.max(na.x, nb.x) + half < rMinX ||
        Math.min(na.y, nb.y) - half > rMaxY ||
        Math.max(na.y, nb.y) + half < rMinY
      ) {
        continue
      }
      const wPerp = perp(normalize(sub(nb, na)))
      for (const sgn of [1, -1]) {
        const o = scale(wPerp, sgn * half)
        const ix = segSegIntersection(edgeMid, rayEnd, add(na, o), add(nb, o))
        if (!ix) continue
        const d = ix.t * MEASURE_MAX_DIST
        if (d <= 1e-6) continue // flush against this face
        if (!best || d < best.d) best = { d, hit: ix.p, wallId: w.id }
      }
    }
    if (!best) continue
    pills.push({
      at: lerp(edgeMid, best.hit, 0.5),
      text: formatLength(best.d, m.units),
      from: edgeMid,
      to: best.hit,
    })
    if ((m.dimensionLevel ?? 'off') === 'off' && !passiveByWall.has(best.wallId)) {
      const w = m.doc.walls[best.wallId]!
      const na = m.doc.nodes[w.a]!
      const nb = m.doc.nodes[w.b]!
      const wDir = normalize(sub(nb, na))
      const sideSign = cross(wDir, sub(center, na)) >= 0 ? 1 : -1
      const wn = scale(perp(wDir), sideSign)
      const text = formatLength(dist(na, nb), m.units)
      passiveByWall.set(best.wallId, {
        at: add(lerp(na, nb, 0.5), scale(wn, pillClearancePx(text, wn) * m.pxToWorld)),
        text,
        tone: 'passive',
      })
    }
  }
  return [...pills, ...passiveByWall.values()]
}

/** Centerline-length pill per wall (node and wall drags). */
export function wallLengthPills(m: MeasureInput, wallIds: Iterable<WallId>): DimensionPill[] {
  const pills: DimensionPill[] = []
  for (const id of wallIds) {
    const w = m.doc.walls[id]
    const na = w && m.doc.nodes[w.a]
    const nb = w && m.doc.nodes[w.b]
    if (!w || !na || !nb) continue
    const n = perp(normalize(sub(nb, na)))
    const text = formatLength(dist(na, nb), m.units)
    pills.push({
      at: add(lerp(na, nb, 0.5), scale(n, pillClearancePx(text, n) * m.pxToWorld)),
      text,
    })
  }
  return pills
}

// --- permanent dimension labels (the Shift+D ladder) ---

export interface WallDimensionLabel {
  wallId: WallId
  at: Vec2
  /** Centerline meters — the render layer culls by screen size (k·length). */
  length: number
  text: string
}

export interface OpeningWidthLabel {
  openingId: OpeningId
  at: Vec2
  /** Opening width in meters — same k·length screen cull as wall labels. */
  length: number
  text: string
}

export interface FurnitureSizeLabel {
  furnitureId: FurnitureId
  at: Vec2
  /** max(w, d) in meters — same k·length screen cull as wall labels. */
  length: number
  text: string
}

/** Walls shorter than this (m) never get a permanent label. */
const MIN_LABEL_LENGTH = 0.5
/** Inside-probe distance (m) for picking the label side. */
const SIDE_PROBE = 0.05

const wallRoomsCache = new WeakMap<ProjectDocument, Map<WallId, RoomId[]>>()
const wallRooms = (doc: ProjectDocument): Map<WallId, RoomId[]> => {
  const hit = wallRoomsCache.get(doc)
  if (hit) return hit
  const map = new Map<WallId, RoomId[]>()
  for (const room of Object.values(doc.rooms)) {
    for (const wid of [...room.wallCycle, ...room.holeCycles.flat()]) {
      ;(map.get(wid) ?? map.set(wid, []).get(wid)!).push(room.id)
    }
  }
  wallRoomsCache.set(doc, map)
  return map
}

/**
 * Label side for a wall (+1 = +perp): the OUTSIDE of the owning room.
 * Boundary walls between two rooms (either side is interior) and walls in
 * no room have no outside — they take the SCREEN-UP side deterministically
 * instead of the arbitrary a→b winding side (B5).
 */
function wallLabelSide(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  w: Wall,
  n: Vec2,
  mid: Vec2,
): 1 | -1 {
  const owners = wallRooms(doc).get(w.id)
  const room = owners?.length === 1 ? derived.rooms[owners[0]!] : undefined
  if (room) {
    // +perp probes into the room ⇒ label on the opposite (outside) side
    return pointInPolygonWithHoles(add(mid, scale(n, SIDE_PROBE)), room.polygon, room.holePolygons)
      ? -1
      : 1
  }
  // no unique outside: pick screen-up (+y renders up; vertical walls
  // tie-break toward +x) so the side never depends on a→b winding
  return n.y > 0 || (n.y === 0 && n.x > 0) ? 1 : -1
}

/** One length label per wall ≥ MIN_LABEL_LENGTH, on the wallLabelSide. */
export function dimensionLabels(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  units: UnitSystem,
  pxToWorld = 0,
): WallDimensionLabel[] {
  const out: WallDimensionLabel[] = []
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const length = dist(na, nb)
    if (length < MIN_LABEL_LENGTH) continue
    const n = perp(normalize(sub(nb, na)))
    const mid = lerp(na, nb, 0.5)
    const side = wallLabelSide(doc, derived, w, n, mid)
    const text = formatLength(length, units)
    out.push({
      wallId: w.id,
      at: add(mid, scale(n, side * (w.thickness / 2 + pillClearancePx(text, n) * pxToWorld))),
      length,
      text,
    })
  }
  return out
}

/**
 * One width label per realized opening (ladder level ≥ 'openings'), on the
 * OPPOSITE side of the wall's own length label so the two never collide
 * when an opening sits at the wall's midpoint.
 */
export function openingWidthLabels(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  units: UnitSystem,
  pxToWorld = 0,
): OpeningWidthLabel[] {
  const out: OpeningWidthLabel[] = []
  for (const solid of Object.values(derived.wallSolids)) {
    const w = doc.walls[solid.wallId]
    const na = w && doc.nodes[w.a]
    const nb = w && doc.nodes[w.b]
    if (!w || !na || !nb) continue
    const n = perp(normalize(sub(nb, na)))
    const wallSide = wallLabelSide(doc, derived, w, n, lerp(na, nb, 0.5))
    const side = -wallSide
    for (const o of solid.openings) {
      const width = o.u1 - o.u0
      const text = formatLength(width, units)
      const face = facePoint(solid, (o.u0 + o.u1) / 2, (side * w.thickness) / 2)
      const nSide = scale(n, side)
      out.push({
        openingId: o.openingId,
        at: add(face, scale(nSide, pillClearancePx(text, nSide) * pxToWorld)),
        length: width,
        text,
      })
    }
  }
  return out
}

/**
 * One w × d size label per SELECTED furniture item (ladder level 'all'),
 * hung off the item's BACK edge (local +y, rotation applied) — the rotate
 * handle owns the front edge, and both follow the local frame so they can
 * never collide at any rotation.
 */
export function furnitureSizeLabels(
  doc: ProjectDocument,
  ids: readonly string[],
  units: UnitSystem,
  pxToWorld = 0,
): FurnitureSizeLabel[] {
  const out: FurnitureSizeLabel[] = []
  for (const id of ids) {
    const f = doc.furniture[id as FurnitureId]
    if (!f) continue
    const text = `${formatLength(f.size.w, units)} × ${formatLength(f.size.d, units)}`
    const arm = rotate({ x: 0, y: f.size.d / 2 }, f.rotation)
    const n = normalize(arm)
    out.push({
      furnitureId: f.id,
      at: add(add({ x: f.x, y: f.y }, arm), scale(n, pillClearancePx(text, n) * pxToWorld)),
      length: Math.max(f.size.w, f.size.d),
      text,
    })
  }
  return out
}
