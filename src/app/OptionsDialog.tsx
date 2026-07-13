import { useUiStore } from '../store/uiStore'
import { Modal } from './Modal'
import {
  ACCENT_IDS,
  THEME_PREFERENCES,
  useAppSettings,
  type ThemePreference,
} from '../store/appSettings'
import { ACCENTS } from '../theme/accents'
import { useThemeStore } from '../theme/themeStore'
import type { UnitSystem } from '../format/units'

/**
 * App options modal — every control applies instantly to useAppSettings.
 * While open, the editor keymap drops all shortcuts (guard in keymap.ts);
 * Escape / focus trapping / restore come from the shared Modal shell.
 */
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
  // swatches show the resolved-scheme variant (dark accents are lifted)
  const resolved = useThemeStore((s) => s.resolved)

  if (!open) return null
  return (
    <Modal label="Options" onClose={() => setOpen(false)}>
      <>
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
                  aria-pressed={settings.theme === t}
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
                  title={ACCENTS[a].name}
                  aria-label={ACCENTS[a].name}
                  aria-pressed={settings.accent === a}
                  className={`swatch${settings.accent === a ? ' active' : ''}`}
                  style={{ background: ACCENTS[a][resolved] }}
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
                  aria-pressed={settings.units === u.value}
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
      </>
    </Modal>
  )
}
