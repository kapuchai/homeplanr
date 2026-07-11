import { describe, expect, it } from 'vitest'
import { resolveSnap, type SnapCandidate, type SnapResult } from './snapping'
import { vec } from './vec'
import { asNodeId, asWallId } from '../model/ids'

const PX = 0.01 // 1px = 1cm — radii become: node 0.1, wallPoint 0.08, wallBack 0.12/0.18, guides 0.06

const node = (x: number, y: number, id = 'n1'): SnapCandidate => ({
  kind: 'node',
  point: vec(x, y),
  nodeId: asNodeId(id),
})
const wallPoint = (x: number, y: number, t = 0.5): SnapCandidate => ({
  kind: 'wallPoint',
  point: vec(x, y),
  wallId: asWallId('w1'),
  t,
})
const wallBack = (x: number, y: number): SnapCandidate => ({
  kind: 'wallBack',
  point: vec(x, y),
  wallId: asWallId('w1'),
  rotation: Math.PI / 2,
  slideOrigin: vec(x, y),
  slideDir: vec(1, 0),
})
const grid = (step = 0.1): SnapCandidate => ({ kind: 'grid', step })
const guideX = (value: number): SnapCandidate => ({ kind: 'guideX', value, refIds: [] })
const guideY = (value: number): SnapCandidate => ({ kind: 'guideY', value, refIds: [] })
const ray = (ox: number, oy: number, dx: number, dy: number): SnapCandidate => ({
  kind: 'angleRay',
  origin: vec(ox, oy),
  dir: vec(dx, dy),
  label: '0°',
})

const opts = (extra: Partial<Parameters<typeof resolveSnap>[2]> = {}) => ({
  pxToWorld: PX,
  ...extra,
})

describe('resolveSnap priorities', () => {
  it('node beats wallPoint beats grid', () => {
    const r = resolveSnap(
      vec(1.05, 1.0),
      [node(1, 1), wallPoint(1.02, 1.0), grid()],
      opts(),
    )
    expect(r.primary?.kind).toBe('node')
    expect(r.point).toEqual(vec(1, 1))
  })

  it('wallPoint wins when node is out of radius', () => {
    const r = resolveSnap(
      vec(1.05, 1.0),
      [node(2, 2), wallPoint(1.02, 1.0), grid()],
      opts(),
    )
    expect(r.primary?.kind).toBe('wallPoint')
  })

  it('radius is respected: distant candidates fall through to grid', () => {
    const r = resolveSnap(vec(0.234, 0.567), [node(1, 1), grid(0.1)], opts())
    expect(r.primary).toBeUndefined()
    expect(r.point.x).toBeCloseTo(0.2, 12)
    expect(r.point.y).toBeCloseTo(0.6, 12)
    expect(r.axes?.x).toEqual(grid(0.1))
  })

  it('no candidates → raw point', () => {
    const r = resolveSnap(vec(0.234, 0.567), [], opts())
    expect(r.point).toEqual(vec(0.234, 0.567))
  })
})

describe('per-axis guides', () => {
  it('guideX + grid on the free axis', () => {
    const r = resolveSnap(vec(2.05, 0.734), [guideX(2.0), grid(0.1)], opts())
    expect(r.point.x).toBeCloseTo(2.0, 12)
    expect(r.point.y).toBeCloseTo(0.7, 12)
    expect(r.axes?.x?.kind).toBe('guideX')
    expect(r.axes?.y?.kind).toBe('grid')
  })

  it('guideX + guideY intersection', () => {
    const r = resolveSnap(vec(2.04, 3.03), [guideX(2.0), guideY(3.0)], opts())
    expect(r.point).toEqual(vec(2, 3))
  })

  it('closest guide wins per axis', () => {
    const r = resolveSnap(vec(2.05, 0), [guideX(2.0), guideX(2.08)], opts())
    expect(r.point.x).toBeCloseTo(2.08, 12)
  })
})

describe('angle ray composition', () => {
  it('ray captures within 7.5° and projects the point onto it', () => {
    // raw at ~3° above the +x ray from origin
    const r = resolveSnap(vec(2, 0.1), [ray(0, 0, 1, 0)], opts())
    expect(r.constraint?.kind).toBe('ray')
    expect(r.point.y).toBeCloseTo(0, 12)
    expect(r.point.x).toBeCloseTo(2, 12)
  })

  it('grid composes along the ray (projection of grid-snapped point)', () => {
    const r = resolveSnap(vec(2.04, 0.05), [ray(0, 0, 1, 0), grid(0.1)], opts())
    expect(r.point.y).toBeCloseTo(0, 12)
    expect(r.point.x).toBeCloseTo(2.0, 12)
  })

  it('node in capture escapes the ray outright', () => {
    const r = resolveSnap(vec(2, 0.08), [ray(0, 0, 1, 0), node(2.02, 0.13)], opts())
    expect(r.primary?.kind).toBe('node')
    expect(r.point).toEqual(vec(2.02, 0.13))
  })

  it('ray is ignored beyond angular capture', () => {
    const r = resolveSnap(vec(2, 0.5), [ray(0, 0, 1, 0)], opts()) // ~14°
    expect(r.constraint).toBeUndefined()
    expect(r.point).toEqual(vec(2, 0.5))
  })
})

describe('wallBack corner composition', () => {
  it('a guide along the slide axis clamps the capture point into the corner', () => {
    // slide along +x at y=0; a guideX (perpendicular wall face, offset for
    // the item's half-width) sits at x=2.03; cursor near it → corner snap
    const cand: SnapCandidate[] = [
      wallBack(2.0, 0.0),
      { kind: 'guideX', value: 2.03, refIds: ['w2'] },
    ]
    const r = resolveSnap(vec(2.0, 0.1), cand, opts())
    expect(r.primary?.kind).toBe('wallBack')
    expect(r.point.x).toBeCloseTo(2.03, 12) // clamped along the slide
    expect(r.point.y).toBeCloseTo(0, 12) // still on the wall face
    expect(r.rotation).toBeCloseTo(Math.PI / 2, 12)
    expect(r.axes?.x?.kind).toBe('guideX')
  })

  it('guides beyond capture radius do not disturb the slide', () => {
    const cand: SnapCandidate[] = [
      wallBack(2.0, 0.0),
      { kind: 'guideX', value: 2.5, refIds: ['w2'] }, // 0.5m away ≫ 6px
    ]
    const r = resolveSnap(vec(2.0, 0.1), cand, opts())
    expect(r.point.x).toBeCloseTo(2.0, 12)
  })
})

describe('wallBack capture + slide constraint', () => {
  it('produces rotation and a wallSlide constraint', () => {
    const r = resolveSnap(vec(1.0, 0.1), [wallBack(1.0, 0.0)], opts())
    expect(r.primary?.kind).toBe('wallBack')
    expect(r.rotation).toBeCloseTo(Math.PI / 2, 12)
    expect(r.constraint?.kind).toBe('wallSlide')
    expect(r.constraint?.wallId).toBe(asWallId('w1'))
  })

  it('hysteresis: sticky within release radius, dropped beyond it', () => {
    const first = resolveSnap(vec(1.0, 0.1), [wallBack(1.0, 0.0)], opts())
    // 0.15 is beyond capture (0.12) but within release (0.18) → sticky holds
    const held: SnapResult = resolveSnap(vec(1.0, 0.15), [wallBack(1.0, 0.0)], opts({ prev: first }))
    expect(held.primary?.kind).toBe('wallBack')
    // 0.2 exceeds release → free
    const freed = resolveSnap(vec(1.0, 0.2), [wallBack(1.0, 0.0)], opts({ prev: held }))
    expect(freed.primary).toBeUndefined()
  })

  it('without prev, 0.15 offset does not capture (capture < release)', () => {
    const r = resolveSnap(vec(1.0, 0.15), [wallBack(1.0, 0.0)], opts())
    expect(r.primary).toBeUndefined()
  })
})

describe('external constraint + disabled snapping', () => {
  it('external wallSlide projects even point snaps', () => {
    const slide = { kind: 'wallSlide' as const, origin: vec(0, 0), dir: vec(1, 0) }
    const r = resolveSnap(vec(2, 0.05), [node(2.02, 0.06)], opts({ constraint: slide }))
    expect(r.point.y).toBeCloseTo(0, 12)
  })

  it('enabled:false returns raw but keeps hard external constraints', () => {
    const slide = { kind: 'wallSlide' as const, origin: vec(0, 0), dir: vec(1, 0) }
    const off = resolveSnap(vec(2.04, 0.3), [node(2.0, 0.31), grid()], opts({ enabled: false }))
    expect(off.point).toEqual(vec(2.04, 0.3))
    const offC = resolveSnap(
      vec(2.04, 0.3),
      [node(2.0, 0.31)],
      opts({ enabled: false, constraint: slide }),
    )
    expect(offC.point.y).toBeCloseTo(0, 12)
    expect(offC.point.x).toBeCloseTo(2.04, 12)
  })
})
