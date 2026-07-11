import { describe, expect, it } from 'vitest'
import { buildPatchSolids, buildWallSolid, type WallSolid } from './wallSolids'
import { computeWallOutlines } from './wallOutline'
import { area } from './polygon'
import { fixture } from '../test/fixtures'
import { asNodeId, asOpeningId, asWallId } from '../model/ids'
import type { Opening, Wall, WallNode } from '../model/types'

const mkWall = (len: number, t = 0.2, h = 2.5): { wall: Wall; a: WallNode; b: WallNode } => ({
  wall: { id: asWallId('w'), a: asNodeId('na'), b: asNodeId('nb'), thickness: t, height: h },
  a: { id: asNodeId('na'), x: 0, y: 0 },
  b: { id: asNodeId('nb'), x: len, y: 0 },
})

const door = (t: number, width = 0.9, height = 2.0): Opening => ({
  id: asOpeningId(`d${t}`),
  wallId: asWallId('w'),
  kind: 'door',
  t,
  width,
  height,
  hinge: 'a',
  swing: 'front',
})

const win = (t: number, width = 1.2, height = 1.2, sillHeight = 0.9): Opening => ({
  id: asOpeningId(`v${t}`),
  wallId: asWallId('w'),
  kind: 'window',
  t,
  width,
  height,
  sillHeight,
})

/** Isolated-wall outline: a plain rect (butt caps), core = full length. */
function isolatedOutline(len: number, t: number) {
  const half = t / 2
  return {
    outline: [
      { x: 0, y: -half },
      { x: len, y: -half },
      { x: len, y: half },
      { x: 0, y: half },
    ],
    core: [0, len] as [number, number],
  }
}

const volume = (s: WallSolid) =>
  s.prisms.reduce((sum, p) => sum + area(p.polygon) * (p.z1 - p.z0), 0)

describe('buildWallSolid', () => {
  it('door + window: exact prism set, realized intervals, volume conservation', () => {
    const { wall, a, b } = mkWall(6)
    const { outline, core } = isolatedOutline(6, 0.2)
    const s = buildWallSolid(wall, a, b, [door(0.5), win(0.8)], outline, core)

    expect(s.clamped).toBe(false)
    expect(s.openings).toHaveLength(2)
    const d = s.openings.find((o) => o.kind === 'door')!
    expect(d.u0).toBeCloseTo(3 - 0.45, 9)
    expect(d.u1).toBeCloseTo(3 + 0.45, 9)
    expect(d.z0).toBe(0)
    expect(d.z1).toBeCloseTo(2.0, 9)
    const v = s.openings.find((o) => o.kind === 'window')!
    expect(v.u0).toBeCloseTo(4.8 - 0.6, 9)
    expect(v.u1).toBeCloseTo(4.8 + 0.6, 9)
    expect(v.z0).toBeCloseTo(0.9, 9)
    expect(v.z1).toBeCloseTo(2.1, 9)

    // pieces: full | door lintel | full | window sill + lintel | full
    expect(s.prisms).toHaveLength(6)
    const expected = 6 * 0.2 * 2.5 - 0.9 * 0.2 * 2.0 - 1.2 * 0.2 * 1.2
    expect(volume(s)).toBeCloseTo(expected, 9)
  })

  it('door height ≥ wall height: full passage, no lintel, headroom clamp', () => {
    const { wall, a, b } = mkWall(4, 0.2, 2.2)
    const { outline, core } = isolatedOutline(4, 0.2)
    const s = buildWallSolid(wall, a, b, [door(0.5, 0.9, 2.4)], outline, core)
    const d = s.openings[0]!
    expect(d.z1).toBeCloseTo(2.2 - 0.02, 9)
    // the headroom clamp leaves a thin continuous band above the passage —
    // exactly one 2cm lintel keeps the wall top connected
    const lintels = s.prisms.filter((p) => p.z0 > 0)
    expect(lintels).toHaveLength(1)
    expect(lintels[0]!.z0).toBeCloseTo(2.2 - 0.02, 9)
    expect(lintels[0]!.z1).toBeCloseTo(2.2, 9)
    expect(s.prisms).toHaveLength(3) // two side pieces + headroom band
  })

  it('window sill+height above wall top: clamped, no upper lintel', () => {
    const { wall, a, b } = mkWall(4, 0.2, 2.0)
    const { outline, core } = isolatedOutline(4, 0.2)
    const s = buildWallSolid(wall, a, b, [win(0.5, 1.2, 1.5, 0.9)], outline, core)
    const v = s.openings[0]!
    expect(v.z1).toBeCloseTo(2.0 - 0.02, 9)
    // sill prism exists; above the clamped window only the 2cm headroom band remains
    const above = s.prisms.filter((p) => p.z0 > 1.0)
    expect(above).toHaveLength(1)
    expect(above[0]!.z0).toBeCloseTo(2.0 - 0.02, 9)
    const sill = s.prisms.filter((p) => p.z0 === 0 && p.z1 < 1)
    expect(sill).toHaveLength(1)
  })

  it('opening outside the core is pulled in and flagged', () => {
    const { wall, a, b } = mkWall(5)
    // pretend a miter eats the first 0.5m
    const { outline } = isolatedOutline(5, 0.2)
    const core: [number, number] = [0.5, 5]
    const s = buildWallSolid(wall, a, b, [door(0.05)], outline, core)
    expect(s.clamped).toBe(true)
    const d = s.openings[0]!
    expect(d.u0).toBeGreaterThanOrEqual(0.5 + 0.01 - 1e-9)
  })

  it('overlapping openings are serialized without overlap', () => {
    const { wall, a, b } = mkWall(6)
    const { outline, core } = isolatedOutline(6, 0.2)
    const s = buildWallSolid(wall, a, b, [door(0.5), door(0.52)], outline, core)
    expect(s.openings).toHaveLength(2)
    const [o1, o2] = s.openings
    expect(o2!.u0).toBeGreaterThanOrEqual(o1!.u1 - 1e-9)
    expect(s.clamped).toBe(true)
  })

  it('no openings: single prism equal to the outline, full height', () => {
    const { wall, a, b } = mkWall(3)
    const { outline, core } = isolatedOutline(3, 0.2)
    const s = buildWallSolid(wall, a, b, [], outline, core)
    expect(s.prisms).toHaveLength(1)
    expect(area(s.prisms[0]!.polygon)).toBeCloseTo(3 * 0.2, 9)
    expect(s.prisms[0]!.z0).toBe(0)
    expect(s.prisms[0]!.z1).toBe(2.5)
  })

  it('mitered outline: prism footprint area equals outline area (rotation-invariant)', () => {
    // L-corner from computeWallOutlines; wall w1 has a mitered end
    const fx = fixture(
      [
        ['nc', 0, 0],
        ['ne', 3, 0],
        ['ns', 0, 3],
      ],
      [
        ['w1', 'nc', 'ne', 0.2],
        ['w2', 'nc', 'ns', 0.2],
      ],
    )
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const w1 = fx.walls[asWallId('w1')]!
    const s = buildWallSolid(
      w1,
      fx.nodes[w1.a]!,
      fx.nodes[w1.b]!,
      [],
      out.wallPolygons[w1.id]!,
      out.wallCores[w1.id]!,
    )
    expect(s.prisms).toHaveLength(1)
    expect(area(s.prisms[0]!.polygon)).toBeCloseTo(area(out.wallPolygons[w1.id]!), 9)
  })
})

describe('buildPatchSolids', () => {
  it('T-junction patch extrudes to the minimum incident wall height', () => {
    const fx = fixture(
      [
        ['nw', -2, 0],
        ['nc', 0, 0],
        ['ne', 2, 0],
        ['ns', 0, 2],
      ],
      [
        ['w1', 'nw', 'nc', 0.3],
        ['w2', 'nc', 'ne', 0.3],
        ['w3', 'nc', 'ns', 0.3],
      ],
    )
    // lower one wall
    fx.walls[asWallId('w3')]!.height = 2.2
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const patches = buildPatchSolids(fx.nodes, fx.walls, out.nodePatches)
    expect(patches).toHaveLength(1)
    expect(patches[0]!.nodeId).toBe(asNodeId('nc'))
    expect(patches[0]!.z1).toBeCloseTo(2.2, 9)
    expect(area(patches[0]!.polygon)).toBeGreaterThan(0)
  })
})
