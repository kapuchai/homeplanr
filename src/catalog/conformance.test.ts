import { describe, expect, it } from 'vitest'
import { CATALOG, CATEGORY_ORDER } from './index'
import { PALETTE } from './palette'
import { collectParts, partsBounds } from './builder'
import type { SymbolPrim } from './types'

/**
 * Catalog conformance suite — the authoring oracle (plan §Catalog).
 * Table-driven over EVERY item so the twelve M5 additions are born verified.
 * Guards the cm→m conversion traps and 2D/3D drift.
 */
const items = Object.values(CATALOG)

function symbolBounds(prims: SymbolPrim[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const p of prims) {
    switch (p.kind) {
      case 'rect':
        grow(p.x, p.y)
        grow(p.x + p.w, p.y + p.h)
        break
      case 'line':
        grow(p.x1, p.y1)
        grow(p.x2, p.y2)
        break
      case 'circle':
        grow(p.cx - p.r, p.cy - p.r)
        grow(p.cx + p.r, p.cy + p.r)
        break
      case 'path': {
        const nums = p.d.match(/-?\d*\.?\d+/g)?.map(Number) ?? []
        for (let i = 0; i + 1 < nums.length; i += 2) grow(nums[i]!, nums[i + 1]!)
        break
      }
    }
  }
  return { minX, minY, maxX, maxY }
}

describe('catalog conformance', () => {
  it('ids are unique and categories valid', () => {
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of items) {
      expect(CATEGORY_ORDER).toContain(item.category)
    }
  })

  for (const item of items) {
    describe(item.id, () => {
      it('dims within human-scale bounds', () => {
        expect(item.dims.w).toBeGreaterThanOrEqual(0.2)
        expect(item.dims.w).toBeLessThanOrEqual(3.5)
        expect(item.dims.d).toBeGreaterThanOrEqual(0.2)
        expect(item.dims.d).toBeLessThanOrEqual(3.5)
        expect(item.dims.h).toBeGreaterThanOrEqual(0.3)
        expect(item.dims.h).toBeLessThanOrEqual(2.5)
      })

      it('symbol2d stays within the footprint (+1cm; swing ticks may poke front)', () => {
        const b = symbolBounds(item.symbol2d)
        const m = 0.011
        expect(b.minX).toBeGreaterThanOrEqual(-item.dims.w / 2 - m)
        expect(b.maxX).toBeLessThanOrEqual(item.dims.w / 2 + m)
        // front (−y) allows a 15cm affordance zone for swing ticks/handles
        expect(b.minY).toBeGreaterThanOrEqual(-item.dims.d / 2 - 0.15)
        expect(b.maxY).toBeLessThanOrEqual(item.dims.d / 2 + m)
        // and the BODY prims must fill a sensible share of the footprint
        const body = symbolBounds(item.symbol2d.filter((p) => p.role === 'body'))
        const cover =
          ((body.maxX - body.minX) * (body.maxY - body.minY)) / (item.dims.w * item.dims.d)
        expect(cover).toBeGreaterThanOrEqual(0.5)
      })

      it('3D parts fit the dims box (+1cm) with correct height', () => {
        const parts = collectParts((b) => item.build3d(b, item.dims))
        expect(parts.length).toBeGreaterThan(0)
        const { min, max } = partsBounds(parts)
        const m = 0.011
        expect(min[0]).toBeGreaterThanOrEqual(-item.dims.w / 2 - m)
        expect(max[0]).toBeLessThanOrEqual(item.dims.w / 2 + m)
        expect(min[1]).toBeGreaterThanOrEqual(-item.dims.d / 2 - m)
        expect(max[1]).toBeLessThanOrEqual(item.dims.d / 2 + m)
        expect(min[2]).toBeGreaterThanOrEqual(-1e-9)
        expect(max[2]).toBeGreaterThanOrEqual(item.dims.h - 0.02)
        expect(max[2]).toBeLessThanOrEqual(item.dims.h + 0.02)
        // footprint coverage (bbox heuristic ≥ 60%)
        const cover =
          ((max[0] - min[0]) * (max[1] - min[1])) / (item.dims.w * item.dims.d)
        expect(cover).toBeGreaterThanOrEqual(0.6)
      })

      it('every part references a declared material slot; slots map to the palette', () => {
        const parts = collectParts((b) => item.build3d(b, item.dims))
        for (const part of parts) {
          expect(item.materials[part.mat], `slot '${part.mat}'`).toBeDefined()
        }
        for (const mat of Object.values(item.materials)) {
          expect(PALETTE[mat], `palette '${mat}'`).toBeDefined()
        }
      })

      if (item.wallSnap) {
        it('wallSnap: parts reach within 2cm of the back edge', () => {
          const parts = collectParts((b) => item.build3d(b, item.dims))
          const { max } = partsBounds(parts)
          expect(max[1]).toBeGreaterThanOrEqual(item.dims.d / 2 - 0.02)
        })
      }
    })
  }
})
