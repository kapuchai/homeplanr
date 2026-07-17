import { describe, expect, it } from 'vitest'
import {
  DOOR_STYLES,
  OPENING_STYLES,
  STANDARD_STYLE_ID,
  WINDOW_STYLES,
  openingStyleSpec,
  openingStylesFor,
} from './openingStyles'

describe('opening style registry (0.10.0)', () => {
  it('ids are unique per kind and non-empty', () => {
    for (const styles of [DOOR_STYLES, WINDOW_STYLES]) {
      const ids = styles.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const s of styles) {
        expect(s.id).toBeTruthy()
        expect(s.name).toBeTruthy()
      }
    }
  })

  it('every style belongs to exactly one kind list', () => {
    expect(DOOR_STYLES.every((s) => s.kind === 'door')).toBe(true)
    expect(WINDOW_STYLES.every((s) => s.kind === 'window')).toBe(true)
    expect(DOOR_STYLES.length + WINDOW_STYLES.length).toBe(OPENING_STYLES.length)
  })

  it('standard is FIRST in both kind lists (the spec-lookup fallback slot)', () => {
    expect(DOOR_STYLES[0]!.id).toBe(STANDARD_STYLE_ID)
    expect(WINDOW_STYLES[0]!.id).toBe(STANDARD_STYLE_ID)
  })

  it('openingStyleSpec resolves unknown/absent ids to the kind standard', () => {
    expect(openingStyleSpec('door', undefined).id).toBe(STANDARD_STYLE_ID)
    expect(openingStyleSpec('door', 'no-such-style').id).toBe(STANDARD_STYLE_ID)
    expect(openingStyleSpec('window', 'garage').id).toBe(STANDARD_STYLE_ID) // door-only id
    expect(openingStyleSpec('door', 'sliding').id).toBe('sliding')
    expect(openingStyleSpec('window', 'panorama').id).toBe('panorama')
  })

  it('defaults are positive and sills are sane', () => {
    for (const s of OPENING_STYLES) {
      if (s.defaults?.width !== undefined) expect(s.defaults.width).toBeGreaterThan(0)
      if (s.defaults?.height !== undefined) expect(s.defaults.height).toBeGreaterThan(0)
      if (s.defaults?.sillHeight !== undefined) {
        expect(s.defaults.sillHeight).toBeGreaterThanOrEqual(0)
      }
      if (s.restyleSill !== undefined) expect(s.kind).toBe('window')
    }
  })

  it('full-height forces sill 0 at placement AND restyle', () => {
    const fh = openingStyleSpec('window', 'fullheight')
    expect(fh.defaults?.sillHeight).toBe(0)
    expect(fh.restyleSill).toBe(0)
  })

  it('openingStylesFor returns the kind lists', () => {
    expect(openingStylesFor('door')).toBe(DOOR_STYLES)
    expect(openingStylesFor('window')).toBe(WINDOW_STYLES)
  })
})
