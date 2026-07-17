import { useUiStore } from '../store/uiStore'
import { Modal } from './Modal'
import {
  ACCENT_IDS,
  CITY_PRESETS,
  DIMENSION_LEVELS,
  EXPOSURE_RANGE,
  SEASONS,
  THEME_PREFERENCES,
  UI_SCALES,
  useAppSettings,
  type DimensionLevel,
  type Season,
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

const SEASON_LABELS: Record<Season, string> = {
  equinox: t('options.seasonEquinox'),
  summer: t('options.seasonSummer'),
  winter: t('options.seasonWinter'),
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

/**
 * Range-input row (0.12.0 — the app's first slider). Live drag writes via
 * `onInput` (the caller uses useAppSettings.setState — no localStorage churn
 * per move); `onCommit` fires on release/blur with the final value (the
 * persisting setter — the PanelHandle discipline).
 */
function SliderRow({
  label,
  min,
  max,
  step,
  value,
  format,
  disabled,
  onInput,
  onCommit,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  disabled?: boolean
  onInput: (value: number) => void
  onCommit: (value: number) => void
}) {
  return (
    <div className="options-row">
      <span>{label}</span>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onInput(Number(e.target.value))}
          onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
          onBlur={(e) => onCommit(Number(e.target.value))}
        />
        <span className="slider-value">{format(value)}</span>
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
          <OnOffRow
            label={t('options.levelGhost')}
            value={settings.levelGhostEnabled}
            onChange={settings.setLevelGhostEnabled}
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
        <section className="options-section">
          <h4>{t('options.section.lighting')}</h4>
          <OnOffRow
            label={t('options.realisticLighting')}
            value={settings.realisticLighting}
            onChange={settings.setRealisticLighting}
          />
          <SliderRow
            label={t('options.exposure')}
            min={EXPOSURE_RANGE.min}
            max={EXPOSURE_RANGE.max}
            step={0.05}
            value={settings.exposure}
            format={(v) => `${Math.round(v * 100)}%`}
            disabled={!settings.realisticLighting}
            onInput={(exposure) => useAppSettings.setState({ exposure })}
            onCommit={settings.setExposure}
          />
          <div className="options-row">
            <span>{t('options.city')}</span>
            <div className="segmented small wrap">
              {CITY_PRESETS.map((c) => {
                const active =
                  Math.abs(settings.latitude - c.lat) < 0.005 &&
                  Math.abs(settings.longitude - c.lon) < 0.005
                return (
                  <button
                    key={c.name}
                    type="button"
                    disabled={!settings.realisticLighting}
                    aria-pressed={active}
                    className={active ? 'active' : ''}
                    onClick={() => {
                      settings.setLatitude(c.lat)
                      settings.setLongitude(c.lon)
                    }}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="options-row">
            <span>{t('options.latLong')}</span>
            <div className="coord-inputs">
              <input
                type="number"
                min={-90}
                max={90}
                step={0.01}
                value={settings.latitude}
                disabled={!settings.realisticLighting}
                aria-label={t('options.latLong')}
                onChange={(e) => settings.setLatitude(Number(e.target.value))}
              />
              <input
                type="number"
                min={-180}
                max={180}
                step={0.01}
                value={settings.longitude}
                disabled={!settings.realisticLighting}
                aria-label={t('options.latLong')}
                onChange={(e) => settings.setLongitude(Number(e.target.value))}
              />
            </div>
          </div>
          <SliderRow
            label={t('options.northOffset')}
            min={0}
            max={360}
            step={5}
            value={settings.northOffset}
            format={(v) => `${v}°`}
            disabled={!settings.realisticLighting}
            onInput={(northOffset) => useAppSettings.setState({ northOffset })}
            onCommit={settings.setNorthOffset}
          />
          <div className="options-row">
            <span>{t('options.season')}</span>
            <div className="segmented small">
              {SEASONS.map((season) => (
                <button
                  key={season}
                  type="button"
                  disabled={!settings.realisticLighting}
                  aria-pressed={settings.season === season}
                  className={settings.season === season ? 'active' : ''}
                  onClick={() => settings.setSeason(season)}
                >
                  {SEASON_LABELS[season]}
                </button>
              ))}
            </div>
          </div>
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
