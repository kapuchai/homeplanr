import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { computeWallOutlines } from './wallOutline'
import { area, pointInPolygon, signedArea } from './polygon'
import { vec, type Vec2 } from './vec'
import { MITER_LIMIT } from './constants'
import { asNodeId, asWallId } from '../model/ids'
import { fixture } from '../test/fixtures'

const T = 0.3 // generous thickness so tiling tests have interior margin

/**
 * Sampled tiling check for right-angle/collinear fixtures (where the true
 * wall union equals the union of flat-capped centerline rectangles): every
 * point ≥`margin` inside some wall rectangle must be covered by EXACTLY one
 * output polygon (wall quad or node patch) — no gaps, no overlaps; every
 * point ≥`margin` outside all rectangles must be covered by none. The grid
 * is offset by small primes so no sample lands exactly on an edge.
 */
function assertTiling(
  fx: ReturnType<typeof fixture>,
  region: { minX: number; maxX: number; minY: number; maxY: number },
  step = 0.025,
  margin = 0.012,
) {
  const out = computeWallOutlines(fx.nodes, fx.walls)
  const polys: Vec2[][] = [
    ...Object.values(out.wallPolygons),
    ...Object.values(out.nodePatches),
  ]
  const segs = Object.values(fx.walls).map((w) => {
    const A = vec(fx.nodes[w.a]!.x, fx.nodes[w.a]!.y)
    const B = vec(fx.nodes[w.b]!.x, fx.nodes[w.b]!.y)
    const len = Math.hypot(B.x - A.x, B.y - A.y)
    const dir = vec((B.x - A.x) / len, (B.y - A.y) / len)
    return { A, dir, len, half: w.thickness / 2 }
  })
  const localUV = (p: Vec2, s: (typeof segs)[number]) => {
    const dx = p.x - s.A.x
    const dy = p.y - s.A.y
    return { u: dx * s.dir.x + dy * s.dir.y, v: dx * s.dir.y - dy * s.dir.x }
  }
  let checkedInside = 0
  let checkedOutside = 0
  for (let x = region.minX + 0.0137; x <= region.maxX; x += step) {
    for (let y = region.minY + 0.0071; y <= region.maxY; y += step) {
      const p = vec(x, y)
      const insideM = segs.some((s) => {
        const { u, v } = localUV(p, s)
        return u >= margin && u <= s.len - margin && Math.abs(v) <= s.half - margin
      })
      const outsideM = segs.every((s) => {
        const { u, v } = localUV(p, s)
        return u < -margin || u > s.len + margin || Math.abs(v) > s.half + margin
      })
      if (!insideM && !outsideM) continue // boundary band — skip
      const covered = polys.filter((poly) => pointInPolygon(p, poly)).length
      if (insideM) {
        expect(covered, `interior point (${x.toFixed(3)},${y.toFixed(3)}) cover count`).toBe(1)
        checkedInside++
      } else {
        expect(covered, `exterior point (${x.toFixed(3)},${y.toFixed(3)}) cover count`).toBe(0)
        checkedOutside++
      }
    }
  }
  // Guard against a vacuous test.
  expect(checkedInside).toBeGreaterThan(50)
  expect(checkedOutside).toBeGreaterThan(50)
  return out
}

describe('computeWallOutlines', () => {
  it('isolated wall: butt caps, exact area, full-length core', () => {
    const fx = fixture(
      [
        ['n1', 0, 0],
        ['n2', 4, 0],
      ],
      [['w1', 'n1', 'n2', 0.2]],
    )
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const poly = out.wallPolygons[asWallId('w1')]!
    expect(poly).toHaveLength(4)
    expect(area(poly)).toBeCloseTo(4 * 0.2, 9)
    expect(signedArea(poly)).toBeGreaterThan(0)
    const xs = poly.map((p) => p.x)
    const ys = poly.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(0, 9)
    expect(Math.max(...xs)).toBeCloseTo(4, 9)
    expect(Math.min(...ys)).toBeCloseTo(-0.1, 9)
    expect(Math.max(...ys)).toBeCloseTo(0.1, 9)
    expect(out.wallCores[asWallId('w1')]).toEqual([0, 4])
    expect(Object.keys(out.nodePatches)).toHaveLength(0)
  })

  it('90° L-corner: hand-computed miter corners, core starts at t/2, no patch', () => {
    const t = 0.2
    const fx = fixture(
      [
        ['nc', 0, 0],
        ['ne', 3, 0],
        ['ns', 0, 3],
      ],
      [
        ['w1', 'nc', 'ne', t], // east
        ['w2', 'nc', 'ns', t], // "south" (+y)
      ],
    )
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const p1 = out.wallPolygons[asWallId('w1')]!
    // Inner corner (t/2, t/2) and outer corner (−t/2, −t/2) must be vertices of w1.
    const has = (poly: Vec2[], q: Vec2) =>
      poly.some((p) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9)
    expect(has(p1, vec(t / 2, t / 2))).toBe(true)
    expect(has(p1, vec(-t / 2, -t / 2))).toBe(true)
    const p2 = out.wallPolygons[asWallId('w2')]!
    expect(has(p2, vec(t / 2, t / 2))).toBe(true)
    expect(has(p2, vec(-t / 2, -t / 2))).toBe(true)
    // Core of w1 starts past the inner miter vertex.
    expect(out.wallCores[asWallId('w1')]![0]).toBeCloseTo(t / 2, 9)
    expect(out.wallCores[asWallId('w1')]![1]).toBeCloseTo(3, 9)
    // Mitered 2-way corner needs no patch.
    expect(Object.keys(out.nodePatches)).toHaveLength(0)
  })

  it('straight 180° chain with equal thickness: shared flank corners, no patch', () => {
    const fx = fixture(
      [
        ['n1', -2, 0],
        ['n2', 0, 0],
        ['n3', 2, 0],
      ],
      [
        ['w1', 'n1', 'n2', 0.2],
        ['w2', 'n2', 'n3', 0.2],
      ],
    )
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const p1 = out.wallPolygons[asWallId('w1')]!
    const p2 = out.wallPolygons[asWallId('w2')]!
    // w1's b-end corners and w2's a-end corners are the same two points.
    const cornerSet = (poly: Vec2[]) =>
      poly.filter((p) => Math.abs(p.x) < 1e-9).map((p) => p.y.toFixed(9))
    expect(cornerSet(p1).sort()).toEqual(cornerSet(p2).sort())
    expect(Object.keys(out.nodePatches)).toHaveLength(0)
  })

  it('unequal-thickness collinear chain: bevels tile with no gap and need no patch', () => {
    const fx = fixture(
      [
        ['n1', -2, 0],
        ['n2', 0, 0],
        ['n3', 2, 0],
      ],
      [
        ['w1', 'n1', 'n2', 0.3],
        ['w2', 'n2', 'n3', 0.15],
      ],
    )
    // The step junction has no interior notch: the two quads tile the union
    // exactly; the degenerate (zero-area) patch ring must be dropped.
    const out = assertTiling(fx, { minX: -0.8, maxX: 0.8, minY: -0.4, maxY: 0.4 })
    expect(out.nodePatches[asNodeId('n2')]).toBeUndefined()
  })

  it('T-junction: patch exists and the junction tiles exactly', () => {
    const fx = fixture(
      [
        ['nw', -2, 0],
        ['nc', 0, 0],
        ['ne', 2, 0],
        ['ns', 0, 2],
      ],
      [
        ['w1', 'nw', 'nc', T],
        ['w2', 'nc', 'ne', T],
        ['w3', 'nc', 'ns', T],
      ],
    )
    const out = assertTiling(fx, { minX: -0.9, maxX: 0.9, minY: -0.5, maxY: 0.9 })
    expect(out.nodePatches[asNodeId('nc')]).toBeDefined()
  })

  it('4-way cross: central patch is the t×t square, tiles exactly', () => {
    const fx = fixture(
      [
        ['nw', -2, 0],
        ['ne', 2, 0],
        ['nn', 0, -2],
        ['ns', 0, 2],
        ['nc', 0, 0],
      ],
      [
        ['w1', 'nw', 'nc', T],
        ['w2', 'nc', 'ne', T],
        ['w3', 'nn', 'nc', T],
        ['w4', 'nc', 'ns', T],
      ],
    )
    const out = assertTiling(fx, { minX: -0.9, maxX: 0.9, minY: -0.9, maxY: 0.9 })
    const patch = out.nodePatches[asNodeId('nc')]!
    expect(patch).toBeDefined()
    expect(area(patch)).toBeCloseTo(T * T, 6)
  })

  it('sliver junction (10°): miter limit forces bevel; corners stay bounded', () => {
    const a = (10 * Math.PI) / 180
    const fx = fixture(
      [
        ['nc', 0, 0],
        ['n1', 3, 0],
        ['n2', 3 * Math.cos(a), 3 * Math.sin(a)],
      ],
      [
        ['w1', 'nc', 'n1', 0.2],
        ['w2', 'nc', 'n2', 0.2],
      ],
    )
    const out = computeWallOutlines(fx.nodes, fx.walls)
    const bound = MITER_LIMIT * 0.2 + 1e-9
    // The sliver-side wedge must have beveled: every vertex near the node
    // stays within the miter limit.
    for (const poly of Object.values(out.wallPolygons)) {
      for (const p of poly) {
        const dNode = Math.hypot(p.x, p.y)
        const dEnd1 = Math.hypot(p.x - 3, p.y)
        const dEnd2 = Math.hypot(p.x - 3 * Math.cos(a), p.y - 3 * Math.sin(a))
        expect(Math.min(dNode, dEnd1, dEnd2)).toBeLessThanOrEqual(bound)
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      }
    }
    // Note: near-parallel overlapping walls are the plan's documented
    // "allow-and-render-weird" case — no patch/tiling guarantees here,
    // only boundedness (asserted above).
  })

  it('fuzz: random junctions never explode (finite, bounded, positive rings)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            theta: fc.double({ min: 0, max: Math.PI * 2 - 1e-6, noNaN: true }),
            thickness: fc.double({ min: 0.05, max: 0.4, noNaN: true }),
            length: fc.double({ min: 1, max: 5, noNaN: true }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        (defs) => {
          // Drop near-duplicate directions instead of rejecting the case —
          // fast-check biases toward boundary values, so duplicate angles
          // are common and fc.pre would skip nearly every run.
          const kept: typeof defs = []
          for (const d of defs.slice().sort((x, y) => x.theta - y.theta)) {
            const prev = kept[kept.length - 1]
            if (!prev || d.theta - prev.theta > 0.05) kept.push(d)
          }
          if (kept.length >= 2) {
            const first = kept[0]!
            const last = kept[kept.length - 1]!
            if (first.theta + 2 * Math.PI - last.theta <= 0.05) kept.pop()
          }
          if (kept.length === 0) return

          const nodeDefs: [string, number, number][] = [['c', 0, 0]]
          const wallDefs: [string, string, string, number?][] = []
          kept.forEach((d, i) => {
            nodeDefs.push([`p${i}`, d.length * Math.cos(d.theta), d.length * Math.sin(d.theta)])
            wallDefs.push([`w${i}`, 'c', `p${i}`, d.thickness])
          })
          const fx = fixture(nodeDefs, wallDefs)
          const out = computeWallOutlines(fx.nodes, fx.walls)
          const maxT = Math.max(...kept.map((d) => d.thickness))
          const maxL = Math.max(...kept.map((d) => d.length))
          for (const poly of Object.values(out.wallPolygons)) {
            expect(poly).toHaveLength(4)
            expect(signedArea(poly)).toBeGreaterThanOrEqual(0)
            for (const p of poly) {
              expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
              expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(maxL + MITER_LIMIT * maxT + 1e-6)
            }
          }
          for (const patch of Object.values(out.nodePatches)) {
            for (const p of patch) {
              expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
              expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(MITER_LIMIT * maxT + 1e-6)
            }
          }
        },
      ),
      { numRuns: 150 },
    )
  })
})
