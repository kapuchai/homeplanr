import { describe, expect, it } from 'vitest'
import { triangleSignedArea, triangulate, triangulationArea } from './triangulate'
import { vec, type Vec2 } from './vec'

const square: Vec2[] = [vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4)]
const squareRev = square.slice().reverse()
const hole: Vec2[] = [vec(1, 1), vec(3, 1), vec(3, 3), vec(1, 3)]

describe('triangulate', () => {
  it('triangulates a square into 2 triangles with exact area', () => {
    const tri = triangulate(square)
    expect(tri.indices.length).toBe(6)
    expect(triangulationArea(tri)).toBeCloseTo(16, 9)
  })

  it('handles holes with correct net area', () => {
    const tri = triangulate(square, [hole])
    expect(triangulationArea(tri)).toBeCloseTo(16 - 4, 9)
  })

  it('winding-normalizes: same triangle orientation regardless of input ring order', () => {
    const a = triangulate(square)
    const b = triangulate(squareRev)
    const signA = Math.sign(triangleSignedArea(a, 0))
    for (let i = 0; i < a.indices.length / 3; i++) {
      expect(Math.sign(triangleSignedArea(a, i))).toBe(signA)
    }
    for (let i = 0; i < b.indices.length / 3; i++) {
      expect(Math.sign(triangleSignedArea(b, i))).toBe(signA)
    }
  })

  it('hole ring orientation does not matter either', () => {
    const t1 = triangulate(square, [hole])
    const t2 = triangulate(square, [hole.slice().reverse()])
    expect(triangulationArea(t1)).toBeCloseTo(triangulationArea(t2), 9)
  })
})
