import { describe, expect, it } from 'vitest'
import { MOON_BELOW_DEG, lightingRamp } from './sunRamp'

const RAD = Math.PI / 180
const HEX = /^#[0-9a-f]{6}$/

describe('lightingRamp', () => {
  it('high sun: strong shadowed sun over LOW unshadowed fill (walls must matter)', () => {
    const r = lightingRamp(35 * RAD)
    expect(r.sunIntensity).toBeCloseTo(2.2, 5)
    expect(r.hemiIntensity).toBeCloseTo(0.34, 5)
    expect(r.ambient).toBeCloseTo(0.06, 5)
    expect(r.env).toBeCloseTo(0.26, 5)
    expect(r.moon).toBe(false)
    // the contrast contract: unshadowed fill stays well under half the sun
    expect(r.hemiIntensity + r.ambient + r.env).toBeLessThan(r.sunIntensity / 2)
  })

  it('night hands the directional to the moon; day keeps the sun', () => {
    expect(lightingRamp(-18 * RAD).moon).toBe(true)
    expect(lightingRamp((MOON_BELOW_DEG - 0.1) * RAD).moon).toBe(true)
    expect(lightingRamp((MOON_BELOW_DEG + 0.1) * RAD).moon).toBe(false)
    expect(lightingRamp(10 * RAD).moon).toBe(false)
  })

  it('the horizon crossfade dips the directional near zero around the moon swap', () => {
    // the 180° bearing flip at MOON_BELOW_DEG must never pop visibly
    expect(lightingRamp(MOON_BELOW_DEG * RAD).sunIntensity).toBeLessThan(0.08)
  })

  it('every channel stays bounded and every color is valid across the full sweep', () => {
    for (let d = -90; d <= 90; d += 0.5) {
      const r = lightingRamp(d * RAD)
      expect(r.sunIntensity).toBeGreaterThanOrEqual(0)
      expect(r.sunIntensity).toBeLessThanOrEqual(2.5)
      expect(r.hemiIntensity).toBeGreaterThanOrEqual(0)
      expect(r.hemiIntensity).toBeLessThanOrEqual(1)
      expect(r.ambient).toBeGreaterThanOrEqual(0)
      expect(r.ambient).toBeLessThanOrEqual(0.5)
      expect(r.env).toBeGreaterThanOrEqual(0)
      expect(r.env).toBeLessThanOrEqual(0.26 + 1e-9)
      expect(r.sky).toMatch(HEX)
      expect(r.sunColor).toMatch(HEX)
      expect(r.hemiSky).toMatch(HEX)
      expect(r.hemiGround).toMatch(HEX)
    }
  })

  it('is continuous: adjacent samples never jump', () => {
    let prev = lightingRamp(-90 * RAD)
    for (let d = -89.75; d <= 90; d += 0.25) {
      const cur = lightingRamp(d * RAD)
      // steepest segment by design: sunrise (−2°→0°) climbs 0.53 over 2°
      expect(Math.abs(cur.sunIntensity - prev.sunIntensity)).toBeLessThan(0.08)
      expect(Math.abs(cur.hemiIntensity - prev.hemiIntensity)).toBeLessThan(0.02)
      expect(Math.abs(cur.env - prev.env)).toBeLessThan(0.02)
      prev = cur
    }
  })

  it('clamps out-of-range altitudes instead of extrapolating', () => {
    expect(lightingRamp(200 * RAD)).toEqual(lightingRamp(90 * RAD))
    expect(lightingRamp(-200 * RAD)).toEqual(lightingRamp(-90 * RAD))
  })
})
