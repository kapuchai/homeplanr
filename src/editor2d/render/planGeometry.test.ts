import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../model/types'
import { addWallSegment } from '../../model/mutations/walls'
import { addOpening } from '../../model/mutations/openings'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { add, normalize, perp, scale, sub, type Vec2 } from '../../geometry/vec'
import { doorGlyph, openingSymbol, worldPoint } from './planGeometry'

/**
 * M4 (0.4.0): the pre-click door ghost maps (u, v) from raw node arithmetic
 * while placed doors map through the WallSolid frame. This pins that the
 * two mappings feed doorGlyph identically — the EMPIRICALLY PINNED sweep
 * flags and the leaf/arc geometry cannot fork between ghost and commit.
 */
describe('doorGlyph ghost/placed parity', () => {
  const build = (hinge: 'a' | 'b', swing: 'front' | 'back') => {
    resetDerivedForTests()
    const d = emptyDocument('p_dg', 'dg', '2026-07-16T00:00:00.000Z')
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
        const placed = openingSymbol(solid, wall, realized, model).door!
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
        expect(ghost.arc.sweep).toBe(placed.arc.sweep)
        expect(ghost.arc.r).toBeCloseTo(placed.arc.r, 9)
        for (const [g, pl] of [
          [ghost.leaf.x1, placed.leaf.x1],
          [ghost.leaf.y1, placed.leaf.y1],
          [ghost.leaf.x2, placed.leaf.x2],
          [ghost.leaf.y2, placed.leaf.y2],
          [ghost.arc.from.x, placed.arc.from.x],
          [ghost.arc.from.y, placed.arc.from.y],
          [ghost.arc.to.x, placed.arc.to.x],
          [ghost.arc.to.y, placed.arc.to.y],
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
