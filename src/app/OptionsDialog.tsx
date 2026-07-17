import { useUiStore } from '../store/uiStore'
import { Modal } from './Modal'
import {
  ACCENT_IDS,
  DIMENSION_LEVELS,
  THEME_PREFERENCES,
  UI_SCALES,
  useAppSettings,
  type DimensionLevel,
  type ThemePreference,
} from '../store/appSettings'
import { ACCENTS } from '../theme/accents'
import { useThemeStore } from '../theme/themeStore'
import { t } from '../i18n'
import type { UnitSystem } from '../format/units'
import { CURRENCIES } from '../format/units'

/**
 * App options modal — every control applies instantly to useAppSettings.
 * While open, the editor keymap drops all shortcuts (guard in keymap.ts);
 * Escape / focus trapping / restore come from the shared Modal shell.
 */
const THEME_LABELS: Record<ThemePreference, string> = {
  system: t('options.themeSystem'),
  light: t('options.themeLight'),
  dark: t('options.themeDark'),
}

const UNIT_CHOICES: { value: UnitSystem; label: string }[] = [
  { value: 'm', label: t('options.unitM') },
  { value: 'cm', label: t('options.unitCm') },
  { value: 'ftin', label: t('options.unitFtin') },
]

const DIMENSION_LABELS: Record<DimensionLevel, string> = {
  off: t('common.off'),
  walls: t('options.dimsWalls'),
  openings: t('options.dimsOpenings'),
  all: t('options.dimsAll'),
}

/** Shared on/off segmented pair — the Autosave pattern, extracted now
 * that the 3D section needs three more of them. */
function OnOffRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="options-row">
      <span>{label}</span>
      <div className="segmented small">
        <button
          type="button"
          aria-pressed={value}
          className={value ? 'active' : ''}
          onClick={() => onChange(true)}
        >
          {t('common.on')}
        </button>
        <button
          type="button"
          aria-pressed={!value}
          className={!value ? 'active' : ''}
          onClick={() => onChange(false)}
        >
          {t('common.off')}
        </button>
      </div>
    </div>
  )
}

export function OptionsDialog() {
  const open = useUiStore((s) => s.optionsOpen)
  const setOpen = useUiStore((s) => s.setOptionsOpen)
  const settings = useAppSettings()
  // swatches show the resolved-scheme variant (dark accents are lifted)
  const resolved = useThemeStore((s) => s.resolved)

  if (!open) return null
  return (
    <Modal label={t('options.title')} onClose={() => setOpen(false)}>
      <>
        <h3>{t('options.title')}</h3>
        <section className="options-section">
          <h4>{t('options.section.appearance')}</h4>
          <div className="options-row">
            <span>{t('options.theme')}</span>
            <div className="segmented small">
              {THEME_PREFERENCES.map((pref) => (
                <button
                  key={pref}
                  type="button"
                  aria-pressed={settings.theme === pref}
                  className={settings.theme === pref ? 'active' : ''}
                  onClick={() => settings.setTheme(pref)}
                >
                  {THEME_LABELS[pref]}
                </button>
              ))}
            </div>
          </div>
          <div className="options-row">
            <span>{t('options.accent')}</span>
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
          <div className="options-row">
            <span>{t('options.uiScale')}</span>
            <div className="segmented small">
              {UI_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  aria-pressed={settings.uiScale === scale}
                  className={settings.uiScale === scale ? 'active' : ''}
                  onClick={() => settings.setUiScale(scale)}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="options-section">
          <h4>{t('options.section.units')}</h4>
          <div className="options-row">
            <span>{t('options.measurements')}</span>
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
          <div className="options-row">
            <span>{t('options.currency')}</span>
            <div className="segmented small">
              {CURRENCIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={settings.currency === c.id}
                  className={settings.currency === c.id ? 'active' : ''}
                  aria-label={c.id === 'none' ? t('options.currencyNone') : c.id}
                  onClick={() => settings.setCurrency(c.id)}
                >
                  {c.symbol || t('options.currencyNone')}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="options-section">
          <h4>{t('options.section.files')}</h4>
          <OnOffRow
            label={t('options.autosave')}
            value={settings.autosaveEnabled}
            onChange={settings.setAutosaveEnabled}
          />
        </section>
        <section className="options-section">
          <h4>{t('options.section.view')}</h4>
          <div className="options-row">
            <span>{t('options.wheel')}</span>
            <div className="segmented small">
              <button
                type="button"
                aria-pressed={settings.wheelMode === 'zoom'}
                className={settings.wheelMode === 'zoom' ? 'active' : ''}
                onClick={() => settings.setWheelMode('zoom')}
              >
                {t('options.wheelZoom')}
              </button>
              <button
                type="button"
                aria-pressed={settings.wheelMode === 'pan'}
                className={settings.wheelMode === 'pan' ? 'active' : ''}
                onClick={() => settings.setWheelMode('pan')}
              >
                {t('options.wheelPan')}
              </button>
            </div>
          </div>
          <div className="options-row">
            <span>{t('options.showDimensions')}</span>
            <div className="segmented small">
              {DIMENSION_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={settings.dimensionLevel === level}
                  className={settings.dimensionLevel === level ? 'active' : ''}
                  onClick={() => settings.setDimensionLevel(level)}
                >
                  {DIMENSION_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
          <OnOffRow
            label={t('options.showAnnotations')}
            value={settings.showAnnotations}
            onChange={settings.setShowAnnotations}
          />
        </section>
        <section className="options-section">
          <h4>{t('options.section.view3d')}</h4>
          <OnOffRow
            label={t('options.walkCollision')}
            value={settings.collisionEnabled}
            onChange={settings.setCollisionEnabled}
          />
          <OnOffRow
            label={t('options.wallHiding')}
            value={settings.wallHideMode === 'hide'}
            onChange={(on) => settings.setWallHideMode(on ? 'hide' : 'off')}
          />
          <OnOffRow
            label={t('options.ceilings')}
            value={settings.ceilingsEnabled}
            onChange={settings.setCeilingsEnabled}
          />
        </section>
        <div className="modal-buttons">
          <button type="button" className="primary" onClick={() => setOpen(false)}>
            {t('common.close')}
          </button>
        </div>
      </>
    </Modal>
  )
}
