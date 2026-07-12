import type { Opening, Wall, WallNode } from '../model/types'
import { DEFAULTS } from '../model/types'
import type { NodeId, OpeningId, WallId } from '../model/ids'
import type { Vec2 } from './vec'
import { normalize, sub } from './vec'
import { clipHalfPlane } from './polygon'
import { GEOM_EPS } from './constants'

/**
 * 3D wall geometry as prism decomposition — the no-CSG approach.
 *
 * Everything here is wall-LOCAL 2D math: u along a→b, v the +perp(a→b)
 * lateral, z up. PINNED: local +v ≡ +perp(a→b) ≡ the door-swing 'front'
 * side; the 3D layer extrudes prisms and places them via `frame` as
 * origin + dir·u + perp(dir)·v. Openings are only legal inside the straight
 * core (between the innermost miter vertices, provided by
 * computeWallOutlines), so every cut plane slices a plain rectangle —
 * watertight by construction.
 *
 * Contract with OpeningFixtures/2D covers: `openings` in the result are the
 * REALIZED intervals (post-clamp). Consumers must never re-derive from raw
 * opening.t/width — hole and fixture would diverge.
 */
export interface Prism {
  /** Wall-local (u,v) ring, positive shoelace. */
  polygon: Vec2[]
  z0: number
  z1: number
}

export interface RealizedOpening {
  openingId: OpeningId
  kind: 'door' | 'window'
  u0: number
  u1: number
  /** Vertical hole extent (door: 0..height, window: sill..sill+height). */
  z0: number
  z1: number
}

export interface WallFrame {
  /** World position of node a. */
  origin: Vec2
  /** Unit direction a→b. */
  dir: Vec2
  /** Centerline length. */
  length: number
}

export interface WallSolid {
  wallId: WallId
  frame: WallFrame
  prisms: Prism[]
  openings: RealizedOpening[]
  /** True when an opening had to be re-clamped/dropped here (dev warning). */
  clamped: boolean
}

export function buildWallSolid(
  wall: Wall,
  nodeA: WallNode,
  nodeB: WallNode,
  openings: readonly Opening[],
  outline: readonly Vec2[],
  core: readonly [number, number],
): WallSolid {
  const A: Vec2 = { x: nodeA.x, y: nodeA.y }
  const B: Vec2 = { x: nodeB.x, y: nodeB.y }
  const d = sub(B, A)
  const length = Math.hypot(d.x, d.y)
  const dir = length > GEOM_EPS ? normalize(d) : { x: 1, y: 0 }
  const frame: WallFrame = { origin: A, dir, length }
  const H = wall.height

  // Outline → wall-local coordinates: u = dot(off, dir), v = dot(off, perp(dir)).
  const local = outline.map((p) => {
    const dx = p.x - A.x
    const dy = p.y - A.y
    return { x: dx * dir.x + dy * dir.y, y: dy * dir.x - dx * dir.y }
  })
  if (local.length < 3 || length <= GEOM_EPS) {
    return { wallId: wall.id, frame, prisms: [], openings: [], clamped: false }
  }
  const uMin = Math.min(...local.map((p) => p.x))
  const uMax = Math.max(...local.map((p) => p.x))

  // --- clamp openings into the core (defensive re-check of the model clamp) ---
  const m = DEFAULTS.openingCoreMargin
  const lo = core[0] + m
  const hi = core[1] - m
  let clamped = false
  const realized: RealizedOpening[] = []
  const sorted = openings
    .slice()
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
  let cursor = lo
  for (const op of sorted) {
    const w = op.width
    if (hi - cursor < w) {
      clamped = true // cannot fit — drop (model should have prevented this)
      continue
    }
    let u0 = op.t * length - w / 2
    let u1 = op.t * length + w / 2
    if (u0 < cursor) {
      clamped = clamped || cursor - u0 > GEOM_EPS
      u0 = cursor
      u1 = cursor + w
    }
    if (u1 > hi) {
      clamped = clamped || u1 - hi > GEOM_EPS
      u1 = hi
      u0 = hi - w
      if (u0 < cursor) {
        clamped = true
        continue
      }
    }
    // vertical clamps
    if (op.kind === 'door') {
      const z1 = Math.min(op.height, H - DEFAULTS.openingHeadroom)
      if (z1 <= GEOM_EPS) {
        clamped = true
        continue
      }
      realized.push({ openingId: op.id, kind: 'door', u0, u1, z0: 0, z1 })
    } else {
      const sill = Math.min(Math.max(op.sillHeight, 0), H - DEFAULTS.openingHeadroom)
      const z1 = Math.min(sill + op.height, H - DEFAULTS.openingHeadroom)
      if (z1 - sill <= GEOM_EPS) {
        clamped = true
        continue
      }
      realized.push({ openingId: op.id, kind: 'window', u0, u1, z0: sill, z1 })
    }
    cursor = u1 + m
  }

  // --- prisms ---
  const prisms: Prism[] = []
  const pushClip = (a: number, b: number, z0: number, z1: number) => {
    if (b - a <= GEOM_EPS || z1 - z0 <= GEOM_EPS) return
    // clip local outline to u ∈ [a, b]
    let poly = clipHalfPlane(local, { x: -1, y: 0 }, -a) // u >= a
    poly = clipHalfPlane(poly, { x: 1, y: 0 }, b) // u <= b
    if (poly.length >= 3) prisms.push({ polygon: poly, z0, z1 })
  }

  let cur = uMin
  for (const op of realized) {
    pushClip(cur, op.u0, 0, H) // full-height piece before the opening
    if (op.kind === 'door') {
      pushClip(op.u0, op.u1, op.z1, H) // lintel
    } else {
      pushClip(op.u0, op.u1, 0, op.z0) // sill wall below window
      pushClip(op.u0, op.u1, op.z1, H) // lintel above window
    }
    cur = op.u1
  }
  pushClip(cur, uMax, 0, H)

  return { wallId: wall.id, frame, prisms, openings: realized, clamped }
}

export interface PatchSolid {
  nodeId: NodeId
  /** WORLD-coordinate ring (patches are node-centric, not wall-local). */
  polygon: Vec2[]
  z0: 0
  z1: number
}

/** Extrude node patches to the minimum height of their incident walls. */
export function buildPatchSolids(
  nodes: Record<NodeId, WallNode>,
  walls: Record<WallId, Wall>,
  nodePatches: Record<NodeId, Vec2[]>,
): PatchSolid[] {
  const heightAt = new Map<NodeId, number>()
  for (const w of Object.values(walls)) {
    heightAt.set(w.a, Math.min(heightAt.get(w.a) ?? Infinity, w.height))
    heightAt.set(w.b, Math.min(heightAt.get(w.b) ?? Infinity, w.height))
  }
  const out: PatchSolid[] = []
  for (const [nodeId, polygon] of Object.entries(nodePatches) as [NodeId, Vec2[]][]) {
    if (!nodes[nodeId]) continue
    const h = heightAt.get(nodeId)
    if (!h || !Number.isFinite(h) || h <= GEOM_EPS) continue
    out.push({ nodeId, polygon, z0: 0, z1: h })
  }
  return out
}
