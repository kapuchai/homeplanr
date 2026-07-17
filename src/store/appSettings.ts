import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { UnitSystem } from '../format/units'
import { CURRENCIES } from '../format/units'

/**
 * App-level preferences — device-local, never part of the document and never
 * undoable. Hand-rolled localStorage persistence (guarded: unit tests run in
 * node without DOM). Seeded synchronously at module init so the first render
 * already has the stored values.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type AccentId = 'blue' | 'violet' | 'green' | 'amber' | 'rose' | 'teal'
/** What a PLAIN wheel does in the 2D editor — 'zoom' (mouse default) or
 * 'pan' (trackpad two-finger scroll; pinch/ctrl+wheel still zooms). */
export type WheelMode = 'zoom' | 'pan'
/**
 * Permanent dimension-label ladder (0.7.0; each level includes the last):
 * 'off' → none, 'walls' → wall lengths (the pre-0.7.0 boolean ON),
 * 'openings' → + door/window widths, 'all' → + selected-furniture size.
 * Room areas are NOT part of the ladder — they live in the room labels.
 */
export type DimensionLevel = 'off' | 'walls' | 'openings' | 'all'
/** Interface-scale presets (Options → Appearance). */
export type UiScale = 0.9 | 1 | 1.1 | 1.25 | 1.5

export interface AppSettings {
  theme: ThemePreference
  accent: AccentId
  units: UnitSystem
  wheelMode: WheelMode
  /** Chrome typography multiplier (accessibility) — drives the --ui-scale
   * CSS token (initTheming) and the counter-scaled canvas pill/label
   * chrome. World-sized text (label annotations, meters) never scales.
   * Orthogonal to the viewport zoom k. */
  uiScale: UiScale
  /** Currency DISPLAY for furniture prices (0.9.0) — a device pref like
   * units: prices in the doc stay unit-less numbers. CURRENCIES id. */
  currency: string
  dimensionLevel: DimensionLevel
  /** Visibility of user annotations (persisted measures + text labels) —
   * view-only: annotations stay document content and always export.
   * Creating one while hidden re-enables this (else Enter looks dead). */
  showAnnotations: boolean
  /** Snap master switch — device preference since schema v3 (doc-level snap
   * made every toggle an undo entry and dirtied the file). */
  snapEnabled: boolean
  /** 2D grid visibility (grid SIZE stays in the document). */
  showGrid: boolean
  /** Autosave to the current file path (crash recovery is separate). */
  autosaveEnabled: boolean
  /** One-time 3D orbit hint — set on the first orbit interaction. */
  orbitHintSeen: boolean
  /** Side-panel layout (px, clamped to PANEL_LIMITS) + collapse toggles. */
  catalogPanelWidth: number
  propsPanelWidth: number
  catalogPanelCollapsed: boolean
  propsPanelCollapsed: boolean
  /** Last-used native-dialog directories per dialog kind (B7) — null until
   * the user picks somewhere; defaults come from defaultDirs.ts
   * (exports → Downloads, saves/opens → Documents). Tauri-only. */
  lastDirSave: string | null
  lastDirExport: string | null
  lastDirOpen: string | null
  lastDirImage: string | null
}

/** Native-dialog kinds with independent remembered directories (B7).
 * 'image' (v6 wall-art upload) defaults to Pictures. */
export type DialogDirKind = 'save' | 'export' | 'open' | 'image'

/** Panel width clamps + defaults — shared with the PanelHandle splitter. */
export const PANEL_LIMITS = {
  catalog: { min: 180, max: 360, def: 232 },
  props: { min: 220, max: 420, def: 260 },
} as const

export const APP_SETTINGS_KEY = 'homeplanr:v1:app-settings'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']
export const ACCENT_IDS: readonly AccentId[] = ['blue', 'violet', 'green', 'amber', 'rose', 'teal']
const UNIT_SYSTEMS: readonly UnitSystem[] = ['m', 'cm', 'ftin']
export const WHEEL_MODES: readonly WheelMode[] = ['zoom', 'pan']
/** Ladder order — Shift+D cycles through this array. */
export const DIMENSION_LEVELS: readonly DimensionLevel[] = ['off', 'walls', 'openings', 'all']
export const UI_SCALES: readonly UiScale[] = [0.9, 1, 1.1, 1.25, 1.5]

const DEFAULTS: AppSettings = {
  theme: 'system',
  accent: 'blue',
  units: 'm',
  wheelMode: 'zoom',
  uiScale: 1,
  currency: 'eur',
  dimensionLevel: 'off',
  showAnnotations: true,
  snapEnabled: true,
  showGrid: true,
  autosaveEnabled: false,
  orbitHintSeen: false,
  catalogPanelWidth: PANEL_LIMITS.catalog.def,
  propsPanelWidth: PANEL_LIMITS.props.def,
  catalogPanelCollapsed: false,
  propsPanelCollapsed: false,
  lastDirSave: null,
  lastDirExport: null,
  lastDirOpen: null,
  lastDirImage: null,
}

const dirOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const clampWidth = (value: unknown, lim: { min: number; max: number; def: number }): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(lim.max, Math.max(lim.min, Math.round(value)))
    : lim.def

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** Decode + validate per field; anything unusable → that field's default (never throws). */
export function parseAppSettings(json: string | null): AppSettings {
  if (!json) return { ...DEFAULTS }
  try {
    const raw: unknown = JSON.parse(json)
    if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) {
      return { ...DEFAULTS }
    }
    const r = raw as Record<string, unknown>
    return {
      theme: pick(r.theme, THEME_PREFERENCES, DEFAULTS.theme),
      accent: pick(r.accent, ACCENT_IDS, DEFAULTS.accent),
      units: pick(r.units, UNIT_SYSTEMS, DEFAULTS.units),
      wheelMode: pick(r.wheelMode, WHEEL_MODES, DEFAULTS.wheelMode),
      uiScale: pick(r.uiScale, UI_SCALES, DEFAULTS.uiScale),
      currency: pick(
        r.currency,
        CURRENCIES.map((c) => c.id),
        DEFAULTS.currency,
      ),
      // pre-0.7.0 envelopes stored the boolean `showDimensions`; honor it
      // when the enum key is absent (true was exactly today's 'walls')
      dimensionLevel: pick(
        r.dimensionLevel,
        DIMENSION_LEVELS,
        r.showDimensions === true ? 'walls' : DEFAULTS.dimensionLevel,
      ),
      showAnnotations:
        typeof r.showAnnotations === 'boolean' ? r.showAnnotations : DEFAULTS.showAnnotations,
      snapEnabled: typeof r.snapEnabled === 'boolean' ? r.snapEnabled : DEFAULTS.snapEnabled,
      showGrid: typeof r.showGrid === 'boolean' ? r.showGrid : DEFAULTS.showGrid,
      autosaveEnabled:
        typeof r.autosaveEnabled === 'boolean' ? r.autosaveEnabled : DEFAULTS.autosaveEnabled,
      orbitHintSeen:
        typeof r.orbitHintSeen === 'boolean' ? r.orbitHintSeen : DEFAULTS.orbitHintSeen,
      catalogPanelWidth: clampWidth(r.catalogPanelWidth, PANEL_LIMITS.catalog),
      propsPanelWidth: clampWidth(r.propsPanelWidth, PANEL_LIMITS.props),
      catalogPanelCollapsed:
        typeof r.catalogPanelCollapsed === 'boolean'
          ? r.catalogPanelCollapsed
          : DEFAULTS.catalogPanelCollapsed,
      propsPanelCollapsed:
        typeof r.propsPanelCollapsed === 'boolean'
          ? r.propsPanelCollapsed
          : DEFAULTS.propsPanelCollapsed,
      lastDirSave: dirOrNull(r.lastDirSave),
      lastDirExport: dirOrNull(r.lastDirExport),
      lastDirOpen: dirOrNull(r.lastDirOpen),
      lastDirImage: dirOrNull(r.lastDirImage),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

const safeGet = (): string | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(APP_SETTINGS_KEY)
  } catch {
    return null
  }
}

const persist = (s: AppSettings): void => {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({
        v: 1,
        theme: s.theme,
        accent: s.accent,
        units: s.units,
        wheelMode: s.wheelMode,
        uiScale: s.uiScale,
        currency: s.currency,
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
        lastDirImage: s.lastDirImage,
      }),
    )
  } catch {
    // storage unavailable or full — settings stay session-local
  }
}

interface AppSettingsState extends AppSettings {
  setTheme: (theme: ThemePreference) => void
  setAccent: (accent: AccentId) => void
  setUnits: (units: UnitSystem) => void
  setWheelMode: (mode: WheelMode) => void
  setUiScale: (scale: UiScale) => void
  setCurrency: (currency: string) => void
  setDimensionLevel: (level: DimensionLevel) => void
  setShowAnnotations: (show: boolean) => void
  setSnapEnabled: (enabled: boolean) => void
  setShowGrid: (show: boolean) => void
  setAutosaveEnabled: (enabled: boolean) => void
  setOrbitHintSeen: (seen: boolean) => void
  /** Clamped + persisted. During a drag, write via useAppSettings.setState
   * (no localStorage churn per pointermove) and call this on pointer-up. */
  setPanelWidth: (panel: 'catalog' | 'props', width: number) => void
  setPanelCollapsed: (panel: 'catalog' | 'props', collapsed: boolean) => void
  setLastDir: (kind: DialogDirKind, dir: string) => void
}

export const useAppSettings = create<AppSettingsState>()(
  subscribeWithSelector((set, get) => {
    const apply = (patch: Partial<AppSettings>) => {
      set(patch)
      persist(get())
    }
    return {
      ...parseAppSettings(safeGet()),
      setTheme: (theme) => apply({ theme }),
      setAccent: (accent) => apply({ accent }),
      setUnits: (units) => apply({ units }),
      setWheelMode: (wheelMode) => apply({ wheelMode }),
      setUiScale: (uiScale) => apply({ uiScale }),
      setCurrency: (currency) => apply({ currency }),
      setDimensionLevel: (dimensionLevel) => apply({ dimensionLevel }),
      setShowAnnotations: (showAnnotations) => apply({ showAnnotations }),
      setSnapEnabled: (snapEnabled) => apply({ snapEnabled }),
      setShowGrid: (showGrid) => apply({ showGrid }),
      setAutosaveEnabled: (autosaveEnabled) => apply({ autosaveEnabled }),
      setOrbitHintSeen: (orbitHintSeen) => apply({ orbitHintSeen }),
      setPanelWidth: (panel, width) =>
        apply(
          panel === 'catalog'
            ? { catalogPanelWidth: clampWidth(width, PANEL_LIMITS.catalog) }
            : { propsPanelWidth: clampWidth(width, PANEL_LIMITS.props) },
        ),
      setPanelCollapsed: (panel, collapsed) =>
        apply(
          panel === 'catalog'
            ? { catalogPanelCollapsed: collapsed }
            : { propsPanelCollapsed: collapsed },
        ),
      setLastDir: (kind, dir) =>
        apply(
          kind === 'save'
            ? { lastDirSave: dir }
            : kind === 'export'
              ? { lastDirExport: dir }
              : kind === 'image'
                ? { lastDirImage: dir }
                : { lastDirOpen: dir },
        ),
    }
  }),
)
