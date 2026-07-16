import { describe, expect, it } from 'vitest'
import { ACCENTS } from './accents'
import { ACCENT_IDS } from '../store/appSettings'
import { contrastRatio as ratio } from '../test/contrast'

/**
 * WCAG 2.x AA pin (0.3.0 M7): the text painted ON every accent fill must
 * reach 4.5:1 in BOTH schemes. This turned a visual-audit finding (white on
 * amber ≈ 2.1:1 in dark mode) into a permanent gate — new accents or
 * tweaked shades fail here before they fail users' eyes.
 */

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
