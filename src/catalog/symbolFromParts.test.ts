import { describe, expect, it } from 'vitest'
import { symbolFor } from './symbolFromParts'
import { CATALOG } from './index'
import type { CatalogItem } from './types'

/** Minimal item factory — unique id per case (symbolFor memoizes by id). */
const item = (id: string, build3d: CatalogItem['build3d']): CatalogItem => ({
  id,
  name: id,
  category: 'living',
  dims: { w: 1, d: 1, h: 1 },
  wallSnap: false,
  materials: {},
  build3d,
})

describe('symbolFromParts hints + dedup (M3, 0.4.0)', () => {
  it("symbol: 'omit' skips the part's projection", () => {
    const prims = symbolFor(
      item('t_omit', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.3, 0.3, 0.2], at: [0.2, 0.2, 0.2], symbol: 'omit' })
      }),
    )
    expect(prims).toHaveLength(2) // body mask + the one kept part
  })

  it("symbol: 'outline' promotes the prim role", () => {
    const prims = symbolFor(
      item('t_outline', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0], symbol: 'outline' })
      }),
    )
    expect(prims.map((p) => p.role)).toEqual(['body', 'outline'])
  })

  it('near-duplicate footprints dedup at 1mm — stacked box tower is ONE prim', () => {
    const prims = symbolFor(
      item('t_dedup', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0.2] }) // same footprint
        b.box('m', { size: [0.5004, 0.5004, 0.2], at: [0, 0, 0.4] }) // within 1mm
      }),
    )
    expect(prims).toHaveLength(2) // body + one deduped rect
  })

  it('an outline hint survives dedup against a plain detail twin', () => {
    const prims = symbolFor(
      item('t_dedup_role', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] }) // detail (lower)
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0.2], symbol: 'outline' })
      }),
    )
    expect(prims).toHaveLength(2)
    expect(prims[1]!.role).toBe('outline')
  })

  it('distinct footprints are NOT deduped', () => {
    const prims = symbolFor(
      item('t_distinct', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.3, 0.5, 0.2], at: [0, 0, 0.2] })
      }),
    )
    expect(prims).toHaveLength(3)
  })

  it('desk-chair authoring: base omitted, seat outlined — 3 prims total', () => {
    const prims = symbolFor(CATALOG['desk-chair']!)
    expect(prims).toHaveLength(3) // body mask + seat (outline) + backrest
    expect(prims.filter((p) => p.role === 'outline')).toHaveLength(1)
  })

  it('every catalog item still yields a body mask first + at least one part prim', () => {
    for (const entry of Object.values(CATALOG)) {
      const prims = symbolFor(entry)
      expect(prims.length, entry.id).toBeGreaterThanOrEqual(2)
      expect(prims[0]!.role, entry.id).toBe('body')
    }
  })
})
