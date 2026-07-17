/**
 * Altitude-keyed lighting ramp (0.12.0) — every scene channel (sun/moon
 * color+intensity, hemisphere, ambient, IBL intensity, sky/fog color) as a
 * pure piecewise-linear function of solar altitude. Animating time animates
 * light with no special-casing. Lives in src/theme: the stops are raw
 * colors (lint:colors) and this IS the 3D sky palette. Deliberately
 * theme-INDEPENDENT — realistic lighting renders the same sky in light and
 * dark UI themes (the sky is the sky).
 *
 * The high-sun stop reproduces the classic scene's values (dir 1.6, hemi
 * 0.5, ambient 0.1, env 0.45) so toggling realistic lighting on around
 * noon lands near the familiar look.
 *
 * Below MOON_BELOW_DEG the directional light PLAYS THE MOON: the driver
 * mirrors its bearing and the ramp's sun channels carry moonlight. The
 * crossfade zone around the horizon dips intensity near zero so the 180°
 * position flip never pops.
 */
export interface LightingRamp {
  /** Directional light — the sun, or the moon when `moon` is true. */
  sunColor: string
  sunIntensity: number
  moon: boolean
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  ambient: number
  /** scene.environmentIntensity (classic scene pins 0.45). */
  env: number
  /** scene.background AND fog color. */
  sky: string
}

/** Below this solar altitude (deg) the directional flips to moonlight. */
export const MOON_BELOW_DEG = -3

interface Stop {
  alt: number
  sky: string
  sun: string
  sunI: number
  hemiSky: string
  hemiGround: string
  hemiI: number
  amb: number
  env: number
}

// altitudes ascending; night → dusk → horizon → golden hour → day
const STOPS: Stop[] = [
  { alt: -90, sky: '#0f131d', sun: '#a8bede', sunI: 0.14, hemiSky: '#1c2436', hemiGround: '#0d0d12', hemiI: 0.14, amb: 0.05, env: 0.06 },
  { alt: -18, sky: '#10141f', sun: '#a8bede', sunI: 0.14, hemiSky: '#1c2438', hemiGround: '#0d0d12', hemiI: 0.14, amb: 0.05, env: 0.06 },
  { alt: -6, sky: '#232a40', sun: '#a8bede', sunI: 0.1, hemiSky: '#232c44', hemiGround: '#101014', hemiI: 0.16, amb: 0.06, env: 0.1 },
  { alt: -2, sky: '#584f6a', sun: '#c8b8a8', sunI: 0.02, hemiSky: '#3a3c54', hemiGround: '#16161c', hemiI: 0.2, amb: 0.07, env: 0.16 },
  { alt: 0, sky: '#d99a66', sun: '#ff9848', sunI: 0.55, hemiSky: '#6a6884', hemiGround: '#201e24', hemiI: 0.26, amb: 0.08, env: 0.2 },
  { alt: 6, sky: '#e8b784', sun: '#ffc078', sunI: 1.05, hemiSky: '#98a0b8', hemiGround: '#3a3630', hemiI: 0.34, amb: 0.09, env: 0.3 },
  { alt: 15, sky: '#c2d0e4', sun: '#ffe2b0', sunI: 1.4, hemiSky: '#b8c4d8', hemiGround: '#4a443c', hemiI: 0.42, amb: 0.1, env: 0.4 },
  { alt: 35, sky: '#b4cfec', sun: '#fff0d8', sunI: 1.6, hemiSky: '#cddaf0', hemiGround: '#55504a', hemiI: 0.5, amb: 0.1, env: 0.45 },
  { alt: 90, sky: '#aecdf0', sun: '#fff6e8', sunI: 1.65, hemiSky: '#d6e2f4', hemiGround: '#5a554e', hemiI: 0.5, amb: 0.1, env: 0.45 },
]

const RAD = Math.PI / 180

const hexChannel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)

const lerpHex = (a: string, b: string, t: number): string => {
  let out = '#'
  for (let i = 0; i < 3; i++) {
    const v = Math.round(hexChannel(a, i) + (hexChannel(b, i) - hexChannel(a, i)) * t)
    out += v.toString(16).padStart(2, '0')
  }
  return out
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function lightingRamp(altitudeRad: number): LightingRamp {
  const alt = Math.min(90, Math.max(-90, altitudeRad / RAD))
  let hi = STOPS.length - 1
  while (hi > 0 && STOPS[hi - 1]!.alt > alt) hi--
  while (hi < STOPS.length - 1 && STOPS[hi]!.alt < alt) hi++
  const b = STOPS[hi]!
  const a = STOPS[Math.max(0, hi - 1)]!
  const t = b.alt === a.alt ? 0 : Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)))
  return {
    sunColor: lerpHex(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunI, b.sunI, t),
    moon: alt < MOON_BELOW_DEG,
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, t),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiI, b.hemiI, t),
    ambient: lerp(a.amb, b.amb, t),
    env: lerp(a.env, b.env, t),
    sky: lerpHex(a.sky, b.sky, t),
  }
}
