import { describe, expect, it } from 'vitest'
import {
  layoutPaper,
  PAGE_MARGIN_MM,
  PAPER_MM,
  scaleLabel,
  TITLE_BLOCK_MM,
} from './paper'

describe('layoutPaper (M5, 0.4.0) — pure paper math', () => {
  it('orientation swaps the page; content centers in the printable area', () => {
    // 5m × 3m content at 1:50 → 100mm × 60mm
    const l = layoutPaper({
      paper: 'a4',
      orientation: 'landscape',
      contentWM: 5,
      contentHM: 3,
      scaleDenominator: 50,
    })!
    expect(l.pageW).toBe(297)
    expect(l.pageH).toBe(210)
    expect(l.content.w).toBeCloseTo(100, 9)
    expect(l.content.h).toBeCloseTo(60, 9)
    expect(l.fits).toBe(true)
    // centered: equal spare on both sides of the printable area
    expect(l.content.x).toBeCloseTo(PAGE_MARGIN_MM + (297 - 2 * PAGE_MARGIN_MM - 100) / 2, 9)
    expect(l.content.y).toBeCloseTo(PAGE_MARGIN_MM + (210 - 2 * PAGE_MARGIN_MM - 60) / 2, 9)
  })

  it('fit scale fills the tighter axis exactly and reports the derived denominator', () => {
    const l = layoutPaper({ paper: 'a4', orientation: 'portrait', contentWM: 10, contentHM: 5 })!
    const printW = 210 - 2 * PAGE_MARGIN_MM
    expect(l.mmPerM).toBeCloseTo(printW / 10, 9) // width-limited
    expect(l.content.w).toBeCloseTo(printW, 9)
    expect(l.scaleDenominator).toBeCloseTo(1000 / l.mmPerM, 9)
    expect(l.fits).toBe(true)
  })

  it('a fixed scale too large for the page reports fits=false and anchors top-left', () => {
    // 20m at 1:50 = 400mm > any A4 side
    const l = layoutPaper({
      paper: 'a4',
      orientation: 'landscape',
      contentWM: 20,
      contentHM: 15,
      scaleDenominator: 50,
    })!
    expect(l.fits).toBe(false)
    expect(l.content.x).toBe(PAGE_MARGIN_MM)
    expect(l.content.y).toBe(PAGE_MARGIN_MM)
  })

  it('the title block reserves its strip from the printable height and sits at the bottom', () => {
    // height-limited content so the reserved strip actually shrinks the fit
    const withTb = layoutPaper({
      paper: 'a3',
      orientation: 'portrait',
      contentWM: 6,
      contentHM: 12,
      titleBlock: true,
    })!
    const without = layoutPaper({
      paper: 'a3',
      orientation: 'portrait',
      contentWM: 6,
      contentHM: 12,
    })!
    expect(withTb.mmPerM).toBeLessThan(without.mmPerM) // less room → smaller fit
    expect(withTb.titleBlock).toEqual({
      x: PAGE_MARGIN_MM,
      y: PAPER_MM.a3.h - PAGE_MARGIN_MM - TITLE_BLOCK_MM,
      w: PAPER_MM.a3.w - 2 * PAGE_MARGIN_MM,
      h: TITLE_BLOCK_MM,
    })
    expect(without.titleBlock).toBeUndefined()
  })

  it('degenerate inputs return null', () => {
    expect(
      layoutPaper({ paper: 'a4', orientation: 'portrait', contentWM: 0, contentHM: 3 }),
    ).toBeNull()
    expect(
      layoutPaper({
        paper: 'a4',
        orientation: 'portrait',
        contentWM: 3,
        contentHM: 3,
        marginMm: 200, // margins eat the whole page
      }),
    ).toBeNull()
  })

  it('letter is supported with its real dimensions', () => {
    const l = layoutPaper({ paper: 'letter', orientation: 'portrait', contentWM: 4, contentHM: 3 })!
    expect(l.pageW).toBeCloseTo(215.9, 9)
    expect(l.pageH).toBeCloseTo(279.4, 9)
  })

  it('scaleLabel: exact vs derived', () => {
    expect(scaleLabel(100)).toBe('1:100')
    expect(scaleLabel(86.8)).toBe('≈1:87')
  })
})
