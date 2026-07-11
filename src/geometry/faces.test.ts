import { describe, expect, it } from 'vitest'
import { detectFaces } from './faces'
import { pointInPolygon } from './polygon'
import { triangulationArea } from './triangulate'
import { fixture, rectWalls } from '../test/fixtures'
import { asWallId } from '../model/ids'

describe('detectFaces', () => {
  it('single rectangle: exactly one room with exact area; outer cycle discarded', () => {
    const r = rectWalls('', 0, 0, 4, 3)
    const fx = fixture(r.nodeDefs, r.wallDefs)
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(1)
    const f = faces[0]!
    expect(f.areaM2).toBeCloseTo(12, 9)
    expect(f.holeCycles).toHaveLength(0)
    expect(f.wallCycle).toHaveLength(4)
    expect(triangulationArea(f.floor)).toBeCloseTo(12, 9)
  })

  it('two adjacent rooms sharing a wall: both rooms list the divider', () => {
    const fx = fixture(
      [
        ['n0', 0, 0],
        ['n1', 4, 0],
        ['n2', 8, 0],
        ['n3', 8, 4],
        ['n4', 4, 4],
        ['n5', 0, 4],
      ],
      [
        ['wb1', 'n0', 'n1'],
        ['wb2', 'n1', 'n2'],
        ['wr', 'n2', 'n3'],
        ['wt2', 'n3', 'n4'],
        ['wt1', 'n4', 'n5'],
        ['wl', 'n5', 'n0'],
        ['wdiv', 'n1', 'n4'], // divider
      ],
    )
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(2)
    for (const f of faces) {
      expect(f.areaM2).toBeCloseTo(16, 9)
      expect(f.wallSet.has(asWallId('wdiv'))).toBe(true)
    }
  })

  it('stub wall inside a room: spike-stripped polygon, unchanged area, stub in wallSet', () => {
    const fx = fixture(
      [
        ['n0', 0, 0],
        ['nmid', 2, 0],
        ['n1', 4, 0],
        ['n2', 4, 4],
        ['n3', 0, 4],
        ['nstub', 2, 2],
      ],
      [
        ['wb1', 'n0', 'nmid'],
        ['wb2', 'nmid', 'n1'],
        ['wr', 'n1', 'n2'],
        ['wt', 'n2', 'n3'],
        ['wl', 'n3', 'n0'],
        ['wstub', 'nmid', 'nstub'],
      ],
    )
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(1)
    const f = faces[0]!
    expect(f.areaM2).toBeCloseTo(16, 9)
    expect(f.polygon).toHaveLength(4) // stub spike stripped
    expect(f.wallSet.has(asWallId('wstub'))).toBe(true)
  })

  it('island building inside a room: hole punched, net area correct, island rooms intact', () => {
    const big = rectWalls('big', 0, 0, 10, 10)
    const isle = rectWalls('isle', 4, 4, 6, 6)
    const fx = fixture(
      [...big.nodeDefs, ...isle.nodeDefs],
      [...big.wallDefs, ...isle.wallDefs],
    )
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(2)
    const bigFace = faces.find((f) => f.areaM2 > 50)!
    const isleFace = faces.find((f) => f.areaM2 < 50)!
    expect(isleFace.areaM2).toBeCloseTo(4, 9)
    expect(isleFace.holeCycles).toHaveLength(0)
    expect(bigFace.holeCycles).toHaveLength(1)
    expect(bigFace.areaM2).toBeCloseTo(100 - 4, 9)
    expect(triangulationArea(bigFace.floor)).toBeCloseTo(96, 6)
  })

  it('two disjoint buildings: two rooms, no cross-holes', () => {
    const a = rectWalls('a', 0, 0, 2, 2)
    const b = rectWalls('b', 5, 0, 7, 2)
    const fx = fixture([...a.nodeDefs, ...b.nodeDefs], [...a.wallDefs, ...b.wallDefs])
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(2)
    for (const f of faces) {
      expect(f.areaM2).toBeCloseTo(4, 9)
      expect(f.holeCycles).toHaveLength(0)
    }
  })

  it('L-shaped room: centroid escapes the polygon but labelAnchor stays inside', () => {
    const fx = fixture(
      [
        ['n0', 0, 0],
        ['n1', 6, 0],
        ['n2', 6, 2],
        ['n3', 2, 2],
        ['n4', 2, 6],
        ['n5', 0, 6],
      ],
      [
        ['w0', 'n0', 'n1'],
        ['w1', 'n1', 'n2'],
        ['w2', 'n2', 'n3'],
        ['w3', 'n3', 'n4'],
        ['w4', 'n4', 'n5'],
        ['w5', 'n5', 'n0'],
      ],
    )
    const faces = detectFaces(fx.nodes, fx.walls)
    expect(faces).toHaveLength(1)
    const f = faces[0]!
    expect(f.areaM2).toBeCloseTo(20, 9)
    expect(pointInPolygon(f.centroid, f.polygon)).toBe(false) // the known L trap
    expect(pointInPolygon(f.labelAnchor, f.polygon)).toBe(true)
  })

  it('stub-only tree: no rooms', () => {
    const fx = fixture(
      [
        ['n0', 0, 0],
        ['n1', 2, 0],
        ['n2', 2, 2],
      ],
      [
        ['w0', 'n0', 'n1'],
        ['w1', 'n1', 'n2'],
      ],
    )
    expect(detectFaces(fx.nodes, fx.walls)).toHaveLength(0)
  })

  it('empty graph: no rooms', () => {
    expect(detectFaces({}, {})).toHaveLength(0)
  })
})
