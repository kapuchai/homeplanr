import { describe, expect, it } from 'vitest'
import { hitTestAll, hitTestTop } from './hitTest'
import { buildFixtureDoc } from '../../test/fixtureDoc'
import { getDerived, resetDerivedForTests } from '../../store/derived'
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
