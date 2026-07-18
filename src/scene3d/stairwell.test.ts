import { describe, expect, it } from 'vitest'
import { testLevelDoc } from '../test/fixtureDoc'
import { addWallChain } from '../model/mutations/walls'
import { addFurniture } from '../model/mutations/furniture'
import { getDerived } from '../store/derived'
import { applicableWells, carveRoomTriangulation, stairwellRects } from './stairwell'
import { vec } from '../geometry/vec'

const room = () => {
  const d = testLevelDoc('p_wells', 'wells')
  addWallChain(d, [vec(0, 0), vec(6, 0), vec(6, 5), vec(0, 5), vec(0, 0)])
  return d
}

describe('stairwellRects', () => {
  it('collects rotated footprint rects for connectsLevels items only', () => {
    const d = room()
    addFurniture(d, { catalogItemId: 'sofa-3', x: 1, y: 1, size: { w: 2.2, d: 0.95, h: 0.85 } })
    addFurniture(d, {
      catalogItemId: 'stair-straight',
      x: 3,
      y: 2.5,
      rotation: Math.PI / 2,
      size: { w: 0.9, d: 2.8, h: 2.8 },
    })
    const rects = stairwellRects(d)
    expect(rects).toHaveLength(1)
    const xs = rects[0]!.map((c) => c.x)
    const ys = rects[0]!.map((c) => c.y)
    // rotated 90°: the 2.8 run lies along x, the 0.9 width along y
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.8)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.9)
  })
})

describe('carveRoomTriangulation', () => {
  it('carves an inside well as a hole; straddling wells are skipped', () => {
    const d = room()
    addFurniture(d, {
      catalogItemId: 'stair-straight',
      x: 3,
      y: 2.5,
      size: { w: 0.9, d: 2.8, h: 2.8 },
    })
    const dr = Object.values(getDerived(d).rooms)[0]!
    const wells = stairwellRects(d)
    expect(applicableWells(dr, wells)).toHaveLength(1)
    const carved = carveRoomTriangulation(dr, wells)!
    expect(carved).not.toBeNull()
    // carving adds the rect's 4 vertices and keeps a valid triangulation
    expect(carved.tri.positions.length / 2).toBeGreaterThan(
      dr.floor.positions.length / 2,
    )
    expect(carved.tri.indices.length % 3).toBe(0)
    // a straddling well (poking through the outer wall) is skipped
    const straddling = [
      [
        { x: -0.5, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
        { x: -0.5, y: 3 },
      ],
    ]
    expect(carveRoomTriangulation(dr, straddling)).toBeNull()
  })
})
