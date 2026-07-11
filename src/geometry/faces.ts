import type { Wall, WallNode } from '../model/types'
import type { NodeId, WallId } from '../model/ids'
import type { Vec2 } from './vec'
import { angle } from './vec'
import { area, centroid, pointInPolygon, pointInPolygonWithHoles, signedArea, stripSpikes } from './polygon'
import { triangulate, type Triangulation } from './triangulate'
import { EPS, GEOM_EPS } from './constants'

/**
 * Room detection: face extraction from the planar wall graph.
 *
 * Half-edge traversal: two directed edges per wall; at each node the
 * successor of an incoming edge (u→v) is the CW-predecessor of the reverse
 * edge (v→u) in v's angle-sorted outgoing list. Under our y-down plan space
 * this traces INTERIOR faces with POSITIVE shoelace area (hand-verified on a
 * unit square; pinned by tests — do not "fix" the sign without them).
 *
 * Hole rule (corrected during plan review): every connected component's
 * unbounded face is a negative cycle — the main building's outline included.
 * A negative cycle is a hole candidate ONLY for rooms of a DIFFERENT
 * component; containment is tested with a strictly interior point of the
 * hole polygon (centroid of its largest earcut triangle), never a boundary
 * vertex; it punches the smallest strictly-containing room, else is the
 * outside world and is discarded.
 */
export interface DetectedFace {
  /** Ordered boundary wall ids (stub walls included once, order preserved). */
  wallCycle: WallId[]
  /** Wall-ID set including stubs — the identity fingerprint for Jaccard. */
  wallSet: Set<WallId>
  /** Cleaned (spike-stripped) boundary polygon, positive shoelace. */
  polygon: Vec2[]
  /** Hole boundaries assigned to this face (island outlines). */
  holeCycles: WallId[][]
  holePolygons: Vec2[][]
  /** Net floor area (outer − holes), m². */
  areaM2: number
  /** Area centroid of the outer polygon (may lie outside for L-shapes). */
  centroid: Vec2
  /** Guaranteed-interior label position. */
  labelAnchor: Vec2
  /** Floor triangulation with holes applied. */
  floor: Triangulation
}

interface HalfEdge {
  wallId: WallId
  from: NodeId
  to: NodeId
}

const ekey = (e: HalfEdge) => `${e.from}>${e.to}`

export function detectFaces(
  nodes: Record<NodeId, WallNode>,
  walls: Record<WallId, Wall>,
): DetectedFace[] {
  // --- build half-edges + per-node angle-sorted outgoing lists ---
  const outgoing = new Map<NodeId, HalfEdge[]>()
  const edges: HalfEdge[] = []
  const wallList = Object.values(walls).filter((w) => {
    const na = nodes[w.a]
    const nb = nodes[w.b]
    return na && nb && (na.x !== nb.x || na.y !== nb.y)
  })
  for (const w of wallList) {
    const ab: HalfEdge = { wallId: w.id, from: w.a, to: w.b }
    const ba: HalfEdge = { wallId: w.id, from: w.b, to: w.a }
    edges.push(ab, ba)
    ;(outgoing.get(w.a) ?? outgoing.set(w.a, []).get(w.a)!).push(ab)
    ;(outgoing.get(w.b) ?? outgoing.set(w.b, []).get(w.b)!).push(ba)
  }
  const theta = (e: HalfEdge) => {
    const f = nodes[e.from]!
    const t = nodes[e.to]!
    return angle({ x: t.x - f.x, y: t.y - f.y })
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => theta(a) - theta(b) || (a.wallId < b.wallId ? -1 : 1))
  }

  // successor(u→v) = CW-predecessor of (v→u) among v's outgoing edges
  const succ = new Map<string, HalfEdge>()
  for (const e of edges) {
    const list = outgoing.get(e.to)!
    const revKey = `${e.to}>${e.from}`
    let idx = -1
    for (let i = 0; i < list.length; i++) {
      const o = list[i]!
      if (o.wallId === e.wallId && ekey(o) === revKey) {
        idx = i
        break
      }
    }
    // (multi-edges are forbidden by invariants; wallId disambiguates anyway)
    const s = list[(idx - 1 + list.length) % list.length]!
    succ.set(ekey(e), s)
  }

  // --- trace faces ---
  interface RawFace {
    edges: HalfEdge[]
    signedA: number
    component: number
  }
  const componentOf = componentIndex(nodes, wallList)
  const visited = new Set<string>()
  const raw: RawFace[] = []
  for (const start of edges) {
    if (visited.has(ekey(start))) continue
    const walk: HalfEdge[] = []
    let cur = start
    do {
      visited.add(ekey(cur))
      walk.push(cur)
      cur = succ.get(ekey(cur))!
    } while (ekey(cur) !== ekey(start))
    const ring = walk.map((e) => {
      const n = nodes[e.from]!
      return { x: n.x, y: n.y }
    })
    raw.push({
      edges: walk,
      signedA: signedArea(ring),
      component: componentOf.get(start.from) ?? -1,
    })
  }

  // --- classify ---
  const interiors = raw.filter((f) => f.signedA > EPS)
  const outers = raw.filter((f) => f.signedA < -EPS)

  const mkPolygon = (f: RawFace) =>
    stripSpikes(
      f.edges.map((e) => {
        const n = nodes[e.from]!
        return { x: n.x, y: n.y }
      }),
    )

  const faces = interiors.map((f) => {
    const polygon = mkPolygon(f)
    const wallCycle: WallId[] = []
    const wallSet = new Set<WallId>()
    for (const e of f.edges) {
      if (!wallSet.has(e.wallId)) {
        wallSet.add(e.wallId)
        wallCycle.push(e.wallId)
      }
    }
    return { raw: f, polygon, wallCycle, wallSet, holes: [] as RawFace[] }
  })

  // --- assign holes: outer cycles of OTHER components only ---
  for (const outer of outers) {
    const holePoly = mkPolygon(outer)
    if (holePoly.length < 3 || area(holePoly) <= GEOM_EPS) continue
    const probe = interiorProbe(holePoly)
    if (!probe) continue
    let best: (typeof faces)[number] | null = null
    let bestArea = Infinity
    for (const face of faces) {
      if (face.raw.component === outer.component) continue
      if (face.polygon.length < 3) continue
      const a = area(face.polygon)
      if (a < bestArea && pointInPolygon(probe, face.polygon)) {
        best = face
        bestArea = a
      }
    }
    if (best) best.holes.push(outer)
  }

  // --- finalize ---
  return faces
    .filter((f) => f.polygon.length >= 3 && area(f.polygon) > GEOM_EPS)
    .map((f) => {
      const holePolygons = f.holes
        .map((h) => mkPolygon(h))
        .filter((p) => p.length >= 3 && area(p) > GEOM_EPS)
      const holeCycles = f.holes.map((h) => {
        const ids: WallId[] = []
        const seen = new Set<WallId>()
        for (const e of h.edges) {
          if (!seen.has(e.wallId)) {
            seen.add(e.wallId)
            ids.push(e.wallId)
          }
        }
        return ids
      })
      const floor = triangulate(f.polygon, holePolygons)
      const outerArea = area(f.polygon)
      const holesArea = holePolygons.reduce((s, p) => s + area(p), 0)
      const c = centroid(f.polygon)
      const labelAnchor = pointInPolygonWithHoles(c, f.polygon, holePolygons)
        ? c
        : (interiorProbe(f.polygon, holePolygons) ?? c)
      // Stub walls also belong to the face fingerprint (they were traversed),
      // so wallSet/wallCycle already include them.
      return {
        wallCycle: f.wallCycle,
        wallSet: f.wallSet,
        polygon: f.polygon,
        holeCycles,
        holePolygons,
        areaM2: outerArea - holesArea,
        centroid: c,
        labelAnchor,
        floor,
      }
    })
}

/** Strictly interior point: centroid of the largest earcut triangle. */
function interiorProbe(
  polygon: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): Vec2 | null {
  const tri = triangulate(polygon, holes)
  let best: Vec2 | null = null
  let bestArea = -Infinity
  for (let i = 0; i < tri.indices.length; i += 3) {
    const a = tri.indices[i]! * 2
    const b = tri.indices[i + 1]! * 2
    const c = tri.indices[i + 2]! * 2
    const ax = tri.positions[a]!
    const ay = tri.positions[a + 1]!
    const bx = tri.positions[b]!
    const by = tri.positions[b + 1]!
    const cx = tri.positions[c]!
    const cy = tri.positions[c + 1]!
    const ar = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    if (ar > bestArea) {
      bestArea = ar
      best = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 }
    }
  }
  return bestArea > GEOM_EPS ? best : null
}

/** Connected-component index per node (BFS over the wall graph). */
function componentIndex(
  nodes: Record<NodeId, WallNode>,
  wallList: Wall[],
): Map<NodeId, number> {
  const adj = new Map<NodeId, NodeId[]>()
  for (const w of wallList) {
    ;(adj.get(w.a) ?? adj.set(w.a, []).get(w.a)!).push(w.b)
    ;(adj.get(w.b) ?? adj.set(w.b, []).get(w.b)!).push(w.a)
  }
  const comp = new Map<NodeId, number>()
  let next = 0
  for (const id of Object.keys(nodes) as NodeId[]) {
    if (comp.has(id) || !adj.has(id)) continue
    const queue = [id]
    comp.set(id, next)
    while (queue.length) {
      const n = queue.pop()!
      for (const m of adj.get(n) ?? []) {
        if (!comp.has(m)) {
          comp.set(m, next)
          queue.push(m)
        }
      }
    }
    next++
  }
  return comp
}
