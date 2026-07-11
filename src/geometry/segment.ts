import type { Vec2 } from './vec'
import { cross, dist, sub } from './vec'
import { EPS } from './constants'

/**
 * Closest point on segment [a,b] to p.
 * Returns the clamped parameter t ∈ [0,1] — for walls, this t is directly
 * usable as an opening's parametric position along a→b.
 */
export function closestPointOnSegment(
  p: Vec2,
  a: Vec2,
  b: Vec2,
): { point: Vec2; t: number } {
  const ab = sub(b, a)
  const lenSq = ab.x * ab.x + ab.y * ab.y
  if (lenSq < EPS) return { point: { x: a.x, y: a.y }, t: 0 }
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lenSq))
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t }
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestPointOnSegment(p, a, b).point)
}

/**
 * Proper intersection of segments [a1,a2] and [b1,b2].
 * Returns intersection point plus parameters t (along a) and u (along b),
 * or null when parallel/collinear or when the crossing lies outside either
 * segment (within EPS of the parameter range is accepted).
 */
export function segSegIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): { p: Vec2; t: number; u: number } | null {
  const da = sub(a2, a1)
  const db = sub(b2, b1)
  const denom = cross(da, db)
  if (Math.abs(denom) < EPS) return null
  const ab = sub(b1, a1)
  const t = cross(ab, db) / denom
  const u = cross(ab, da) / denom
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { p: { x: a1.x + da.x * t, y: a1.y + da.y * t }, t, u }
}

/**
 * Intersection of two infinite lines given as (point, direction).
 * Returns null for (near-)parallel lines.
 */
export function lineLineIntersection(
  p1: Vec2,
  d1: Vec2,
  p2: Vec2,
  d2: Vec2,
): Vec2 | null {
  const denom = cross(d1, d2)
  if (Math.abs(denom) < EPS) return null
  const s = cross(sub(p2, p1), d2) / denom
  return { x: p1.x + d1.x * s, y: p1.y + d1.y * s }
}
