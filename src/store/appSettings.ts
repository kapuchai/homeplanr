import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { UnitSystem } from '../format/units'

/**
 * App-level preferences — device-local, never part of the document and never
 * undoable. Hand-rolled localStorage persistence (guarded: unit tests run in
 * node without DOM). Seeded synchronously at module init so the first render
 * already has the stored values.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type AccentId = 'blue' | 'violet' | 'green' | 'amber' | 'rose' | 'teal'

export interface AppSettings {
  theme: ThemePreference
  accent: AccentId
  units: UnitSystem
  showDimensions: boolean
}

export const APP_SETTINGS_KEY = 'homeplanr:v1:app-settings'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']
export const ACCENT_IDS: readonly AccentId[] = ['blue', 'violet', 'green', 'amber', 'rose', 'teal']
const UNIT_SYSTEMS: readonly UnitSystem[] = ['m', 'cm', 'ftin']

const DEFAULTS: AppSettings = {
  theme: 'system',
  accent: 'blue',
  units: 'm',
  showDimensions: false,
}

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
      showDimensions:
        typeof r.showDimensions === 'boolean' ? r.showDimensions : DEFAULTS.showDimensions,
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
        showDimensions: s.showDimensions,
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
  setShowDimensions: (show: boolean) => void
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
      setShowDimensions: (showDimensions) => apply({ showDimensions }),
    }
  }),
)
