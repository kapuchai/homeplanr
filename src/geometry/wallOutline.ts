import type { WallNode, Wall } from '../model/types'
import type { NodeId, WallId } from '../model/ids'
import type { Vec2 } from './vec'
import { add, angle, cross, dist, normalize, perp, scale, sub } from './vec'
import { lineLineIntersection } from './segment'
import { area, signedArea } from './polygon'
import { EPS, GEOM_EPS, MITER_LIMIT } from './constants'

/**
 * Wall body outlines with miter joins.
 *
 * Tiling contract (relied on by both renderers and by wallSolids):
 * - each wall gets a 4-point polygon bounded by its two flanks and one
 *   corner per flank end (miter intersection, or the flank's own base point
 *   when the join bevels);
 * - each node gets a patch polygon spanning all wedge corners around it.
 *   Wall quads + node patches tile the wall union EXACTLY: no gaps, no
 *   overlaps (so extruded prisms never z-fight and 2D fills are seamless).
 *   For k=2 mitered joins the patch is degenerate and omitted; for k≥3 the
 *   patch is the central polygon no wall quad covers; for bevels it also
 *   fills the bevel notch.
 * - wallCores[w] = [uMin, uMax] along a→b: the straight stretch clear of all
 *   end geometry. Openings must live inside it (single clamp source).
 */
export interface WallOutlines {
  wallPolygons: Record<WallId, Vec2[]>
  nodePatches: Record<NodeId, Vec2[]>
  wallCores: Record<WallId, [number, number]>
}

interface Incident {
  wall: Wall
  /** Unit direction pointing away from the node. */
  dir: Vec2
  theta: number
}

/** corner key: wallId | nodeId | side (L = +perp(awayDir) flank) */
const ck = (w: WallId, n: NodeId, side: 'L' | 'R') => `${w}|${n}|${side}`

export function computeWallOutlines(
  nodes: Record<NodeId, WallNode>,
  walls: Record<WallId, Wall>,
): WallOutlines {
  const corners = new Map<string, Vec2>()
  const nodePatches: Record<NodeId, Vec2[]> = {}

  // Group incident walls per node.
  const incidence = new Map<NodeId, Incident[]>()
  const wallList = Object.values(walls)
  for (const w of wallList) {
    const na = nodes[w.a]
    const nb = nodes[w.b]
    if (!na || !nb) continue
    const d = sub({ x: nb.x, y: nb.y }, { x: na.x, y: na.y })
    if (dist(na, nb) < GEOM_EPS) continue // degenerate; invariants forbid, guard anyway
    const dirAB = normalize(d)
    const listA = incidence.get(w.a) ?? []
    listA.push({ wall: w, dir: dirAB, theta: angle(dirAB) })
    incidence.set(w.a, listA)
    const dirBA = scale(dirAB, -1)
    const listB = incidence.get(w.b) ?? []
    listB.push({ wall: w, dir: dirBA, theta: angle(dirBA) })
    incidence.set(w.b, listB)
  }

  for (const [nodeId, list] of incidence) {
    const node = nodes[nodeId]
    if (!node) continue
    const P: Vec2 = { x: node.x, y: node.y }

    if (list.length === 1) {
      // Dead end: flat butt cap through the node.
      const { wall, dir } = list[0]!
      const off = scale(perp(dir), wall.thickness / 2)
      corners.set(ck(wall.id, nodeId, 'L'), add(P, off))
      corners.set(ck(wall.id, nodeId, 'R'), sub(P, off))
      continue
    }

    // Sort by angle; tie-break by wall id for determinism.
    const sorted = list
      .slice()
      .sort((a, b) => a.theta - b.theta || (a.wall.id < b.wall.id ? -1 : 1))

    const patchRing: Vec2[] = []
    for (let i = 0; i < sorted.length; i++) {
      const wi = sorted[i]!
      const wj = sorted[(i + 1) % sorted.length]!
      // Wedge between wi's L flank (+perp side, toward increasing angle)
      // and wj's R flank (−perp side, back toward wi).
      const basI = add(P, scale(perp(wi.dir), wi.wall.thickness / 2))
      const basJ = sub(P, scale(perp(wj.dir), wj.wall.thickness / 2))

      let cornerI: Vec2
      let cornerJ: Vec2
      const denom = cross(wi.dir, wj.dir)
      let wedge: Vec2[]
      if (Math.abs(denom) < EPS) {
        if (dist(basI, basJ) <= GEOM_EPS) {
          // Collinear pass-through with matching thickness: shared corner.
          cornerI = basI
          cornerJ = basI
          wedge = [basI]
        } else {
          // Parallel/collinear with offset flanks: bevel.
          cornerI = basI
          cornerJ = basJ
          wedge = [basI, basJ]
        }
      } else {
        const c = lineLineIntersection(basI, wi.dir, basJ, wj.dir)
        const limit = MITER_LIMIT * Math.max(wi.wall.thickness, wj.wall.thickness)
        if (!c || dist(c, P) > limit) {
          // Sliver wedge: miter would explode — bevel.
          cornerI = basI
          cornerJ = basJ
          wedge = [basI, basJ]
        } else {
          cornerI = c
          cornerJ = c
          wedge = [c]
        }
      }
      corners.set(ck(wi.wall.id, nodeId, 'L'), cornerI)
      corners.set(ck(wj.wall.id, nodeId, 'R'), cornerJ)
      patchRing.push(...wedge)
    }

    // Patch: the junction area no wall quad covers (central polygon for k≥3,
    // bevel notches for k=2). Degenerate rings are dropped.
    const cleaned = dedupeRing(patchRing)
    if (cleaned.length >= 3 && area(cleaned) > GEOM_EPS) {
      nodePatches[nodeId] = orientPositive(cleaned)
    }
  }

  // Assemble per-wall polygons + straight cores.
  const wallPolygons: Record<WallId, Vec2[]> = {}
  const wallCores: Record<WallId, [number, number]> = {}
  for (const w of wallList) {
    const na = nodes[w.a]
    const nb = nodes[w.b]
    if (!na || !nb) continue
    const A: Vec2 = { x: na.x, y: na.y }
    const B: Vec2 = { x: nb.x, y: nb.y }
    const L = dist(A, B)
    if (L < GEOM_EPS) continue
    const dir = normalize(sub(B, A))

    const rightA = corners.get(ck(w.id, w.a, 'R'))
    const leftA = corners.get(ck(w.id, w.a, 'L'))
    const rightB = corners.get(ck(w.id, w.b, 'R'))
    const leftB = corners.get(ck(w.id, w.b, 'L'))
    if (!rightA || !leftA || !rightB || !leftB) continue

    // Ring: a-end −perp flank → b-end (same physical flank) → cross the b cap
    // → back along +perp flank → close across the a cap. Positive shoelace.
    const ring = [rightA, leftB, rightB, leftA]
    wallPolygons[w.id] = signedArea(ring) >= 0 ? ring : ring.slice().reverse()

    // Straight core along a→b: innermost end-corner u at each side.
    const u = (p: Vec2) => (p.x - A.x) * dir.x + (p.y - A.y) * dir.y
    const uMin = Math.max(u(rightA), u(leftA))
    const uMax = Math.min(u(rightB), u(leftB))
    wallCores[w.id] = [
      Math.min(Math.max(uMin, 0), L),
      Math.max(Math.min(uMax, L), 0),
    ]
  }

  return { wallPolygons, nodePatches, wallCores }
}

function dedupeRing(ring: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (!prev || dist(prev, p) > GEOM_EPS) out.push(p)
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= GEOM_EPS) out.pop()
  return out
}

function orientPositive(ring: Vec2[]): Vec2[] {
  return signedArea(ring) >= 0 ? ring : ring.slice().reverse()
}
