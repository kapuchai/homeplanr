import { describe, expect, it } from 'vitest'
import { DEG, solarNoon, solarPosition } from './sun'

/** Helsinki — the default observer (appSettings DEFAULTS). */
const HKI = { lat: 60.17, lon: 24.94 }
const hkiNoon = solarNoon(HKI.lon)

const altDeg = (lat: number, lon: number, season: 'equinox' | 'summer' | 'winter', h: number) =>
  solarPosition(lat, lon, season, h).altitude / DEG
const azDeg = (lat: number, lon: number, season: 'equinox' | 'summer' | 'winter', h: number) =>
  solarPosition(lat, lon, season, h).azimuth / DEG

describe('solarNoon', () => {
  it('is 12:00 on a zone meridian and shifts by longitude within the zone', () => {
    expect(solarNoon(0)).toBe(12)
    expect(solarNoon(15)).toBe(12)
    // Helsinki sits 5.06° west of its zone meridian (30°E) → noon ~12:20
    expect(solarNoon(HKI.lon)).toBeCloseTo(12.337, 3)
    // London is a hair east of Greenwich → noon just before 12:00
    expect(solarNoon(-0.13)).toBeCloseTo(12.009, 3)
  })
})

describe('solarPosition — pinned values', () => {
  it('Helsinki solar-noon altitude per season (90 − φ + δ)', () => {
    expect(altDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon)).toBeCloseTo(90 - 60.17, 2)
    expect(altDeg(HKI.lat, HKI.lon, 'summer', hkiNoon)).toBeCloseTo(90 - 60.17 + 23.44, 2)
    expect(altDeg(HKI.lat, HKI.lon, 'winter', hkiNoon)).toBeCloseTo(90 - 60.17 - 23.44, 2)
  })

  it('solar noon bears due south in the northern hemisphere', () => {
    expect(azDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon)).toBeCloseTo(180, 3)
    expect(azDeg(HKI.lat, HKI.lon, 'winter', hkiNoon)).toBeCloseTo(180, 3)
  })

  it('equinox sunrise/sunset: horizon at noon ± 6h, due east/west', () => {
    // δ=0 ⇒ the sun crosses the horizon exactly at hour angle ±90°
    expect(altDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon - 6)).toBeCloseTo(0, 6)
    expect(altDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon + 6)).toBeCloseTo(0, 6)
    expect(azDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon - 6)).toBeCloseTo(90, 3)
    expect(azDeg(HKI.lat, HKI.lon, 'equinox', hkiNoon + 6)).toBeCloseTo(270, 3)
  })

  it('midnight altitude: Helsinki winter is deep, midsummer barely dips (white nights)', () => {
    const midnight = hkiNoon + 12
    expect(altDeg(HKI.lat, HKI.lon, 'winter', midnight)).toBeCloseTo(60.17 - 23.44 - 90, 2)
    expect(altDeg(HKI.lat, HKI.lon, 'summer', midnight)).toBeCloseTo(60.17 + 23.44 - 90, 2)
    expect(altDeg(HKI.lat, HKI.lon, 'summer', midnight)).toBeGreaterThan(-7)
  })

  it('southern hemisphere: noon sun bears north', () => {
    // Sydney φ = −33.87 — the azimuth convention must not assume north-lat
    expect(azDeg(-33.87, 151.21, 'equinox', solarNoon(151.21))).toBeCloseTo(0, 3)
    expect(altDeg(-33.87, 151.21, 'equinox', solarNoon(151.21))).toBeCloseTo(90 - 33.87, 2)
  })
})

describe('solarPosition — continuity over a day', () => {
  it('altitude moves smoothly; azimuth never jumps (mod 360)', () => {
    let prev = solarPosition(HKI.lat, HKI.lon, 'summer', 0)
    for (let h = 0.1; h <= 24; h += 0.1) {
      const cur = solarPosition(HKI.lat, HKI.lon, 'summer', h)
      expect(Math.abs(cur.altitude - prev.altitude) / DEG).toBeLessThan(3)
      const dAz = Math.abs(cur.azimuth - prev.azimuth) / DEG
      expect(Math.min(dAz, 360 - dAz)).toBeLessThan(6)
      prev = cur
    }
  })
})
