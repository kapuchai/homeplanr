import { describe, expect, it } from 'vitest'
import { add, angle, cross, dist, dot, len, normalize, perp, rotate, sub, vec } from './vec'

describe('vec (plan space: x right, y down)', () => {
  it('basic ops', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 })
    expect(sub(vec(3, 4), vec(1, 2))).toEqual({ x: 2, y: 2 })
    expect(dot(vec(1, 2), vec(3, 4))).toBe(11)
    expect(len(vec(3, 4))).toBe(5)
    expect(dist(vec(1, 1), vec(4, 5))).toBe(5)
  })

  it('perp rotates +90° consistently with rotate()', () => {
    const a = vec(1, 0)
    const p = perp(a)
    const r = rotate(a, Math.PI / 2)
    expect(p.x).toBeCloseTo(r.x, 12)
    expect(p.y).toBeCloseTo(r.y, 12)
  })

  it('cross sign matches plan-space handedness (x-then-perp(x) is positive)', () => {
    const a = vec(1, 0)
    expect(cross(a, perp(a))).toBeGreaterThan(0)
  })

  it('normalize handles zero vector', () => {
    expect(normalize(vec(0, 0))).toEqual({ x: 0, y: 0 })
    const n = normalize(vec(10, 0))
    expect(n).toEqual({ x: 1, y: 0 })
  })

  it('angle of +y (screen-down) is +90°', () => {
    expect(angle(vec(0, 1))).toBeCloseTo(Math.PI / 2, 12)
  })
})
