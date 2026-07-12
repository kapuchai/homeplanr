import { describe, expect, it } from 'vitest'
import { CATALOG, CATEGORY_ORDER } from './index'
import { PALETTE } from './palette'
import { collectParts, mirrorPart, partsBounds, type Builder } from './builder'
import { symbolFor } from './symbolFromParts'
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
        // command-aware walk — arc commands carry FLAGS that a naive
        // number-pairing parser would misread as coordinates
        const tokens = p.d.match(/[MLAZmlaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
        let i = 0
        let cmd = ''
        while (i < tokens.length) {
          const t = tokens[i]!
          if (/[MLAZmlaz]/.test(t)) {
            cmd = t.toUpperCase()
            i++
            continue
          }
          if (cmd === 'A') {
            // rx ry rot largeArc sweep x y — our ellipse pattern puts arc
            // endpoints at the x-extremes, so only y needs the ±ry sweep
            const ry = Number(tokens[i + 1]!)
            const x = Number(tokens[i + 5]!)
            const y = Number(tokens[i + 6]!)
            grow(x, y - ry)
            grow(x, y + ry)
            i += 7
          } else {
            grow(Number(tokens[i]!), Number(tokens[i + 1]!))
            i += 2
          }
        }
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

  it('mirrorX builder helper and instance mirroring agree', () => {
    // deliberately asymmetric probe parts exercising every mirrored field:
    // off-center boxes with full Euler rot, a rounded box, an axis+scale
    // cylinder
    const emit = (b: Builder) => {
      b.box('a', { size: [0.4, 0.3, 0.2], at: [0.25, -0.1, 0.05], rot: [0.3, 0.2, 0.1] })
      b.box('a', { size: [0.2, 0.15, 0.1], at: [-0.15, 0.2, 0], round: 0.02 })
      b.cylinder('b', { r: 0.05, h: 0.4, at: [0.3, 0.1, 0], axis: 'y', scale: [1, 1.2, 1] })
    }
    const originals = collectParts(emit)
    const viaMirrorX = collectParts((b) => b.mirrorX(() => emit(b)))
    expect(viaMirrorX.slice(originals.length)).toEqual(originals.map(mirrorPart))
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

      it('derived symbol stays within the footprint (+2cm)', () => {
        // symbols are DERIVED from the 3D parts (symbolFromParts) — this
        // guards the deriver itself (projection math, ellipse paths)
        const prims = symbolFor(item)
        expect(prims.length).toBeGreaterThan(1)
        const b = symbolBounds(prims)
        const m = 0.021
        expect(b.minX).toBeGreaterThanOrEqual(-item.dims.w / 2 - m)
        expect(b.maxX).toBeLessThanOrEqual(item.dims.w / 2 + m)
        expect(b.minY).toBeGreaterThanOrEqual(-item.dims.d / 2 - m)
        expect(b.maxY).toBeLessThanOrEqual(item.dims.d / 2 + m)
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
