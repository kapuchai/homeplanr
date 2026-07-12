import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'
import {
  ACCENT_IDS,
  THEME_PREFERENCES,
  useAppSettings,
  type AccentId,
  type ThemePreference,
} from '../store/appSettings'
import type { UnitSystem } from '../format/units'

/**
 * App options modal — every control applies instantly to useAppSettings.
 * While open, the editor keymap drops all shortcuts (guard in keymap.ts);
 * Escape is handled by this dialog's own listener.
 */
const ACCENT_COLORS: Record<AccentId, string> = {
  blue: '#2563EB',
  violet: '#7C3AED',
  green: '#059669',
  amber: '#D97706',
  rose: '#E11D48',
  teal: '#0D9488',
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

const UNIT_CHOICES: { value: UnitSystem; label: string }[] = [
  { value: 'm', label: 'm' },
  { value: 'cm', label: 'cm' },
  { value: 'ftin', label: 'ft-in' },
]

export function OptionsDialog() {
  const open = useUiStore((s) => s.optionsOpen)
  const setOpen = useUiStore((s) => s.setOptionsOpen)
  const settings = useAppSettings()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // document fires before the keymap's window listener — without this the
      // same Escape would fall through to the Esc ladder once the guard clears
      e.stopPropagation()
      useUiStore.getState().setOptionsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Options">
        <h3>Options</h3>
        <section className="options-section">
          <h4>Appearance</h4>
          <div className="options-row">
            <span>Theme</span>
            <div className="segmented small">
              {THEME_PREFERENCES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={settings.theme === t ? 'active' : ''}
                  onClick={() => settings.setTheme(t)}
                >
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="options-row">
            <span>Accent</span>
            <div className="swatches">
              {ACCENT_IDS.map((a) => (
                <button
                  key={a}
                  type="button"
                  title={a}
                  className={`swatch${settings.accent === a ? ' active' : ''}`}
                  style={{ background: ACCENT_COLORS[a] }}
                  onClick={() => settings.setAccent(a)}
                />
              ))}
            </div>
          </div>
        </section>
        <section className="options-section">
          <h4>Units</h4>
          <div className="options-row">
            <span>Measurements</span>
            <div className="segmented small">
              {UNIT_CHOICES.map((u) => (
                <button
                  key={u.value}
                  type="button"
                  className={settings.units === u.value ? 'active' : ''}
                  onClick={() => settings.setUnits(u.value)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="options-section">
          <h4>View</h4>
          <div className="options-row">
            <span>Show dimensions</span>
            <div className="segmented small">
              <button
                type="button"
                className={settings.showDimensions ? 'active' : ''}
                onClick={() => settings.setShowDimensions(true)}
              >
                On
              </button>
              <button
                type="button"
                className={!settings.showDimensions ? 'active' : ''}
                onClick={() => settings.setShowDimensions(false)}
              >
                Off
              </button>
            </div>
          </div>
        </section>
        <div className="modal-buttons">
          <button type="button" className="primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
