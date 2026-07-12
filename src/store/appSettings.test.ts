import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  APP_SETTINGS_KEY,
  parseAppSettings,
  useAppSettings,
  type AppSettings,
} from './appSettings'

const DEFAULTS: AppSettings = {
  theme: 'system',
  accent: 'blue',
  units: 'm',
  showDimensions: false,
}

describe('parseAppSettings', () => {
  it('null, garbage, non-objects, and wrong versions → defaults', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULTS)
    expect(parseAppSettings('not json{')).toEqual(DEFAULTS)
    expect(parseAppSettings('"hello"')).toEqual(DEFAULTS)
    expect(parseAppSettings('42')).toEqual(DEFAULTS)
    expect(parseAppSettings(JSON.stringify({ v: 2, theme: 'dark' }))).toEqual(DEFAULTS)
    expect(parseAppSettings(JSON.stringify({ theme: 'dark' }))).toEqual(DEFAULTS)
  })

  it('roundtrips a full v1 envelope', () => {
    const s: AppSettings = { theme: 'dark', accent: 'teal', units: 'ftin', showDimensions: true }
    expect(parseAppSettings(JSON.stringify({ v: 1, ...s }))).toEqual(s)
  })

  it('invalid fields fall back per-field, valid ones survive', () => {
    expect(
      parseAppSettings(
        JSON.stringify({ v: 1, theme: 'light', accent: 'hotpink', units: 'cm', showDimensions: 1 }),
      ),
    ).toEqual({ theme: 'light', accent: 'blue', units: 'cm', showDimensions: false })
    expect(parseAppSettings(JSON.stringify({ v: 1, units: 'inches' }))).toEqual(DEFAULTS)
  })
})

describe('useAppSettings persistence', () => {
  const storage = new Map<string, string>()
  // defineProperty: node ≥22 may expose its own localStorage accessor
  const stubLocalStorage = (impl: unknown) =>
    Object.defineProperty(globalThis, 'localStorage', {
      value: impl,
      configurable: true,
      writable: true,
    })

  beforeEach(() => {
    storage.clear()
    stubLocalStorage({
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    })
    useAppSettings.setState({ ...DEFAULTS })
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('seeds with defaults when storage is empty', () => {
    const s = useAppSettings.getState()
    expect({
      theme: s.theme,
      accent: s.accent,
      units: s.units,
      showDimensions: s.showDimensions,
    }).toEqual(DEFAULTS)
  })

  it('each setter updates state and writes the v1 envelope', () => {
    const s = useAppSettings.getState()
    s.setTheme('dark')
    s.setAccent('rose')
    s.setUnits('cm')
    s.setShowDimensions(true)
    expect(useAppSettings.getState().theme).toBe('dark')
    expect(useAppSettings.getState().units).toBe('cm')
    expect(JSON.parse(storage.get(APP_SETTINGS_KEY)!)).toEqual({
      v: 1,
      theme: 'dark',
      accent: 'rose',
      units: 'cm',
      showDimensions: true,
    })
  })

  it('persisted envelope roundtrips through parseAppSettings', () => {
    useAppSettings.getState().setUnits('ftin')
    expect(parseAppSettings(storage.get(APP_SETTINGS_KEY) ?? null)).toEqual({
      ...DEFAULTS,
      units: 'ftin',
    })
  })

  it('a throwing localStorage never breaks setters', () => {
    stubLocalStorage({
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => useAppSettings.getState().setTheme('light')).not.toThrow()
    expect(useAppSettings.getState().theme).toBe('light')
  })
})
