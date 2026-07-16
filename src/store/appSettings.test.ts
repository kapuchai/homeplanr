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
  wheelMode: 'zoom',
  uiScale: 1,
  dimensionLevel: 'off',
  showAnnotations: true,
  snapEnabled: true,
  showGrid: true,
  autosaveEnabled: false,
  orbitHintSeen: false,
  catalogPanelWidth: 232,
  propsPanelWidth: 260,
  catalogPanelCollapsed: false,
  propsPanelCollapsed: false,
  lastDirSave: null,
  lastDirExport: null,
  lastDirOpen: null,
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
    const s: AppSettings = {
      theme: 'dark',
      accent: 'teal',
      units: 'ftin',
      wheelMode: 'pan',
      uiScale: 1.25,
      dimensionLevel: 'openings',
      showAnnotations: false,
      snapEnabled: false,
      showGrid: false,
      autosaveEnabled: true,
      orbitHintSeen: true,
      catalogPanelWidth: 300,
      propsPanelWidth: 320,
      catalogPanelCollapsed: true,
      propsPanelCollapsed: true,
      lastDirSave: '/home/u/Documents/plans',
      lastDirExport: '/home/u/Downloads',
      lastDirOpen: '/mnt/shared',
    }
    expect(parseAppSettings(JSON.stringify({ v: 1, ...s }))).toEqual(s)
  })

  it('invalid fields fall back per-field, valid ones survive', () => {
    expect(
      parseAppSettings(
        JSON.stringify({
          v: 1,
          theme: 'light',
          accent: 'hotpink',
          units: 'cm',
          wheelMode: 'scroll',
          uiScale: 2.75,
          dimensionLevel: 'everything',
          snapEnabled: 'off',
          lastDirSave: '',
          lastDirExport: 5,
        }),
      ),
    ).toEqual({
      theme: 'light',
      accent: 'blue',
      units: 'cm',
      wheelMode: 'zoom',
      uiScale: 1,
      dimensionLevel: 'off',
      showAnnotations: true,
      snapEnabled: true,
      showGrid: true,
      autosaveEnabled: false,
      orbitHintSeen: false,
      catalogPanelWidth: 232,
      propsPanelWidth: 260,
      catalogPanelCollapsed: false,
      propsPanelCollapsed: false,
      lastDirSave: null, // '' → unset
      lastDirExport: null, // non-string → unset
      lastDirOpen: null,
    })
    expect(parseAppSettings(JSON.stringify({ v: 1, units: 'inches' }))).toEqual(DEFAULTS)
  })

  it('honors the pre-0.7.0 showDimensions boolean when dimensionLevel is absent', () => {
    expect(parseAppSettings(JSON.stringify({ v: 1, showDimensions: true })).dimensionLevel).toBe(
      'walls',
    )
    expect(parseAppSettings(JSON.stringify({ v: 1, showDimensions: false })).dimensionLevel).toBe(
      'off',
    )
    // the enum key wins over the legacy boolean when both exist
    expect(
      parseAppSettings(JSON.stringify({ v: 1, showDimensions: true, dimensionLevel: 'all' }))
        .dimensionLevel,
    ).toBe('all')
  })

  it('panel widths clamp to their limits; junk falls back to defaults', () => {
    const parsed = parseAppSettings(
      JSON.stringify({ v: 1, catalogPanelWidth: 9999, propsPanelWidth: 'wide' }),
    )
    expect(parsed.catalogPanelWidth).toBe(360) // clamped to max
    expect(parsed.propsPanelWidth).toBe(260) // junk → default
    expect(parseAppSettings(JSON.stringify({ v: 1, catalogPanelWidth: 1 })).catalogPanelWidth).toBe(
      180,
    )
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
      wheelMode: s.wheelMode,
      uiScale: s.uiScale,
      dimensionLevel: s.dimensionLevel,
      showAnnotations: s.showAnnotations,
      snapEnabled: s.snapEnabled,
      showGrid: s.showGrid,
      autosaveEnabled: s.autosaveEnabled,
      orbitHintSeen: s.orbitHintSeen,
      catalogPanelWidth: s.catalogPanelWidth,
      propsPanelWidth: s.propsPanelWidth,
      catalogPanelCollapsed: s.catalogPanelCollapsed,
      propsPanelCollapsed: s.propsPanelCollapsed,
      lastDirSave: s.lastDirSave,
      lastDirExport: s.lastDirExport,
      lastDirOpen: s.lastDirOpen,
    }).toEqual(DEFAULTS)
  })

  it('each setter updates state and writes the v1 envelope', () => {
    const s = useAppSettings.getState()
    s.setTheme('dark')
    s.setAccent('rose')
    s.setUnits('cm')
    s.setWheelMode('pan')
    s.setUiScale(1.5)
    s.setDimensionLevel('walls')
    s.setShowAnnotations(false)
    s.setSnapEnabled(false)
    s.setShowGrid(false)
    s.setAutosaveEnabled(true)
    s.setOrbitHintSeen(true)
    s.setPanelWidth('catalog', 999) // clamps to 360
    s.setPanelWidth('props', 300)
    s.setPanelCollapsed('catalog', true)
    s.setLastDir('export', '/mnt/plans')
    expect(useAppSettings.getState().theme).toBe('dark')
    expect(useAppSettings.getState().units).toBe('cm')
    expect(useAppSettings.getState().snapEnabled).toBe(false)
    expect(useAppSettings.getState().orbitHintSeen).toBe(true)
    expect(useAppSettings.getState().catalogPanelWidth).toBe(360)
    expect(JSON.parse(storage.get(APP_SETTINGS_KEY)!)).toEqual({
      v: 1,
      theme: 'dark',
      accent: 'rose',
      units: 'cm',
      wheelMode: 'pan',
      uiScale: 1.5,
      dimensionLevel: 'walls',
      showAnnotations: false,
      snapEnabled: false,
      showGrid: false,
      autosaveEnabled: true,
      orbitHintSeen: true,
      catalogPanelWidth: 360,
      propsPanelWidth: 300,
      catalogPanelCollapsed: true,
      propsPanelCollapsed: false,
      lastDirSave: null,
      lastDirExport: '/mnt/plans',
      lastDirOpen: null,
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
