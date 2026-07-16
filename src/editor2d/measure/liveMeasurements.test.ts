import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDocument, type ProjectDocument } from '../../model/types'
import { asOpeningId, type FurnitureId, type OpeningId } from '../../model/ids'
import { addWallChain, addWallSegment } from '../../model/mutations/walls'
import { addOpening } from '../../model/mutations/openings'
import { addFurniture } from '../../model/mutations/furniture'
import { getDerived, resetDerivedForTests, type DerivedGeometry } from '../../store/derived'
import type { RealizedOpening } from '../../geometry/wallSolids'
import { pointInPolygonWithHoles } from '../../geometry/polygon'
import { dist, vec } from '../../geometry/vec'
import {
  dimensionLabels,
  furnitureDragPills,
  furnitureSizeLabels,
  incidentWallIds,
  openingDragPills,
  openingWidthLabels,
  type MeasureInput,
} from './liveMeasurements'
import { pillWidthPx } from '../render/pillMetrics'

/**
 * Pure measurement geometry: gaps come from REALIZED opening intervals and
 * straight-core corner faces (never node positions); furniture rays hit wall
 * faces along the item's local axes.
 */
const doc = (): ProjectDocument => emptyDocument('p_test', 'test', '2026-07-11T00:00:00.000Z')

const mi = (d: ProjectDocument): MeasureInput => ({
  doc: d,
  derived: getDerived(d),
  pxToWorld: 0.01,
  units: 'm',
})

const box = (d: ProjectDocument, x: number, y: number, rotation = 0, w = 1, dd = 0.6) =>
  addFurniture(d, { catalogItemId: 'test-box', x, y, rotation, size: { w, d: dd, h: 1 } })

const room4x3 = (d: ProjectDocument) =>
  addWallChain(d, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])

beforeEach(() => resetDerivedForTests())

describe('openingDragPills', () => {
  it('door between wall end and window: width pill + exact realized-interval gaps', () => {
    const d = doc()
    const wallId = addWallSegment(d, vec(0, 0), vec(6, 0)).wallId!
    const doorId = addOpening(d, { kind: 'door', wallId, t: 0.5 })! // realized [2.55, 3.45]
    addOpening(d, { kind: 'window', wallId, t: 0.8 }) // realized [4.20, 5.40]
    const pills = openingDragPills(mi(d), doorId, vec(3, -0.5))
    expect(pills.map((p) => p.text)).toEqual(['0.90 m', '2.55 m', '0.75 m'])
    // the width pill floats without a measure line; gap pills carry from/to
    expect(pills[0]!.from).toBeUndefined()
    expect(dist(pills[1]!.from!, pills[1]!.to!)).toBeCloseTo(2.55, 9)
    expect(dist(pills[2]!.from!, pills[2]!.to!)).toBeCloseTo(0.75, 9)
    // measured on the wall FACE on the cursor's side (cursor at y<0 ⇒ −perp)
    expect(pills[1]!.from!.y).toBeCloseTo(-0.075, 9)
    expect(pills[2]!.to!.y).toBeCloseTo(-0.075, 9)
  })

  it('L-junction: the end gap stops at the core corner face, not the node', () => {
    const d = doc()
    const wallId = addWallSegment(d, vec(0, 0), vec(6, 0)).wallId!
    addWallSegment(d, vec(0, 0), vec(0, 6))
    const doorId = addOpening(d, { kind: 'door', wallId, t: 0.5 })!
    const pills = openingDragPills(mi(d), doorId, vec(3, 1))
    const gap = dist(pills[1]!.from!, pills[1]!.to!)
    // node-based figure would be 2.55; the miter corner eats half the
    // neighbor's thickness
    expect(gap).toBeCloseTo(2.55 - 0.075, 9)
    expect(gap).toBeLessThan(2.55)
  })

  it('gap clamped to the core margin reads ≈ 0.01 m and never goes negative', () => {
    const d = doc()
    const wallId = addWallSegment(d, vec(0, 0), vec(6, 0)).wallId!
    const doorId = addOpening(d, { kind: 'door', wallId, t: 0.02 })! // slot-clamped to u0 = 0.01
    const pills = openingDragPills(mi(d), doorId, vec(0.4, 1))
    const gap = dist(pills[1]!.from!, pills[1]!.to!)
    expect(gap).toBeCloseTo(0.01, 9)
    expect(gap).toBeGreaterThanOrEqual(0)
    expect(pills[1]!.text).toBe('0.01 m')
  })

  it('suppresses gaps below MIN_GAP', () => {
    const d = doc()
    const wallId = addWallSegment(d, vec(0, 0), vec(6, 0)).wallId!
    const doorId = addOpening(d, { kind: 'door', wallId, t: 0.5 })!
    const base = getDerived(d)
    const solid = base.wallSolids[wallId]!
    // legal docs keep ≥ 1cm between realized openings — hand-patch a copy of
    // the derived data to probe the defensive suppression contract
    const flush: RealizedOpening = {
      openingId: asOpeningId('o_flush'),
      kind: 'window',
      u0: 3.454,
      u1: 4.654,
      z0: 0.9,
      z1: 2.1,
    }
    const patched: DerivedGeometry = {
      ...base,
      wallSolids: {
        ...base.wallSolids,
        [wallId]: { ...solid, openings: [...solid.openings, flush] },
      },
    }
    const pills = openingDragPills(
      { doc: d, derived: patched, pxToWorld: 0.01, units: 'm' },
      doorId,
      vec(3, -1),
    )
    // right gap (0.004) vanishes; width + left gap remain
    expect(pills.map((p) => p.text)).toEqual(['0.90 m', '2.55 m'])
  })
})

describe('furnitureDragPills', () => {
  it('measures all four edges + passive wall lengths in a 4×3 room', () => {
    const d = doc()
    room4x3(d)
    const fid = box(d, 2, 1.5)
    const pills = furnitureDragPills(mi(d), fid)
    const measures = pills.filter((p) => !p.tone)
    const passives = pills.filter((p) => p.tone === 'passive')
    expect(measures).toHaveLength(4)
    const dists = measures.map((p) => dist(p.from!, p.to!)).sort((a, b) => a - b)
    expect(dists[0]).toBeCloseTo(1.125, 9) // front: 1.5 − 0.3 − 0.075
    expect(dists[1]).toBeCloseTo(1.125, 9) // back
    expect(dists[2]).toBeCloseTo(1.425, 9) // left: 2 − 0.5 − 0.075
    expect(dists[3]).toBeCloseTo(1.425, 9) // right
    expect(passives.map((p) => p.text).sort()).toEqual(['3.00 m', '3.00 m', '4.00 m', '4.00 m'])
  })

  it('rotated 90°: rays follow the item-local axes', () => {
    const d = doc()
    room4x3(d)
    const fid = box(d, 2, 1.5, Math.PI / 2)
    const measures = furnitureDragPills(mi(d), fid).filter((p) => !p.tone)
    const dists = measures.map((p) => dist(p.from!, p.to!)).sort((a, b) => a - b)
    // front/back now run along x (1.625 each), left/right along y (0.925 each)
    expect(dists[0]).toBeCloseTo(0.925, 9)
    expect(dists[1]).toBeCloseTo(0.925, 9)
    expect(dists[2]).toBeCloseTo(1.625, 9)
    expect(dists[3]).toBeCloseTo(1.625, 9)
  })

  it('walls beyond MEASURE_MAX_DIST produce nothing', () => {
    const d = doc()
    addWallSegment(d, vec(0, 0), vec(20, 0))
    const fid = box(d, 10, 9) // nearest face 8.625 m away
    expect(furnitureDragPills(mi(d), fid)).toEqual([])
  })

  it('dedupes passive pills when two rays hit the same wall', () => {
    const d = doc()
    room4x3(d)
    const fid = box(d, 2, 0.8, Math.PI / 4, 0.2, 0.2) // 45°: front AND left hit the bottom wall
    const pills = furnitureDragPills(mi(d), fid)
    expect(pills.filter((p) => !p.tone)).toHaveLength(4)
    const passives = pills.filter((p) => p.tone === 'passive')
    expect(passives).toHaveLength(3) // bottom (deduped), left, right
    expect(passives.map((p) => p.text).sort()).toEqual(['3.00 m', '3.00 m', '4.00 m'])
  })

  it('suppresses passive wall pills when permanent dimensions are shown (B4)', () => {
    const d = doc()
    room4x3(d)
    const fid = box(d, 2, 1.5)
    const pills = furnitureDragPills({ ...mi(d), dimensionLevel: 'walls' }, fid)
    expect(pills.filter((p) => !p.tone)).toHaveLength(4) // clearances stay
    expect(pills.filter((p) => p.tone === 'passive')).toEqual([])
  })
})

describe('incidentWallIds', () => {
  it('T-junction node touches 3 walls', () => {
    const d = doc()
    addWallSegment(d, vec(-2, 0), vec(2, 0))
    addWallSegment(d, vec(0, 0), vec(0, 3)) // splits the horizontal wall
    const center = Object.values(d.nodes).find((n) => n.x === 0 && n.y === 0)!
    expect(incidentWallIds(d, center.id)).toHaveLength(3)
  })
})

describe('dimensionLabels', () => {
  it('labels every wall ≥ 0.5 m on the OUTSIDE of its room', () => {
    const d = doc()
    room4x3(d)
    addWallSegment(d, vec(10, 10), vec(10.3, 10)) // < 0.5 m ⇒ no label
    const derived = getDerived(d)
    const labels = dimensionLabels(d, derived, 'm')
    expect(labels.map((l) => l.text).sort()).toEqual(['3.00 m', '3.00 m', '4.00 m', '4.00 m'])
    const room = Object.values(derived.rooms)[0]!
    for (const l of labels) {
      expect(pointInPolygonWithHoles(l.at, room.polygon, room.holePolygons)).toBe(false)
    }
  })

  it('orphan walls take the screen-up side regardless of a→b winding (B5)', () => {
    const d1 = doc()
    addWallSegment(d1, vec(0, 0), vec(2, 0))
    const d2 = doc()
    addWallSegment(d2, vec(2, 0), vec(0, 0)) // reversed winding
    const l1 = dimensionLabels(d1, getDerived(d1), 'm')[0]!
    const l2 = dimensionLabels(d2, getDerived(d2), 'm')[0]!
    expect(l1.at.y).toBeGreaterThan(0) // +y renders screen-up
    expect(l2.at.y).toBeGreaterThan(0)
    expect(l2.at).toEqual(l1.at)
  })

  it('vertical-wall labels clear the wall by the pill half-WIDTH (0.5.0 checklist)', () => {
    const d = doc()
    addWallSegment(d, vec(0, 0), vec(0, 2)) // vertical orphan wall at x=0
    const pxToWorld = 1 / 60
    const [label] = dimensionLabels(d, getDerived(d), 'm', pxToWorld)
    // the pill box is centered on `at`; its near EDGE must clear the wall
    // face (a flat 16px anchor offset only cleared the 9px half-height)
    const halfW = (pillWidthPx(label!.text) / 2) * pxToWorld
    const face = d.settings.defaultWallThickness / 2
    expect(Math.abs(label!.at.x) - halfW).toBeGreaterThanOrEqual(face)
    expect(label!.at.y).toBeCloseTo(1, 9) // still at the wall midpoint
  })

  it('a wall shared by two rooms takes the deterministic side, not the winding side (B5)', () => {
    const d = doc()
    room4x3(d)
    addWallSegment(d, vec(2, 0), vec(2, 3)) // splits into two 2×3 rooms
    const derived = getDerived(d)
    expect(Object.keys(derived.rooms)).toHaveLength(2)
    const labels = dimensionLabels(d, derived, 'm')
    const shared = labels.filter((l) => l.at.x > 1 && l.at.x < 3 && l.text === '3.00 m')
    expect(shared).toHaveLength(1)
    // vertical boundary wall: both sides are interior ⇒ tie-break toward +x
    expect(shared[0]!.at.x).toBeGreaterThan(2)
    expect(shared[0]!.at.y).toBeCloseTo(1.5, 9)
  })
})

describe('openingWidthLabels (0.7.0 ladder)', () => {
  it('one width label per opening, on the OPPOSITE side of the wall label', () => {
    const d = doc()
    room4x3(d)
    const wall = Object.values(d.walls).find(
      (w) => d.nodes[w.a]!.y === 0 && d.nodes[w.b]!.y === 0,
    )!
    addOpening(d, { kind: 'door', wallId: wall.id, t: 0.5, width: 0.9 })
    const derived = getDerived(d)
    const labels = openingWidthLabels(d, derived, 'm', 0.01)
    expect(labels.map((l) => l.text)).toEqual(['0.90 m'])
    expect(labels[0]!.length).toBeCloseTo(0.9, 9)
    expect(labels[0]!.at.x).toBeCloseTo(2, 6) // centered on the opening
    // the wall's own label sits OUTSIDE the room (below); the opening width
    // takes the opposite side (inside) so the two never collide mid-wall
    const wallLabel = dimensionLabels(d, derived, 'm', 0.01).find((l) => l.wallId === wall.id)!
    expect(wallLabel.at.y).toBeLessThan(0)
    expect(labels[0]!.at.y).toBeGreaterThan(0)
  })
})

describe('furnitureSizeLabels (0.7.0 ladder)', () => {
  it('w × d label per given item, hung off the BACK edge; junk ids skipped', () => {
    const d = doc()
    const fid = box(d, 2, 1, 0, 1.2, 0.6) // rotation 0 ⇒ back = +y
    const labels = furnitureSizeLabels(d, [fid, 'junk'], 'm', 0.01)
    expect(labels).toHaveLength(1)
    expect(labels[0]!.text).toBe('1.20 m × 0.60 m')
    expect(labels[0]!.length).toBeCloseTo(1.2, 9) // max(w, d) for the cull
    expect(labels[0]!.at.x).toBeCloseTo(2, 9)
    expect(labels[0]!.at.y).toBeGreaterThan(1 + 0.3 - 1e-9) // beyond the back edge
  })
})

describe('performance budgets (loose CI thresholds)', () => {
  function bigFixture(): { d: ProjectDocument; furnitureId: FurnitureId; openingId: OpeningId } {
    const d = emptyDocument('p_perf', 'perf', '2026-07-11T00:00:00.000Z')
    // 10×5 grid of 2m rooms ⇒ >100 walls (mirrors store/perf.test.ts)
    for (let gx = 0; gx < 10; gx++) {
      for (let gy = 0; gy < 5; gy++) {
        addWallChain(
          d,
          [
            vec(gx * 2, gy * 2),
            vec(gx * 2 + 2, gy * 2),
            vec(gx * 2 + 2, gy * 2 + 2),
            vec(gx * 2, gy * 2 + 2),
            vec(gx * 2, gy * 2),
          ],
          { mode: 'live' },
        )
      }
    }
    addWallChain(d, [vec(0, 0), vec(0.01, 0)])
    const walls = Object.values(d.walls)
    let openingId: OpeningId | null = null
    for (let i = 0; i < 30; i++) {
      const id = addOpening(d, { kind: i % 2 ? 'door' : 'window', wallId: walls[i * 3]!.id, t: 0.5 })
      openingId ??= id
    }
    let furnitureId: FurnitureId | null = null
    for (let i = 0; i < 60; i++) {
      const id = addFurniture(d, {
        catalogItemId: 'dining-chair',
        x: (i % 10) * 2 + 1,
        y: Math.floor(i / 10) + 0.6,
        size: { w: 0.45, d: 0.52, h: 0.88 },
      })
      furnitureId ??= id
    }
    return { d, furnitureId: furnitureId!, openingId: openingId! }
  }

  it('drag pill computation stays under budget on the 100-wall fixture', () => {
    const { d, furnitureId, openingId } = bigFixture()
    const m = mi(d)
    const wall = d.walls[d.openings[openingId]!.wallId]!
    const na = d.nodes[wall.a]!
    const cursor = vec(na.x + 0.5, na.y + 0.5)
    furnitureDragPills(m, furnitureId) // warm-up (JIT)
    openingDragPills(m, openingId, cursor)
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) {
      furnitureDragPills(m, furnitureId)
      openingDragPills(m, openingId, cursor)
    }
    const avg = (performance.now() - t0) / 100
    expect(avg).toBeLessThan(5)
  })

  it('dimensionLabels stays under budget on the 100-wall fixture', () => {
    const { d } = bigFixture()
    const derived = getDerived(d)
    dimensionLabels(d, derived, 'm') // warm-up + per-doc room-map memo
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) dimensionLabels(d, derived, 'm')
    const avg = (performance.now() - t0) / 100
    expect(avg).toBeLessThan(10)
  })
})
