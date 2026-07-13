import { describe, expect, it } from 'vitest'
import { ACCENTS } from './accents'
import { ACCENT_IDS } from '../store/appSettings'

/**
 * WCAG 2.x AA pin (0.3.0 M7): the text painted ON every accent fill must
 * reach 4.5:1 in BOTH schemes. This turned a visual-audit finding (white on
 * amber ≈ 2.1:1 in dark mode) into a permanent gate — new accents or
 * tweaked shades fail here before they fail users' eyes.
 */
const channel = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const luminance = (hex: string): number => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  )
}

const ratio = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('accent contrast (WCAG AA, both schemes)', () => {
  for (const id of ACCENT_IDS) {
    const a = ACCENTS[id]
    it(`${id}: contrast ink ≥ 4.5:1 on the light and dark accent fills`, () => {
      expect(ratio(a.light, a.contrastLight)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(a.dark, a.contrastDark)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('documents WHY per-accent inks exist: white fails on several fills', () => {
    expect(ratio(ACCENTS.amber.dark, '#ffffff')).toBeLessThan(4.5)
    expect(ratio(ACCENTS.green.light, '#ffffff')).toBeLessThan(4.5)
    expect(ratio(ACCENTS.teal.light, '#ffffff')).toBeLessThan(4.5)
  })
})
