/**
 * PDF paper math (M5, 0.4.0) — PURE: no jsPDF, no DOM, fully unit-testable.
 * All outputs in millimeters. The PDF driver (exportController.exportPdf)
 * only executes what this module computes.
 */
export type PaperSize = 'a4' | 'a3' | 'letter'
export type Orientation = 'portrait' | 'landscape'

/** Portrait dimensions, mm. */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  letter: { w: 215.9, h: 279.4 },
}

export const PAGE_MARGIN_MM = 10
export const TITLE_BLOCK_MM = 16

export interface PaperLayout {
  /** Oriented page size, mm. */
  pageW: number
  pageH: number
  /** Content placement on the page, mm (centered in the printable area). */
  content: { x: number; y: number; w: number; h: number }
  /** mm of paper per meter of plan. */
  mmPerM: number
  /** 1:N — exact for a fixed scale, derived (unrounded) for fit. */
  scaleDenominator: number
  /** False when a FIXED scale overflows the printable area (plan clips). */
  fits: boolean
  /** Bottom strip for name · date · scale, when requested. */
  titleBlock?: { x: number; y: number; w: number; h: number }
}

export interface PaperParams {
  paper: PaperSize
  orientation: Orientation
  /** Plan content size INCLUDING the plan-space margins, meters. */
  contentWM: number
  contentHM: number
  /** Fixed 1:N; absent = fit to the printable area. */
  scaleDenominator?: number
  titleBlock?: boolean
  marginMm?: number
}

export function layoutPaper(p: PaperParams): PaperLayout | null {
  if (p.contentWM <= 0 || p.contentHM <= 0) return null
  const base = PAPER_MM[p.paper]
  const pageW = p.orientation === 'landscape' ? base.h : base.w
  const pageH = p.orientation === 'landscape' ? base.w : base.h
  const margin = p.marginMm ?? PAGE_MARGIN_MM
  const reserve = p.titleBlock ? TITLE_BLOCK_MM : 0
  const printW = pageW - 2 * margin
  const printH = pageH - 2 * margin - reserve
  if (printW <= 0 || printH <= 0) return null

  const fitMmPerM = Math.min(printW / p.contentWM, printH / p.contentHM)
  const mmPerM = p.scaleDenominator ? 1000 / p.scaleDenominator : fitMmPerM
  const fits = mmPerM <= fitMmPerM + 1e-9

  // centered; a non-fitting fixed scale keeps the top-left inside the
  // printable area so at least that corner region prints usefully
  const w = p.contentWM * mmPerM
  const h = p.contentHM * mmPerM
  const x = fits ? margin + (printW - w) / 2 : margin
  const y = fits ? margin + (printH - h) / 2 : margin

  return {
    pageW,
    pageH,
    content: { x, y, w, h },
    mmPerM,
    scaleDenominator: p.scaleDenominator ?? 1000 / fitMmPerM,
    fits,
    ...(p.titleBlock
      ? {
          titleBlock: {
            x: margin,
            y: pageH - margin - TITLE_BLOCK_MM,
            w: printW,
            h: TITLE_BLOCK_MM,
          },
        }
      : {}),
  }
}

/** Human scale label: exact denominators print as 1:100, derived ones as ≈1:87. */
export function scaleLabel(denominator: number): string {
  const rounded = Math.round(denominator)
  const exact = Math.abs(denominator - rounded) < 1e-9
  return exact ? `1:${rounded}` : `≈1:${rounded}`
}
