import { describe, expect, it } from 'vitest'
import {
  area,
  centroid,
  clipHalfPlane,
  pointInOBB,
  pointInPolygon,
  pointInPolygonWithHoles,
  polygonBounds,
  signedArea,
  stripSpikes,
} from './polygon'
import { vec, type Vec2 } from './vec'

const square: Vec2[] = [vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4)]

describe('area & centroid', () => {
  it('unit-consistent area for a 4x4 square', () => {
    expect(area(square)).toBeCloseTo(16, 12)
    expect(Math.abs(signedArea(square))).toBeCloseTo(16, 12)
  })

  it('centroid of the square is its center', () => {
    const c = centroid(square)
    expect(c.x).toBeCloseTo(2, 12)
    expect(c.y).toBeCloseTo(2, 12)
  })

  it('reversing the ring flips the signed area sign, not magnitude', () => {
    const rev = square.slice().reverse()
    expect(signedArea(rev)).toBeCloseTo(-signedArea(square), 12)
  })
})

describe('pointInPolygon', () => {
  it('inside / outside', () => {
    expect(pointInPolygon(vec(2, 2), square)).toBe(true)
    expect(pointInPolygon(vec(5, 2), square)).toBe(false)
  })

  it('with holes', () => {
    const hole: Vec2[] = [vec(1, 1), vec(3, 1), vec(3, 3), vec(1, 3)]
    expect(pointInPolygonWithHoles(vec(0.5, 0.5), square, [hole])).toBe(true)
    expect(pointInPolygonWithHoles(vec(2, 2), square, [hole])).toBe(false)
  })
})

describe('pointInOBB', () => {
  it('respects rotation', () => {
    // 4x2 box rotated 90°: extends ±1 in x, ±2 in y
    const inRot = pointInOBB(vec(0, 1.8), vec(0, 0), { w: 4, d: 2 }, Math.PI / 2)
    const outRot = pointInOBB(vec(1.8, 0), vec(0, 0), { w: 4, d: 2 }, Math.PI / 2)
    expect(inRot).toBe(true)
    expect(outRot).toBe(false)
  })
})

describe('stripSpikes', () => {
  it('removes a stub spike and keeps area', () => {
    // square with a spike poking to (6,2) and back
    const spiked: Vec2[] = [
      vec(0, 0),
      vec(4, 0),
      vec(4, 2),
      vec(6, 2),
      vec(4, 2),
      vec(4, 4),
      vec(0, 4),
    ]
    const cleaned = stripSpikes(spiked)
    expect(area(cleaned)).toBeCloseTo(16, 9)
    expect(cleaned.length).toBe(4)
  })

  it('drops consecutive duplicates', () => {
    const dup: Vec2[] = [vec(0, 0), vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4)]
    expect(stripSpikes(dup).length).toBe(4)
  })
})

describe('clipHalfPlane', () => {
  it('clips a square to x <= 2', () => {
    const clipped = clipHalfPlane(square, vec(1, 0), 2)
    expect(area(clipped)).toBeCloseTo(8, 9)
    for (const p of clipped) expect(p.x).toBeLessThanOrEqual(2 + 1e-9)
  })

  it('returns empty when everything is clipped away', () => {
    expect(clipHalfPlane(square, vec(1, 0), -1)).toHaveLength(0)
  })

  it('returns the whole polygon when nothing is clipped', () => {
    expect(area(clipHalfPlane(square, vec(1, 0), 10))).toBeCloseTo(16, 9)
  })
})

describe('polygonBounds', () => {
  it('unions multiple polygons', () => {
    const b = polygonBounds([square, [vec(-1, 2), vec(0, 2), vec(0, 3)]])
    expect(b).toEqual({ minX: -1, minY: 0, maxX: 4, maxY: 4 })
  })

  it('returns null for no points', () => {
    expect(polygonBounds([])).toBeNull()
  })
})
