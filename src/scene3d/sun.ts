import type { Season } from '../store/appSettings'

/**
 * Solar position (0.12.0) — pure spherical astronomy, no three.js. The
 * simplifications are deliberate and documented:
 * - Declination comes from the SEASON preset (equinox 0°, solstices
 *   ±23.44°) — the user chose season presets over a date picker.
 * - The hour angle uses local clock time with an integer-hour timezone
 *   derived from longitude (no DST, no equation of time) — solar noon
 *   lands within ±½h of reality, which is architectural-preview accuracy.
 * Azimuth: 0 = north, clockwise (90 = east, 180 = south); altitude: 0 =
 * horizon, positive up. Both radians.
 */
export interface SunPosition {
  azimuth: number
  altitude: number
}

/** Degrees → radians. */
export const DEG = Math.PI / 180

export const SEASON_DECLINATION_DEG: Record<Season, number> = {
  equinox: 0,
  summer: 23.44,
  winter: -23.44,
}

/** Local clock hour of solar noon for a longitude (integer-hour zone). */
export function solarNoon(lonDeg: number): number {
  const zoneMeridian = Math.round(lonDeg / 15) * 15
  return 12 - (lonDeg - zoneMeridian) / 15
}

export function solarPosition(
  latDeg: number,
  lonDeg: number,
  season: Season,
  hours: number,
): SunPosition {
  const phi = latDeg * DEG
  const delta = SEASON_DECLINATION_DEG[season] * DEG
  // hour angle: 0 at solar noon, +15°/h into the afternoon
  const h = (hours - solarNoon(lonDeg)) * 15 * DEG
  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(h),
  )
  // azimuth measured from SOUTH (+ = west), then shifted to the 0=north
  // clockwise convention; atan2 keeps every quadrant honest
  const azSouth = Math.atan2(
    Math.sin(h),
    Math.cos(h) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi),
  )
  const azimuth = (azSouth + Math.PI + 2 * Math.PI) % (2 * Math.PI)
  return { azimuth, altitude }
}
