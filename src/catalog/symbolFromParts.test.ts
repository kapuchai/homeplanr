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

describe('symbolFromParts hints + dedup (M3 0.4.0; footprint layer 0.7.0)', () => {
  // Every unique footprint yields THREE prims since 0.7.0: silhouette stroke
  // + body fill (the flattened footprint layer) + the detail/outline hairline.

  it("symbol: 'omit' skips the part's projection", () => {
    const prims = symbolFor(
      item('t_omit', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.3, 0.3, 0.2], at: [0.2, 0.2, 0.2], symbol: 'omit' })
      }),
    )
    expect(prims).toHaveLength(3) // silhouette + body + the one kept part
  })

  it("symbol: 'outline' promotes the prim role", () => {
    const prims = symbolFor(
      item('t_outline', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0], symbol: 'outline' })
      }),
    )
    expect(prims.map((p) => p.role)).toEqual(['silhouette', 'body', 'outline'])
  })

  it('near-duplicate footprints dedup at 1mm — stacked box tower is ONE shape', () => {
    const prims = symbolFor(
      item('t_dedup', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0.2] }) // same footprint
        b.box('m', { size: [0.5004, 0.5004, 0.2], at: [0, 0, 0.4] }) // within 1mm
      }),
    )
    expect(prims).toHaveLength(3) // silhouette + body + one deduped rect
  })

  it('an outline hint survives dedup against a plain detail twin', () => {
    const prims = symbolFor(
      item('t_dedup_role', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] }) // detail (lower)
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0.2], symbol: 'outline' })
      }),
    )
    expect(prims).toHaveLength(3)
    expect(prims[2]!.role).toBe('outline')
  })

  it('distinct footprints are NOT deduped', () => {
    const prims = symbolFor(
      item('t_distinct', (b) => {
        b.box('m', { size: [0.5, 0.5, 0.2], at: [0, 0, 0] })
        b.box('m', { size: [0.3, 0.5, 0.2], at: [0, 0, 0.2] })
      }),
    )
    expect(prims).toHaveLength(6) // 2 shapes × (silhouette + body + detail)
  })

  it('desk-chair authoring: base omitted, seat outlined — 2 shapes, 6 prims', () => {
    const prims = symbolFor(CATALOG['desk-chair']!)
    expect(prims).toHaveLength(6) // (seat + backrest) × three roles
    expect(prims.filter((p) => p.role === 'outline')).toHaveLength(1)
  })

  it('every item yields a silhouette-first footprint layer + body fills + hairlines', () => {
    for (const entry of Object.values(CATALOG)) {
      const prims = symbolFor(entry)
      expect(prims.length, entry.id).toBeGreaterThanOrEqual(3)
      expect(prims[0]!.role, entry.id).toBe('silhouette')
      expect(
        prims.some((p) => p.role === 'body'),
        entry.id,
      ).toBe(true)
      // the three layers stay balanced: one silhouette + one body per shape
      const count = (role: string) => prims.filter((p) => p.role === role).length
      expect(count('silhouette'), entry.id).toBe(count('body'))
      expect(count('outline') + count('detail'), entry.id).toBe(count('body'))
    }
  })
})
