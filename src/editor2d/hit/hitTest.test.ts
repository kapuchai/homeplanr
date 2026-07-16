import { describe, expect, it } from 'vitest'
import { hitTestAll, hitTestRect, hitTestTop } from './hitTest'
import { buildFixtureDoc } from '../../test/fixtureDoc'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { addDimension } from '../../model/mutations/annotations'
import { vec } from '../../geometry/vec'

const PX = 0.01 // pxToWorld at k=100

describe('hitTestAll on the fixture apartment', () => {
  resetDerivedForTests()
  const doc = buildFixtureDoc()
  const derived = getDerived(doc)

  it('sofa center hits furniture first, then the room under it', () => {
    const hits = hitTestAll(doc, derived, vec(2.2, 0.75), PX)
    expect(hits[0]?.kind).toBe('furniture')
    expect(hits.some((h) => h.kind === 'room')).toBe(true)
  })

  it('wall centerline hits the wall (not a room first)', () => {
    // (4.2, 0): south wall, clear of the window span
    const top = hitTestTop(doc, derived, vec(4.2, 0), PX)
    expect(top?.kind).toBe('wall')
  })

  it('empty floor hits the room only', () => {
    const hits = hitTestAll(doc, derived, vec(1.0, 4.0), PX)
    expect(hits[0]?.kind).toBe('room')
    expect(hits).toHaveLength(1)
  })

  it('the divider door hits the opening above the wall', () => {
    const solid = Object.values(derived.wallSolids).find((s) =>
      s.openings.some((o) => o.kind === 'door'),
    )!
    const door = solid.openings.find((o) => o.kind === 'door')!
    const mid = (door.u0 + door.u1) / 2
    const world = vec(
      solid.frame.origin.x + solid.frame.dir.x * mid,
      solid.frame.origin.y + solid.frame.dir.y * mid,
    )
    const hits = hitTestAll(doc, derived, world, PX)
    expect(hits[0]?.kind).toBe('opening')
    expect(hits.some((h) => h.kind === 'wall')).toBe(true)
  })

  it('smaller furniture wins where footprints overlap', () => {
    // chair (0.45×0.52) sits near the table (1.6×0.9) — probe a point
    // inside both footprints
    const hits = hitTestAll(doc, derived, vec(3.2, 2.7), PX)
    const furn = hits.filter((h) => h.kind === 'furniture')
    if (furn.length >= 2) {
      const first = doc.furniture[furn[0]!.id as never]!
      const second = doc.furniture[furn[1]!.id as never]!
      expect(first.size.w * first.size.d).toBeLessThanOrEqual(second.size.w * second.size.d)
    }
  })

  it('nodes hit only when offered as candidates', () => {
    const nodeId = Object.keys(doc.nodes)[0]!
    const n = doc.nodes[nodeId as never]!
    const without = hitTestAll(doc, derived, vec(n.x, n.y), PX)
    expect(without.every((h) => h.kind !== 'node')).toBe(true)
    const withNodes = hitTestAll(doc, derived, vec(n.x, n.y), PX, {
      nodeCandidates: new Set([n.id]),
    })
    expect(withNodes.some((h) => h.kind === 'node')).toBe(true)
  })
})

describe('hitTestRect (marquee) on the fixture apartment', () => {
  resetDerivedForTests()
  const doc = buildFixtureDoc()
  const derived = getDerived(doc)
  const kinds = (a: import('./hitTest').EntityRef[]) => new Set(a.map((h) => h.kind))

  it('a rect crossing a wall EDGE selects it (intersection, not containment)', () => {
    // south wall runs y=0 from x=0..8; rect straddles it near x=2
    const hits = hitTestRect(doc, derived, vec(1.8, -0.3), vec(2.2, 0.3))
    expect(hits.some((h) => h.kind === 'wall')).toBe(true)
  })

  it('a rect fully inside a room selects nothing (rooms are not marquee targets)', () => {
    const hits = hitTestRect(doc, derived, vec(0.8, 3.8), vec(1.2, 4.2))
    expect(hits).toHaveLength(0)
  })

  it('a rect over the whole plan selects walls, openings, and furniture — never rooms/nodes', () => {
    const hits = hitTestRect(doc, derived, vec(-1, -1), vec(11, 6))
    expect(hits.length).toBe(
      Object.keys(doc.walls).length +
        Object.keys(doc.openings).length +
        Object.keys(doc.furniture).length,
    )
    expect(kinds(hits).has('room')).toBe(false)
    expect(kinds(hits).has('node')).toBe(false)
  })

  it('furniture selects by its ROTATED footprint, not its AABB', () => {
    const d2 = buildFixtureDoc()
    const rot = Object.values(d2.furniture)[0]!
    // a 2.2×0.95 item at (20,20) rotated 45°: long axis along the (1,1)
    // diagonal. (20.7,20.7) is INSIDE the rotated shape (local u≈0.99<1.1,
    // v=0) but OUTSIDE the unrotated AABB (y>20.475). (21.05,19.6) is inside
    // the unrotated AABB but OUTSIDE the rotated shape (local |v|≈1.03>0.475).
    d2.furniture[rot.id] = {
      ...rot,
      x: 20,
      y: 20,
      size: { w: 2.2, d: 0.95, h: 0.8 },
      rotation: Math.PI / 4,
    }
    resetDerivedForTests()
    const der2 = getDerived(d2)
    const hits = hitTestRect(d2, der2, vec(20.68, 20.68), vec(20.72, 20.72))
    expect(hits.some((h) => h.kind === 'furniture' && h.id === rot.id)).toBe(true)
    const miss = hitTestRect(d2, der2, vec(21.03, 19.58), vec(21.07, 19.62))
    expect(miss.some((h) => h.kind === 'furniture' && h.id === rot.id)).toBe(false)
  })

  it('an opening selects when the rect covers its span on the wall', () => {
    const solid = Object.values(derived.wallSolids).find((s) => s.openings.length > 0)!
    const op = solid.openings[0]!
    const mid = (op.u0 + op.u1) / 2
    const c = vec(
      solid.frame.origin.x + solid.frame.dir.x * mid,
      solid.frame.origin.y + solid.frame.dir.y * mid,
    )
    const hits = hitTestRect(doc, derived, vec(c.x - 0.1, c.y - 0.1), vec(c.x + 0.1, c.y + 0.1))
    expect(hits.some((h) => h.kind === 'opening' && h.id === op.openingId)).toBe(true)
  })
})

describe('annotationsVisible flag (0.7.0 visibility parity)', () => {
  resetDerivedForTests()
  const doc = buildFixtureDoc()
  const id = addDimension(doc, vec(1, 1), vec(3, 1), 0)!
  const derived = getDerived(doc)
  const on = { x: 2, y: 1 } // on the dimension line

  it('click: hidden annotations never steal hits; default stays hittable', () => {
    expect(hitTestAll(doc, derived, on, PX)[0]).toEqual({ kind: 'annotation', id })
    expect(
      hitTestAll(doc, derived, on, PX, { annotationsVisible: true })[0],
    ).toEqual({ kind: 'annotation', id })
    const hidden = hitTestAll(doc, derived, on, PX, { annotationsVisible: false })
    expect(hidden.some((h) => h.kind === 'annotation')).toBe(false)
  })

  it('marquee: hidden annotations are not rect-selectable', () => {
    const a = vec(0.9, 0.9)
    const b = vec(3.1, 1.1)
    expect(hitTestRect(doc, derived, a, b, PX).some((h) => h.kind === 'annotation')).toBe(true)
    expect(
      hitTestRect(doc, derived, a, b, PX, { annotationsVisible: false }).some(
        (h) => h.kind === 'annotation',
      ),
    ).toBe(false)
  })
})
