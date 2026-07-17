import { useMemo, useRef } from 'react'
import { useAppSettings } from '../store/appSettings'
import { DEG, solarNoon, solarPosition } from './sun'
import { MOON_BELOW_DEG } from '../theme/sunRamp'
import { t } from '../i18n'

/**
 * Time-of-day arc (0.12.0) — the in-3D-view scrubber for the sun model.
 * The curve IS the sun's computed altitude over the local day, so season
 * and latitude reshape it (midsummer Helsinki barely dips; midwinter is a
 * low bump); the glyph rides the curve — sun above the horizon line, moon
 * below. Preset dots snap via an ANIMATED time sweep (the 3D light chases
 * the glyph across the sky) driven by the --dur-2 motion token, so
 * reduced-motion users get an instant jump. Dragging writes timeOfDay
 * live through useAppSettings.setState and persists once on release (the
 * PanelHandle discipline); keyboard is role="slider" with ±15 min arrows
 * and Home/End, stopPropagation so keys never reach the editor keymap.
 * PlannerCanvas gates the mount: 3D view + realistic lighting + not
 * walking.
 */

const W = 320
const H = 76
const PAD = 14
const HORIZON_Y = 40
/** Altitude (deg) mapped to the vertical span; beyond clamps to the edge. */
const ALT_MAX = 70
const Y_SPAN = 26

const PRESETS = [
  { label: 'view3d.timeMorning', at: () => 9 },
  { label: 'view3d.timeNoon', at: (lon: number) => solarNoon(lon) },
  { label: 'view3d.timeEvening', at: () => 19 },
  { label: 'view3d.timeNight', at: () => 24 },
] as const

const xForTime = (h: number) => PAD + (h / 24) * (W - 2 * PAD)
const yForAlt = (altDeg: number) =>
  HORIZON_Y - (Math.max(-ALT_MAX, Math.min(ALT_MAX, altDeg)) / ALT_MAX) * Y_SPAN

const fmtTime = (h: number): string => {
  const total = Math.round((((h % 24) + 24) % 24) * 60)
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function SunArc() {
  const latitude = useAppSettings((s) => s.latitude)
  const longitude = useAppSettings((s) => s.longitude)
  const season = useAppSettings((s) => s.season)
  const timeOfDay = useAppSettings((s) => s.timeOfDay)
  const setTimeOfDay = useAppSettings((s) => s.setTimeOfDay)

  const altDegAt = (h: number) => solarPosition(latitude, longitude, season, h).altitude / DEG

  const curve = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= 96; i++) {
      const h = (i / 96) * 24
      pts.push(`${xForTime(h).toFixed(1)},${yForAlt(altDegAt(h)).toFixed(1)}`)
    }
    return `M${pts.join(' L')}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, season])

  const alt = altDegAt(timeOfDay)
  const moon = alt < MOON_BELOW_DEG
  const gx = xForTime(timeOfDay)
  const gy = yForAlt(alt)

  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number } | null>(null)
  const anim = useRef<number | null>(null)

  const timeFromClientX = (clientX: number): number => {
    const r = root.current!.getBoundingClientRect()
    const frac = (clientX - r.left - PAD) / (r.width - 2 * PAD)
    return Math.min(24, Math.max(0, frac * 24))
  }

  const cancelAnim = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current)
    anim.current = null
  }

  /** Preset snap: sweep timeOfDay so the 3D light glides; --dur-2 zeroed
   * under prefers-reduced-motion → instant. */
  const animateTo = (target: number) => {
    cancelAnim()
    const token = getComputedStyle(document.documentElement).getPropertyValue('--dur-2')
    const dur = (parseFloat(token) || 0) * 1.75
    if (dur <= 0) {
      setTimeOfDay(target)
      return
    }
    const from = useAppSettings.getState().timeOfDay
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - k, 3)
      if (k < 1) {
        useAppSettings.setState({ timeOfDay: from + (target - from) * eased })
        anim.current = requestAnimationFrame(step)
      } else {
        anim.current = null
        setTimeOfDay(target)
      }
    }
    anim.current = requestAnimationFrame(step)
  }

  return (
    <div
      ref={root}
      className="sun-arc"
      role="slider"
      tabIndex={0}
      aria-label={t('view3d.timeOfDay')}
      aria-valuemin={0}
      aria-valuemax={24}
      aria-valuenow={Math.round(timeOfDay * 4) / 4}
      aria-valuetext={fmtTime(timeOfDay)}
      onPointerDown={(e) => {
        cancelAnim()
        root.current!.setPointerCapture(e.pointerId)
        drag.current = { pointerId: e.pointerId }
        useAppSettings.setState({ timeOfDay: timeFromClientX(e.clientX) })
      }}
      onPointerMove={(e) => {
        if (drag.current?.pointerId !== e.pointerId) return
        useAppSettings.setState({ timeOfDay: timeFromClientX(e.clientX) })
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointerId !== e.pointerId) return
        drag.current = null
        setTimeOfDay(useAppSettings.getState().timeOfDay)
      }}
      onPointerCancel={(e) => {
        if (drag.current?.pointerId !== e.pointerId) return
        drag.current = null
        setTimeOfDay(useAppSettings.getState().timeOfDay)
      }}
      onKeyDown={(e) => {
        const step =
          e.key === 'ArrowLeft' ? -0.25 : e.key === 'ArrowRight' ? 0.25 : null
        if (step !== null || e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          e.stopPropagation()
          cancelAnim()
          if (e.key === 'Home') setTimeOfDay(0)
          else if (e.key === 'End') setTimeOfDay(24)
          else setTimeOfDay(useAppSettings.getState().timeOfDay + (step ?? 0))
        }
      }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {/* horizon */}
        <line
          x1={PAD - 6}
          y1={HORIZON_Y}
          x2={W - PAD + 6}
          y2={HORIZON_Y}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        {/* the sun's altitude path over the day */}
        <path d={curve} fill="none" stroke="var(--faint)" strokeWidth={1.5} />
        {/* glyph: sun above the horizon, moon below */}
        {moon ? (
          <g transform={`translate(${gx} ${gy})`}>
            <circle r={6} fill="var(--moon-glyph)" />
            <circle r={5} cx={3.4} cy={-2} fill="var(--panel)" />
          </g>
        ) : (
          <g transform={`translate(${gx} ${gy})`}>
            <circle r={5.5} fill="var(--sun-glyph)" />
            {Array.from({ length: 8 }, (_, i) => (
              <line
                key={i}
                x1={0}
                y1={7.5}
                x2={0}
                y2={10}
                transform={`rotate(${i * 45})`}
                stroke="var(--sun-glyph)"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}
      </svg>
      {PRESETS.map((p) => {
        const at = p.at(longitude)
        const active = Math.abs(timeOfDay - at) < 0.26
        return (
          <button
            key={p.label}
            type="button"
            className={`sun-arc-preset${active ? ' active' : ''}`}
            style={{ left: xForTime(at) - 6, top: yForAlt(altDegAt(at)) - 6 }}
            title={t(p.label)}
            aria-label={t(p.label)}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => animateTo(at)}
          />
        )
      })}
      <span className="sun-arc-time">{fmtTime(timeOfDay)}</span>
    </div>
  )
}
