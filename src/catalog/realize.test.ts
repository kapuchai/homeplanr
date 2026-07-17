import { describe, expect, it } from 'vitest'
import type { BufferGeometry } from 'three'
import { CATALOG } from './index'
import { SEAM_EPS, realizeItem } from './realize'
import { collectParts } from './builder'

/**
 * realizeItem mirrored-variant pins (M4 flip). Mirroring is PART-LEVEL
 * (mirrorPart) — never a negative-scale matrix — so the realized mesh must
 * keep its triangle counts, negate+swap its x-range, and keep VALID winding:
 * the signed volume from triangle winding stays positive (a negative-scale
 * mirror would flip every shell inside out and the sign with it).
 *
 * sofa-3/desk are mirrorX-built (x-symmetric bboxes); desk-chair (5-star
 * base with rotZ parts) and fridge (left-hinge handles) have genuinely
 * x-asymmetric groups, making the bbox pins non-trivial.
 */
const ITEM_IDS = ['sofa-3', 'desk', 'desk-chair', 'fridge'] as const

type V3 = [number, number, number]

function bboxOf(geo: BufferGeometry): { min: V3; max: V3 } {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] }
}

const triangleCount = (geo: BufferGeometry): number =>
  (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3

function triangleAt(geo: BufferGeometry, t: number): [V3, V3, V3] {
  const pos = geo.getAttribute('position')
  const corner = (k: number): V3 => {
    const i = geo.index ? geo.index.getX(t * 3 + k) : t * 3 + k
    return [pos.getX(i), pos.getY(i), pos.getZ(i)]
  }
  return [corner(0), corner(1), corner(2)]
}

/**
 * Signed volume from triangle winding (Σ a·(b×c) / 6) — positive for
 * closed shells wound outward (the prismGeometry.test.ts principle:
 * orientation is computed FROM WINDING, never trusted from attributes).
 */
function signedVolume(geo: BufferGeometry): number {
  let six = 0
  const n = triangleCount(geo)
  for (let t = 0; t < n; t++) {
    const [a, b, c] = triangleAt(geo, t)
    six +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  return six / 6
}

describe('realizeItem mirrored', () => {
  for (const id of ITEM_IDS) {
    describe(id, () => {
      const item = CATALOG[id]!
      it('is in the catalog', () => {
        expect(item).toBeDefined()
      })

      it('same groups + triangle counts; bbox x-range negated+swapped, y/z identical', () => {
        const o = realizeItem(item)
        const m = realizeItem(item, { mirrored: true })
        expect(m.groups.length).toBe(o.groups.length)
        for (let gi = 0; gi < o.groups.length; gi++) {
          const go = o.groups[gi]!
          const gm = m.groups[gi]!
          expect(gm.mat).toBe(go.mat)
          expect(triangleCount(gm.geometry)).toBe(triangleCount(go.geometry))
          const bo = bboxOf(go.geometry)
          const bm = bboxOf(gm.geometry)
          expect(Math.abs(bm.min[0] - -bo.max[0])).toBeLessThan(1e-6)
          expect(Math.abs(bm.max[0] - -bo.min[0])).toBeLessThan(1e-6)
          for (const axis of [1, 2] as const) {
            expect(Math.abs(bm.min[axis] - bo.min[axis])).toBeLessThan(1e-6)
            expect(Math.abs(bm.max[axis] - bo.max[axis])).toBeLessThan(1e-6)
          }
        }
      })

      it('cache: mirrored calls share one object, distinct from unmirrored', () => {
        const m1 = realizeItem(item, { mirrored: true })
        const m2 = realizeItem(item, { mirrored: true })
        const o1 = realizeItem(item)
        const o2 = realizeItem(item, { mirrored: false })
        expect(m1).toBe(m2)
        expect(o1).toBe(o2)
        expect(m1).not.toBe(o1)
      })

      it('winding survives: signed volume positive and preserved per group', () => {
        const o = realizeItem(item)
        const m = realizeItem(item, { mirrored: true })
        for (let gi = 0; gi < o.groups.length; gi++) {
          const vo = signedVolume(o.groups[gi]!.geometry)
          const vm = signedVolume(m.groups[gi]!.geometry)
          expect(vo).toBeGreaterThan(0)
          expect(vm).toBeGreaterThan(0)
          expect(vm).toBeCloseTo(vo, 6)
        }
      })
    })
  }

  it('mirrored desk tabletop still winds upward (+z normal from winding)', () => {
    const desk = CATALOG['desk']!
    const top = realizeItem(desk, { mirrored: true }).groups.find((g) => g.mat === 'top')!
    // the tabletop's top face sits one seam inset below the authored
    // plane z = h (0.11.0 z-fight fix; centers never drift)
    const zTop = desk.dims.h - SEAM_EPS
    let found = 0
    const n = triangleCount(top.geometry)
    for (let t = 0; t < n; t++) {
      const [a, b, c] = triangleAt(top.geometry, t)
      if ([a, b, c].some((p) => Math.abs(p[2] - zTop) > 1e-6)) continue
      const nz =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      expect(nz).toBeGreaterThan(0)
      found++
    }
    expect(found).toBeGreaterThanOrEqual(2)
  })
})

describe('slot merging never drops groups', () => {
  // Regression: RoundedBox (non-indexed) mixed with Box/Cylinder (indexed) in
  // one slot made mergeGeometries fail and the slot silently vanish —
  // partGeometry now normalizes to non-indexed so any mix merges.
  it('every catalog item (both variants) yields one geometry per used slot', () => {
    for (const item of Object.values(CATALOG)) {
      const usedSlots = new Set(collectParts((b) => item.build3d(b, item.dims)).map((p) => p.mat))
      for (const mirrored of [false, true]) {
        const r = realizeItem(item, { mirrored })
        expect(r.groups.map((g) => g.mat).sort(), `${item.id}${mirrored ? '|m' : ''}`).toEqual(
          [...usedSlots].sort(),
        )
        for (const g of r.groups) expect(g.geometry.getAttribute('position').count).toBeGreaterThan(0)
      }
    }
  })
})
