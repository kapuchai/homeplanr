import { describe, expect, it } from 'vitest'
import { patternTexture, type PatternKind } from './proceduralTextures'

/**
 * These tests run in the node environment — there is NO document/canvas 2D,
 * so patternTexture must return null (and cache that null) without ever
 * throwing. Pixel determinism cannot be asserted here; the no-Math.random /
 * hash-only property is enforced by code review, not by pixels.
 */

// `satisfies` forces this map to list every PatternKind exactly once.
const KIND_MAP = {
  plank: true,
  tile: true,
  stone: true,
  brick: true,
  concrete: true,
} as const satisfies Record<PatternKind, true>
const KINDS = Object.keys(KIND_MAP) as PatternKind[]

describe('patternTexture (node — canvas 2D unavailable)', () => {
  it('handles every pattern kind without throwing', () => {
    for (const kind of KINDS) {
      expect(() => patternTexture(kind)).not.toThrow()
    }
  })

  it('returns null when canvas 2D is unavailable', () => {
    for (const kind of KINDS) {
      expect(patternTexture(kind)).toBeNull()
    }
  })

  it('same kind → same cached instance (the null is cached here)', () => {
    for (const kind of KINDS) {
      const first = patternTexture(kind)
      expect(patternTexture(kind)).toBe(first)
      expect(patternTexture(kind)).toBe(first)
    }
  })
})
