import type { Vec2 } from './vec'
import { dist, sub } from './vec'
import { distToSegment } from './segment'
import { EPS, GEOM_EPS } from './constants'

/**
 * Shoelace signed area in plan space (x right, y down).
 * Sign convention is an implementation detail — orientation-dependent code
 * must go through the pinned tests, not re-derive the sign.
 */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export const area = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly))

/** Area-weighted centroid; falls back to vertex average for degenerate rings. */
export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < EPS) {
    let x = 0
    let y = 0
    for (const p of poly) {
      x += p.x
      y += p.y
    }
    const n = Math.max(1, poly.length)
    return { x: x / n, y: y / n }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    const w = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * w
    cy += (p.y + q.y) * w
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function polygonBounds(polys: readonly (readonly Vec2[])[]): Bounds | null {
  let b: Bounds | null = null
  for (const poly of polys) {
    for (const p of poly) {
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
      else {
        b.minX = Math.min(b.minX, p.x)
        b.minY = Math.min(b.minY, p.y)
        b.maxX = Math.max(b.maxX, p.x)
        b.maxY = Math.max(b.maxY, p.y)
      }
    }
  }
  return b
}

/** Even-odd ray-casting point-in-polygon. Boundary results are unspecified. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    const crosses = a.y > p.y !== b.y > p.y
    if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function pointInPolygonWithHoles(
  p: Vec2,
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
): boolean {
  if (!pointInPolygon(p, outer)) return false
  for (const hole of holes) if (pointInPolygon(p, hole)) return false
  return true
}

/**
 * Point in oriented box: center, full size (w along local x, d along local y),
 * rotation in radians. Used for furniture hit-testing.
 */
export function pointInOBB(
  p: Vec2,
  center: Vec2,
  size: { w: number; d: number },
  rotation: number,
): boolean {
  const d = sub(p, center)
  const c = Math.cos(-rotation)
  const s = Math.sin(-rotation)
  const lx = d.x * c - d.y * s
  const ly = d.x * s + d.y * c
  return Math.abs(lx) <= size.w / 2 && Math.abs(ly) <= size.d / 2
}

/**
 * Clean a ring for rendering/area purposes:
 * - consecutive duplicate points are dropped;
 * - zero-width spike tips (ring doubles back: prev ≈ next) are dropped —
 *   face traversal of stub walls produces exactly these;
 * - collinear pass-through vertices (cur lies on segment prev→next) are
 *   dropped, which also removes the residue left where a spike rejoined
 *   its edge.
 * Iterates to a fixed point. Topology (wallCycle) is unaffected — this is
 * polygon cleanup only.
 */
export function stripSpikes(poly: readonly Vec2[], eps: number = GEOM_EPS): Vec2[] {
  let ring = poly.slice()
  let changed = true
  while (changed && ring.length > 2) {
    changed = false
    const next: Vec2[] = []
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n]!
      const cur = ring[i]!
      const nxt = ring[(i + 1) % n]!
      if (dist(cur, nxt) <= eps) {
        // consecutive duplicate — drop cur
        changed = true
        continue
      }
      if (dist(prev, nxt) <= eps) {
        // spike tip — drop cur
        changed = true
        continue
      }
      if (dist(prev, cur) > eps && distToSegment(cur, prev, nxt) <= eps) {
        // collinear pass-through — drop cur (guard: when prev ≈ cur the
        // distance is trivially 0; that case is duplicate cleanup, handled
        // by dropping the FIRST copy above, not this vertex)
        changed = true
        continue
      }
      next.push(cur)
    }
    ring = next
  }
  return ring
}

/**
 * Sutherland–Hodgman clip of a polygon against one half-plane.
 * Keeps points p with dot(p, normal) <= offset (i.e. normal·p − offset ≤ 0).
 */
export function clipHalfPlane(
  poly: readonly Vec2[],
  normal: Vec2,
  offset: number,
): Vec2[] {
  const out: Vec2[] = []
  const n = poly.length
  const side = (p: Vec2) => normal.x * p.x + normal.y * p.y - offset
  for (let i = 0; i < n; i++) {
    const cur = poly[i]!
    const nxt = poly[(i + 1) % n]!
    const sc = side(cur)
    const sn = side(nxt)
    if (sc <= EPS) out.push(cur)
    if ((sc < -EPS && sn > EPS) || (sc > EPS && sn < -EPS)) {
      const t = sc / (sc - sn)
      out.push({ x: cur.x + (nxt.x - cur.x) * t, y: cur.y + (nxt.y - cur.y) * t })
    }
  }
  return out
}
