import type { LevelDoc } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'
import { dist, len } from '../../geometry/vec'
import { closestPointOnSegment } from '../../geometry/segment'
import { pointInPolygon, polygonBounds, signedArea } from '../../geometry/polygon'
import { GEOM_EPS } from '../../geometry/constants'
import { CATALOG } from '../../catalog'

/**
 * Walk-mode collision core — PURE plan-space (x right, y down, meters) 2D
 * math. No three.js, no React, no stores; the 3D layer maps positions
 * through walkMath's plan↔world helpers.
 *
 * The player is a disc of PLAYER_RADIUS. Obstacles are stored UNINFLATED —
 * the query radius `r` is the Minkowski inflation, so rect corners and door
 * jambs behave as exact rounded corners: the passable span for the disc
 * CENTER through a door [u0, u1] is [u0 + r, u1 − r] (effective width =
 * width − 2r).
 *
 * Per wall, the blocking span along the frame is the OUTLINE polygon's
 * u-extent (NOT [0, length]) so outer L-corner miters are solid — no notch —
 * minus realized DOOR intervals only. Windows always block: the disc lives
 * on the floor and never slices by eye height. Node patches block as
 * polygon obstacles.
 */
export const PLAYER_RADIUS = 0.25
export const EYE_HEIGHT = 1.6
/** MUST stay < PLAYER_RADIUS (anti-tunnel invariant — asserted in a test). */
export const MAX_SUBSTEP = 0.1
export const RESOLVE_PASSES = 3
/**
 * Furniture blocking bands (both exclusive; ADDITIVE to the wall spans —
 * the doors-only passability oracle above governs WALLS and is untouched):
 * - body band (BODY_BAND_LO..HI): torso-height obstacles; rugs pass under.
 * - eye band (EYE_BAND_LO..HI): anything overlapping the camera slab around
 *   EYE_HEIGHT also blocks, else walking "under" it clips the near plane
 *   through its interior. The stock wall-cabinet (1.45–2.15m) blocks for
 *   this reason; genuinely overhead items (elevation ≥ EYE_BAND_HI) pass.
 */
export const BODY_BAND_LO = 0.3
export const BODY_BAND_HI = 1.2
export const EYE_BAND_LO = EYE_HEIGHT - 0.2
export const EYE_BAND_HI = EYE_HEIGHT + 0.2

/** Extra clearance left after a push-out so the contact does not re-fire. */
const PUSH_EPS = 1e-4
/** AABBs are pre-inflated for queries with r ≤ PLAYER_RADIUS. */
const AABB_PAD = PLAYER_RADIUS + 1e-3
const TELEPORT_PASSES = 8

export interface RectObstacle {
  kind: 'rect'
  cx: number
  cy: number
  /** Unit axis — the wall frame direction, or a furniture item's rotation. */
  ux: number
  uy: number
  /** Half-extent along the axis (half span / half width). */
  hu: number
  /** Half-extent along perp(axis) (half thickness / half depth). */
  hv: number
}

export interface PolyObstacle {
  kind: 'poly'
  /** World-space ring, positive shoelace. */
  ring: Vec2[]
}

export type Obstacle = RectObstacle | PolyObstacle

export interface CollisionSet {
  obstacles: Obstacle[]
  aabbs: { minX: number; minY: number; maxX: number; maxY: number }[]
}

export function buildCollisionSet(doc: LevelDoc, derived: DerivedGeometry): CollisionSet {
  const obstacles: Obstacle[] = []

  for (const solid of Object.values(derived.wallSolids)) {
    if (!solid.prisms.length) continue
    const wall = doc.walls[solid.wallId]
    const outline = derived.outlines.wallPolygons[solid.wallId]
    if (!wall || !outline || outline.length < 3) continue
    const { origin, dir } = solid.frame

    // Outline span along the frame — extends blocking to the miter corners.
    let uMin = Infinity
    let uMax = -Infinity
    for (const p of outline) {
      const u = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y
      if (u < uMin) uMin = u
      if (u > uMax) uMax = u
    }

    // Blocking intervals = span minus realized DOOR intervals (windows block).
    // solid.openings is already sorted and non-overlapping along u.
    const spans: [number, number][] = []
    let cur = uMin
    for (const op of solid.openings) {
      if (op.kind !== 'door') continue
      spans.push([cur, op.u0])
      cur = Math.max(cur, op.u1)
    }
    spans.push([cur, uMax])

    const hv = wall.thickness / 2
    for (const [a, b] of spans) {
      if (b - a <= GEOM_EPS) continue
      const mid = (a + b) / 2
      obstacles.push({
        kind: 'rect',
        cx: origin.x + dir.x * mid,
        cy: origin.y + dir.y * mid,
        ux: dir.x,
        uy: dir.y,
        hu: (b - a) / 2,
        hv,
      })
    }
  }

  for (const patch of derived.patchSolids) {
    const ring = patch.polygon
    if (ring.length < 3) continue
    obstacles.push({
      kind: 'poly',
      ring: signedArea(ring) >= 0 ? ring : ring.slice().reverse(),
    })
  }

  // Furniture in the body or eye band — exact rotated footprints as rects.
  // `mirrored` reflects the mesh only; the w×d footprint is axis-symmetric.
  // Catalog `passable` items (curtains, blinds) never block regardless of
  // bands — fabric yields; unknown catalog ids fall through to blocking.
  // v7 elevated room floors LIFT their furniture's vertical extent (the
  // walker itself stays at the level plane — podiums are visual v1).
  const liftedRooms = Object.values(derived.rooms).filter(
    (r) => (r.room.floorElevation ?? 0) > 0,
  )
  const liftOf = (fx: number, fy: number): number =>
    liftedRooms.find(
      (r) =>
        pointInPolygon({ x: fx, y: fy }, r.polygon) &&
        !r.holePolygons.some((h) => pointInPolygon({ x: fx, y: fy }, h)),
    )?.room.floorElevation ?? 0
  for (const f of Object.values(doc.furniture)) {
    if (CATALOG[f.catalogItemId]?.passable) continue
    const lift = liftOf(f.x, f.y)
    const lo = lift + f.elevation
    const hi = lift + f.elevation + f.size.h
    const inBody = lo < BODY_BAND_HI && hi > BODY_BAND_LO
    const inEye = lo < EYE_BAND_HI && hi > EYE_BAND_LO
    if (!inBody && !inEye) continue
    obstacles.push({
      kind: 'rect',
      cx: f.x,
      cy: f.y,
      ux: Math.cos(f.rotation),
      uy: Math.sin(f.rotation),
      hu: f.size.w / 2,
      hv: f.size.d / 2,
    })
  }

  const aabbs = obstacles.map((o) => {
    if (o.kind === 'rect') {
      const ex = Math.abs(o.ux) * o.hu + Math.abs(o.uy) * o.hv + AABB_PAD
      const ey = Math.abs(o.uy) * o.hu + Math.abs(o.ux) * o.hv + AABB_PAD
      return { minX: o.cx - ex, minY: o.cy - ey, maxX: o.cx + ex, maxY: o.cy + ey }
    }
    const b = polygonBounds([o.ring])!
    return {
      minX: b.minX - AABB_PAD,
      minY: b.minY - AABB_PAD,
      maxX: b.maxX + AABB_PAD,
      maxY: b.maxY + AABB_PAD,
    }
  })

  return { obstacles, aabbs }
}

const setCache = new WeakMap<LevelDoc, CollisionSet>()

/** Memoized on document identity (getDerived pattern — immer commits swap the doc object). */
export function getCollisionSet(doc: LevelDoc, derived: DerivedGeometry): CollisionSet {
  const hit = setCache.get(doc)
  if (hit) return hit
  const set = buildCollisionSet(doc, derived)
  setCache.set(doc, set)
  return set
}

export interface Contact {
  /** Push distance along (nx, ny) that leaves the disc exactly clear. */
  depth: number
  nx: number
  ny: number
}

/** Deepest disc-vs-obstacle contact, or null when the disc is clear of it. */
export function contact(p: Vec2, o: Obstacle, r: number): Contact | null {
  if (o.kind === 'rect') {
    const ox = p.x - o.cx
    const oy = p.y - o.cy
    const du = ox * o.ux + oy * o.uy
    const dv = -ox * o.uy + oy * o.ux // dot with perp(axis) = (−uy, ux)
    const au = Math.abs(du)
    const av = Math.abs(dv)
    if (au <= o.hu && av <= o.hv) {
      // Center inside the box: push out the nearer face (tie → v).
      const remU = o.hu - au
      const remV = o.hv - av
      if (remU < remV) {
        const s = du >= 0 ? 1 : -1
        return { depth: r + remU, nx: s * o.ux, ny: s * o.uy }
      }
      const s = dv >= 0 ? 1 : -1
      return { depth: r + remV, nx: s * -o.uy, ny: s * o.ux }
    }
    const eu = du - Math.max(-o.hu, Math.min(o.hu, du))
    const ev = dv - Math.max(-o.hv, Math.min(o.hv, dv))
    const d = Math.hypot(eu, ev)
    if (d >= r) return null
    const nu = eu / d
    const nv = ev / d
    return { depth: r - d, nx: nu * o.ux - nv * o.uy, ny: nu * o.uy + nv * o.ux }
  }

  const ring = o.ring
  let bestD = Infinity
  let bestQ: Vec2 = ring[0]!
  let bestI = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const { point } = closestPointOnSegment(p, a, b)
    const d = dist(p, point)
    if (d < bestD) {
      bestD = d
      bestQ = point
      bestI = i
    }
  }
  const edgeNormal = (): Vec2 => {
    // Outward normal of a positive-shoelace ring edge in plan y-down space.
    const a = ring[bestI]!
    const b = ring[(bestI + 1) % ring.length]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const L = Math.hypot(ex, ey) || 1
    return { x: ey / L, y: -ex / L }
  }
  if (pointInPolygon(p, ring)) {
    const n = edgeNormal()
    return { depth: r + bestD, nx: n.x, ny: n.y }
  }
  if (bestD >= r) return null
  if (bestD < 1e-12) {
    // Exactly on the boundary: (p − q) is degenerate, use the edge normal.
    const n = edgeNormal()
    return { depth: r, nx: n.x, ny: n.y }
  }
  return { depth: r - bestD, nx: (p.x - bestQ.x) / bestD, ny: (p.y - bestQ.y) / bestD }
}

function deepestContact(set: CollisionSet, p: Vec2, r: number): Contact | null {
  let best: Contact | null = null
  for (let i = 0; i < set.obstacles.length; i++) {
    const box = set.aabbs[i]!
    if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue
    const c = contact(p, set.obstacles[i]!, r)
    if (c && (!best || c.depth > best.depth)) best = c
  }
  return best
}

/**
 * Advance the disc by `delta` with substepped deepest-first push-out.
 * Sliding along faces emerges from normal-only resolution — tangential
 * motion is never removed.
 */
export function resolveMove(
  set: CollisionSet,
  from: Vec2,
  delta: Vec2,
  r: number = PLAYER_RADIUS,
): Vec2 {
  const n = Math.max(1, Math.ceil(len(delta) / MAX_SUBSTEP))
  const sx = delta.x / n
  const sy = delta.y / n
  const pos = { x: from.x, y: from.y }
  for (let i = 0; i < n; i++) {
    pos.x += sx
    pos.y += sy
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      const c = deepestContact(set, pos, r)
      if (!c) break
      pos.x += c.nx * (c.depth + PUSH_EPS)
      pos.y += c.ny * (c.depth + PUSH_EPS)
    }
  }
  return pos
}

/**
 * Validate a teleport target: deepest-push the point until clear (≤ 8
 * passes). Returns the clear point when it converged within `maxNudge` of
 * the request, else null.
 */
export function validateTeleport(
  set: CollisionSet,
  p: Vec2,
  r: number = PLAYER_RADIUS,
  maxNudge = 0.5,
): Vec2 | null {
  const q = { x: p.x, y: p.y }
  for (let pass = 0; pass < TELEPORT_PASSES; pass++) {
    const c = deepestContact(set, q, r)
    if (!c) break
    q.x += c.nx * (c.depth + PUSH_EPS)
    q.y += c.ny * (c.depth + PUSH_EPS)
  }
  if (deepestContact(set, q, r)) return null
  return dist(q, p) <= maxNudge ? q : null
}
