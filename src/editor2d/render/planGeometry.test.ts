import { describe, expect, it } from 'vitest'
import { testLevelDoc } from '../../test/fixtureDoc'
import { addWallSegment } from '../../model/mutations/walls'
import { addOpening } from '../../model/mutations/openings'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { add, normalize, perp, scale, sub, type Vec2 } from '../../geometry/vec'
import {
  doorGlyph,
  openingInk,
  openingSymbol,
  worldPoint,
  type OpeningPrim,
} from './planGeometry'

const lines = (ink: readonly OpeningPrim[], role: string) =>
  ink.filter((p): p is Extract<OpeningPrim, { kind: 'line' }> => p.kind === 'line' && p.role === role)
const arcs = (ink: readonly OpeningPrim[]) =>
  ink.filter((p): p is Extract<OpeningPrim, { kind: 'arc' }> => p.kind === 'arc')

/**
 * M4 (0.4.0): the pre-click door ghost maps (u, v) from raw node arithmetic
 * while placed doors map through the WallSolid frame. This pins that the
 * two mappings feed doorGlyph identically — the EMPIRICALLY PINNED sweep
 * flags and the leaf/arc geometry cannot fork between ghost and commit.
 */
describe('doorGlyph ghost/placed parity', () => {
  const build = (hinge: 'a' | 'b', swing: 'front' | 'back') => {
    resetDerivedForTests()
    const d = testLevelDoc('p_dg', 'dg')
    const r = addWallSegment(d, { x: 1, y: 2 }, { x: 5, y: 4 }) // oblique wall
    const id = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5, hinge, swing })!
    const derived = getDerived(d)
    const solid = Object.values(derived.wallSolids)[0]!
    const realized = solid.openings.find((o) => o.openingId === id)!
    const model = d.openings[id]!
    const wall = d.walls[r.wallId!]!
    const na = d.nodes[wall.a]!
    const nb = d.nodes[wall.b]!
    return { d, wall, solid, realized, model, na, nb }
  }

  for (const hinge of ['a', 'b'] as const) {
    for (const swing of ['front', 'back'] as const) {
      it(`hinge=${hinge} swing=${swing}: node-arithmetic mapping === solid-frame mapping`, () => {
        const { wall, solid, realized, model, na, nb } = build(hinge, swing)
        const ink = openingSymbol(solid, wall, realized, model).ink
        const placedLeaf = lines(ink, 'leaf')[0]!.line
        const placedArc = arcs(ink)[0]!.arc
        // the ghost's mapping (placeOpeningTool.p): na + dir·u + perp(dir)·v
        const dir = normalize(sub(nb, na))
        const p = (u: number, v: number): Vec2 => add(add(na, scale(dir, u)), scale(perp(dir), v))
        const ghost = doorGlyph(
          p,
          realized.u0,
          realized.u1,
          hinge,
          swing,
          wall.thickness / 2,
        )
        expect(ghost.arc.sweep).toBe(placedArc.sweep)
        expect(ghost.arc.r).toBeCloseTo(placedArc.r, 9)
        for (const [g, pl] of [
          [ghost.leaf.x1, placedLeaf.x1],
          [ghost.leaf.y1, placedLeaf.y1],
          [ghost.leaf.x2, placedLeaf.x2],
          [ghost.leaf.y2, placedLeaf.y2],
          [ghost.arc.from.x, placedArc.from.x],
          [ghost.arc.from.y, placedArc.from.y],
          [ghost.arc.to.x, placedArc.to.x],
          [ghost.arc.to.y, placedArc.to.y],
        ] as const) {
          expect(g).toBeCloseTo(pl, 9)
        }
      })
    }
  }

  it('worldPoint and the node-arithmetic mapping agree across the wall frame', () => {
    const { solid, na, nb } = build('a', 'front')
    const dir = normalize(sub(nb, na))
    const p = (u: number, v: number): Vec2 => add(add(na, scale(dir, u)), scale(perp(dir), v))
    for (const [u, v] of [
      [0.5, 0.1],
      [2.0, -0.3],
      [3.7, 0],
    ] as const) {
      const a = worldPoint(solid, u, v)
      const b = p(u, v)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.y).toBeCloseTo(b.y, 9)
    }
  })
})

/**
 * 0.10.0 M2: per-style ink structure pins. Local identity mapping — the
 * builders are pure over pt, so world placement is covered by the parity
 * suite above; these pin WHAT each style draws.
 */
describe('openingInk per-style structure', () => {
  const pt = (u: number, v: number): Vec2 => ({ x: u, y: v })
  const HALF = 0.075
  const ink = (model: Parameters<typeof openingInk>[4]) => openingInk(pt, 1, 2.2, HALF, model)

  it('standard door: 2 jambs + leaf + swing arc (and unknown ids fall back to it)', () => {
    for (const style of [undefined, 'standard', 'no-such-style']) {
      const prims = ink({ kind: 'door', hinge: 'a', swing: 'front', style })
      expect(lines(prims, 'jamb')).toHaveLength(2)
      expect(lines(prims, 'leaf')).toHaveLength(1)
      expect(arcs(prims)).toHaveLength(1)
      expect(prims).toHaveLength(4)
    }
  })

  it('balcony door draws the standard glyph (glazing is 3D-only in plan)', () => {
    const std = ink({ kind: 'door', hinge: 'b', swing: 'back' })
    const bal = ink({ kind: 'door', hinge: 'b', swing: 'back', style: 'balcony' })
    expect(bal).toEqual(std)
  })

  it('double door: two mirrored half-leaves whose sweeps follow the pinned matrix', () => {
    const prims = ink({ kind: 'door', hinge: 'a', swing: 'front', style: 'double' })
    expect(lines(prims, 'leaf')).toHaveLength(2)
    const [left, right] = arcs(prims)
    // composition = doorGlyph(u0..mid, hinge 'a') + doorGlyph(mid..u1, 'b'):
    // pinned table gives a/front→0 and b/front→1
    expect(left!.arc.sweep).toBe(0)
    expect(right!.arc.sweep).toBe(1)
    // each arc radius = half the gap width
    expect(left!.arc.r).toBeCloseTo(0.6, 9)
    expect(right!.arc.r).toBeCloseTo(0.6, 9)
    // the two leaves meet mid-gap fully open: both leaf lines start at
    // their hinge jambs (u0 and u1)
    const leafs = lines(prims, 'leaf')
    expect(leafs[0]!.line.x1).toBeCloseTo(1, 9)
    expect(leafs[1]!.line.x1).toBeCloseTo(2.2, 9)
  })

  it('sliding door: two offset overlapping panels, no arc; hinge picks the active end', () => {
    const prims = ink({ kind: 'door', hinge: 'a', swing: 'front', style: 'sliding' })
    expect(arcs(prims)).toHaveLength(0)
    const panels = lines(prims, 'leaf')
    expect(panels).toHaveLength(2)
    // active panel: starts at u0=1, spans 0.6·1.2=0.72, on the front side
    expect(panels[0]!.line.x1).toBeCloseTo(1, 9)
    expect(panels[0]!.line.x2).toBeCloseTo(1.72, 9)
    expect(panels[0]!.line.y1).toBeCloseTo(HALF / 2, 9)
    // parked panel: ends at u1=2.2, opposite side
    expect(panels[1]!.line.x2).toBeCloseTo(2.2, 9)
    expect(panels[1]!.line.y1).toBeCloseTo(-HALF / 2, 9)
    // hinge 'b' mirrors the roles
    const flipped = ink({ kind: 'door', hinge: 'b', swing: 'front', style: 'sliding' })
    const fPanels = lines(flipped, 'leaf')
    expect(fPanels[0]!.line.x2).toBeCloseTo(2.2, 9)
    expect(fPanels[0]!.line.y1).toBeCloseTo(HALF / 2, 9)
  })

  it('garage door: closed panel + dashed 3-line overhead track on the swing side', () => {
    const prims = ink({ kind: 'door', hinge: 'a', swing: 'front', style: 'garage' })
    expect(arcs(prims)).toHaveLength(0)
    const panel = lines(prims, 'leaf')
    expect(panel).toHaveLength(1)
    expect(panel[0]!.line.y1).toBeCloseTo(0, 9) // centered slab line
    const track = lines(prims, 'track')
    expect(track).toHaveLength(3)
    expect(track.every((t) => t.dashed)).toBe(true)
    // track extends past the FRONT face for swing 'front'
    expect(Math.max(...track.map((t) => Math.max(t.line.y1, t.line.y2)))).toBeCloseTo(
      HALF + 0.45,
      9,
    )
    // swing 'back' mirrors it
    const back = ink({ kind: 'door', hinge: 'a', swing: 'back', style: 'garage' })
    const bTrack = lines(back, 'track')
    expect(Math.min(...bTrack.map((t) => Math.min(t.line.y1, t.line.y2)))).toBeCloseTo(
      -(HALF + 0.45),
      9,
    )
  })

  it('passage: jambs + two dashed face lines only — no leaf, no arc', () => {
    const prims = ink({ kind: 'door', hinge: 'a', swing: 'front', style: 'passage' })
    expect(lines(prims, 'leaf')).toHaveLength(0)
    expect(arcs(prims)).toHaveLength(0)
    const faces = lines(prims, 'passage')
    expect(faces).toHaveLength(2)
    expect(faces.every((f) => f.dashed)).toBe(true)
    expect(faces.map((f) => f.line.y1).sort((a, b) => a - b)).toEqual([-HALF, HALF])
  })

  it('every window style shares the v1 triple glazing line', () => {
    for (const style of [undefined, 'fullheight', 'panorama', 'arched', 'junk']) {
      const prims = ink({ kind: 'window', style })
      expect(lines(prims, 'jamb')).toHaveLength(2)
      const glazing = lines(prims, 'glazing')
      expect(glazing).toHaveLength(3)
      expect(glazing.map((g) => g.line.y1).sort((a, b) => a - b)).toEqual([
        -HALF / 2,
        0,
        HALF / 2,
      ])
      expect(prims).toHaveLength(5)
    }
  })
})
