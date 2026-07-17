import { describe, expect, it } from 'vitest'
import { testLevelDoc } from '../../test/fixtureDoc'
import { addFurniture } from '../../model/mutations/furniture'
import { familyEdgeCandidates } from './candidates'
import { resolveSnap } from '../../geometry/snapping'
import { vec } from '../../geometry/vec'


function docWith(items: Parameters<typeof addFurniture>[1][]) {
  const doc = testLevelDoc('p_family', 'Family test')
  const ids = items.map((p) => addFurniture(doc, p))
  return { doc, ids }
}

const counter = (x: number, y: number, w = 1.2, rotation = 0) => ({
  catalogItemId: 'counter-x',
  x,
  y,
  rotation,
  size: { w, d: 0.6, h: 0.9 },
})

describe('familyEdgeCandidates', () => {
  it('emits both ends of a straight neighbor, same depth → centers collinear', () => {
    const { doc } = docWith([counter(0, 0)])
    const out = familyEdgeCandidates(doc, { hw: 0.3, hh: 0.3 }, new Set(), () => true)
    expect(out).toHaveLength(2)
    const pts = out
      .map((c) => (c.kind === 'familyEdge' ? c : null))
      .filter((c): c is NonNullable<typeof c> => !!c)
    const xs = pts.map((c) => c.point.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-0.9)
    expect(xs[1]).toBeCloseTo(0.9)
    for (const c of pts) {
      expect(c.point.y).toBeCloseTo(0)
      expect(c.rotation).toBe(0)
    }
  })

  it('aligns BACKS when depths differ (corner 0.9 deep vs run 0.6 deep)', () => {
    const { doc } = docWith([
      { catalogItemId: 'corner', x: 0, y: 0, size: { w: 0.9, d: 0.9, h: 0.9 } },
    ])
    const out = familyEdgeCandidates(doc, { hw: 0.3, hh: 0.3 }, new Set(), () => true)
    // square neighbor → two axes × two sides
    expect(out).toHaveLength(4)
    const axis0 = out.filter((c) => c.kind === 'familyEdge' && c.rotation === 0)
    expect(axis0).toHaveLength(2)
    for (const c of axis0) {
      if (c.kind !== 'familyEdge') continue
      // neighbor back edge at y=+0.45; dragged (0.3 half-depth) center at +0.15
      expect(c.point.y).toBeCloseTo(0.15)
      expect(Math.abs(c.point.x)).toBeCloseTo(0.45 + 0.3)
    }
  })

  it('respects rotation of the neighbor and the exclusion set + predicate', () => {
    const { doc, ids } = docWith([counter(2, 3, 1.2, Math.PI / 2), counter(9, 9)])
    const out = familyEdgeCandidates(
      doc,
      { hw: 0.3, hh: 0.3 },
      new Set([ids[1]!]),
      (f) => f.x !== 9, // predicate can also drop
    )
    expect(out).toHaveLength(2)
    for (const c of out) {
      if (c.kind !== 'familyEdge') continue
      expect(c.rotation).toBeCloseTo(Math.PI / 2)
      expect(c.point.x).toBeCloseTo(2) // kisses along the rotated axis: same x…
    }
    const ys = out.map((c) => (c.kind === 'familyEdge' ? c.point.y : 0)).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(3 - 0.9)
    expect(ys[1]).toBeCloseTo(3 + 0.9)
  })
})

describe('resolveSnap familyEdge behavior', () => {
  const cand = { kind: 'familyEdge' as const, point: vec(1, 0), rotation: Math.PI / 2, refId: 'n:0:1' }

  it('captures within radius and adopts the rotation', () => {
    const r = resolveSnap(vec(1.05, 0.02), [cand], { pxToWorld: 0.01, enabled: true })
    expect(r.primary?.kind).toBe('familyEdge')
    expect(r.point).toEqual(vec(1, 0))
    expect(r.rotation).toBeCloseTo(Math.PI / 2)
    expect(r.constraint).toBeUndefined() // no slide — exact kiss
  })

  it('stays free outside the radius', () => {
    const r = resolveSnap(vec(2, 2), [cand], { pxToWorld: 0.01, enabled: true })
    expect(r.primary).toBeUndefined()
  })
})
