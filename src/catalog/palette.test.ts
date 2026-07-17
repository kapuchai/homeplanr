import { describe, expect, it } from 'vitest'
import {
  FLOOR_IDS,
  FLOOR_MATERIALS,
  WALL_FINISHES,
  WALL_FINISH_IDS,
  finishSpec,
  floorSpec,
} from './palette'
import { wallFaceMaterial } from '../scene3d/sceneMaterials'

/**
 * Registry contracts (0.8.0): the open finish/floor registries feed the
 * validator, the mutation gates, the panels, AND the 3D materials — a
 * malformed entry (or a lookup that throws on unknown ids) breaks files
 * that are supposed to be forward-compatible.
 */

describe('WALL_FINISHES registry', () => {
  it('ids are unique, non-empty, never the reserved absent-default "paint"', () => {
    const ids = WALL_FINISHES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of WALL_FINISHES) {
      expect(f.id).toBeTruthy()
      expect(f.id).not.toBe('paint')
      expect(f.name).toBeTruthy()
      expect(f.swatch).toMatch(/^#[0-9a-f]{6}$/i)
      expect(f.roughness).toBeGreaterThan(0)
      expect(f.roughness).toBeLessThanOrEqual(1)
    }
    expect(WALL_FINISH_IDS.size).toBe(ids.length)
  })

  it('the three pre-v5 ids stay stable (documents reference them)', () => {
    for (const id of ['brick', 'concrete', 'tile']) {
      expect(WALL_FINISH_IDS.has(id)).toBe(true)
    }
  })

  it('finishSpec: known → spec, unknown/absent → null (plain paint)', () => {
    expect(finishSpec('brick')?.pattern).toBe('brick')
    expect(finishSpec('wallpaperStripe')?.pattern).toBe('wallpaperStripe')
    expect(finishSpec('stucco-2030')).toBeNull()
    expect(finishSpec(undefined)).toBeNull()
    expect(finishSpec('paint')).toBeNull()
  })
})

describe('wallFaceMaterial (node — pattern map is null, materials still build)', () => {
  it('never throws on unknown finish ids and falls back to the paint roughness', () => {
    const m = wallFaceMaterial('sage', 'stucco-2030')
    expect(m.roughness).toBeCloseTo(0.9, 9)
    // same fallback identity as plain paint — one material, not one per id
    expect(wallFaceMaterial('sage', undefined)).toBe(m)
  })

  it('every registered finish builds a material with its spec roughness', () => {
    for (const f of WALL_FINISHES) {
      const m = wallFaceMaterial(undefined, f.id)
      expect(m.roughness).toBeCloseTo(f.roughness, 9)
    }
  })
})

describe('FLOOR_MATERIALS registry', () => {
  it('ids unique; frozen pre-0.2.0 ids present; floorSpec falls back to wood', () => {
    const ids = FLOOR_MATERIALS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['woodFloor', 'parquetLight', 'laminateGray', 'darkFloor']) {
      expect(FLOOR_IDS.has(id)).toBe(true)
    }
    expect(floorSpec('nope-2030').id).toBe('woodFloor')
    expect(floorSpec(undefined).id).toBe('woodFloor')
  })
})
