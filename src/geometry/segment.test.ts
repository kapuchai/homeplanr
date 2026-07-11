import { describe, expect, it } from 'vitest'
import {
  closestPointOnSegment,
  distToSegment,
  lineLineIntersection,
  segSegIntersection,
} from './segment'
import { vec } from './vec'

describe('closestPointOnSegment', () => {
  it('projects onto the interior with correct t', () => {
    const { point, t } = closestPointOnSegment(vec(2, 5), vec(0, 0), vec(4, 0))
    expect(point).toEqual({ x: 2, y: 0 })
    expect(t).toBeCloseTo(0.5, 12)
  })

  it('clamps beyond both endpoints', () => {
    expect(closestPointOnSegment(vec(-3, 1), vec(0, 0), vec(4, 0)).t).toBe(0)
    expect(closestPointOnSegment(vec(9, -2), vec(0, 0), vec(4, 0)).t).toBe(1)
  })

  it('handles degenerate zero-length segments', () => {
    const r = closestPointOnSegment(vec(5, 5), vec(1, 1), vec(1, 1))
    expect(r.point).toEqual({ x: 1, y: 1 })
    expect(r.t).toBe(0)
  })
})

describe('distToSegment', () => {
  it('perpendicular distance inside, endpoint distance outside', () => {
    expect(distToSegment(vec(2, 3), vec(0, 0), vec(4, 0))).toBeCloseTo(3, 12)
    expect(distToSegment(vec(-3, 4), vec(0, 0), vec(4, 0))).toBeCloseTo(5, 12)
  })
})

describe('segSegIntersection', () => {
  it('finds a proper crossing with parameters', () => {
    const r = segSegIntersection(vec(0, 0), vec(4, 4), vec(0, 4), vec(4, 0))
    expect(r).not.toBeNull()
    expect(r!.p.x).toBeCloseTo(2, 12)
    expect(r!.p.y).toBeCloseTo(2, 12)
    expect(r!.t).toBeCloseTo(0.5, 12)
    expect(r!.u).toBeCloseTo(0.5, 12)
  })

  it('returns null for parallel and for non-overlapping segments', () => {
    expect(segSegIntersection(vec(0, 0), vec(4, 0), vec(0, 1), vec(4, 1))).toBeNull()
    expect(segSegIntersection(vec(0, 0), vec(1, 0), vec(2, -1), vec(2, 1))).toBeNull()
  })

  it('accepts endpoint-touching intersections (within EPS)', () => {
    const r = segSegIntersection(vec(0, 0), vec(4, 0), vec(2, 0), vec(2, 3))
    expect(r).not.toBeNull()
    expect(r!.u).toBeCloseTo(0, 9)
  })
})

describe('lineLineIntersection', () => {
  it('intersects two lines', () => {
    const p = lineLineIntersection(vec(0, 0), vec(1, 0), vec(3, -2), vec(0, 1))
    expect(p).not.toBeNull()
    expect(p!.x).toBeCloseTo(3, 12)
    expect(p!.y).toBeCloseTo(0, 12)
  })

  it('returns null for parallel lines', () => {
    expect(lineLineIntersection(vec(0, 0), vec(1, 1), vec(5, 0), vec(2, 2))).toBeNull()
  })
})
