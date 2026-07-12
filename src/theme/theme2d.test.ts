import { describe, expect, it } from 'vitest'
import { ACCENT_IDS } from '../store/appSettings'
import { ACCENTS } from './accents'
import { getTheme2d, type Theme2D } from './theme2d'
import { getTheme3d } from './theme3d'
import { initTheming, useThemeStore } from './themeStore'

const THEME2D_KEYS: readonly (keyof Theme2D)[] = [
  'paper',
  'gridMinor',
  'gridMajor',
  'wall',
  'accent',
  'accentSoft',
  'snap',
  'guide',
  'invalid',
  'text',
  'textMuted',
  'pillBg',
  'pillBorder',
  'symbolBody',
  'symbolLine',
  'symbolDetail',
  'handleFill',
  'roomFills',
]

const COLOR_RE =
  /^(#[0-9a-fA-F]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*\d*\.?\d+\s*)?\))$/

const allColors = (t: Theme2D): string[] =>
  THEME2D_KEYS.flatMap((k) => {
    const v = t[k]
    return typeof v === 'string' ? [v] : [...v]
  })

describe('getTheme2d', () => {
  const light = getTheme2d('light', 'blue')
  const dark = getTheme2d('dark', 'blue')

  it('both palettes carry every key', () => {
    expect(Object.keys(light).sort()).toEqual([...THEME2D_KEYS].sort())
    expect(Object.keys(dark).sort()).toEqual([...THEME2D_KEYS].sort())
  })

  it('light and dark differ on every key', () => {
    // snap/guide/invalid stay in the same vivid hue family across modes,
    // but even those must resolve to different values.
    for (const key of THEME2D_KEYS) {
      if (key === 'roomFills') continue
      expect(light[key], key).not.toBe(dark[key])
    }
    expect(light.roomFills).toHaveLength(6)
    expect(dark.roomFills).toHaveLength(6)
    light.roomFills.forEach((fill, i) => {
      expect(fill).not.toBe(dark.roomFills[i])
    })
  })

  it('accent id injects into accent/accentSoft', () => {
    for (const id of ACCENT_IDS) {
      expect(getTheme2d('light', id).accent).toBe(ACCENTS[id].light)
      expect(getTheme2d('light', id).accentSoft).toBe(ACCENTS[id].softLight)
      expect(getTheme2d('dark', id).accent).toBe(ACCENTS[id].dark)
      expect(getTheme2d('dark', id).accentSoft).toBe(ACCENTS[id].softDark)
    }
  })

  it('every value parses as a hex or rgb(a) color', () => {
    for (const id of ACCENT_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        for (const value of allColors(getTheme2d(mode, id))) {
          expect(value).toMatch(COLOR_RE)
        }
      }
    }
  })
})

describe('themeStore in node', () => {
  it('defaults to light/blue and initTheming is a guarded no-op', () => {
    const { resolved, theme, theme3d } = useThemeStore.getState()
    expect(resolved).toBe('light')
    expect(theme).toEqual(getTheme2d('light', 'blue'))
    expect(theme3d).toEqual(getTheme3d('light'))
    const unsubscribe = initTheming()
    expect(unsubscribe).toBeTypeOf('function')
    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('getTheme3d', () => {
  it('returns a distinct background per mode, all values colors', () => {
    const light = getTheme3d('light')
    const dark = getTheme3d('dark')
    expect(light.canvasBg).not.toBe(dark.canvasBg)
    for (const t of [light, dark]) {
      for (const value of Object.values(t)) {
        expect(value).toMatch(COLOR_RE)
      }
    }
  })
})
