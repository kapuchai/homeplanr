import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { useDocStore } from '../store/docStore'
import { getDerived } from '../store/derived'
import { isTxActive } from '../store/transactions'
import { usePersistStore } from '../store/persistence/controller'
import { useConfirmStore } from '../app/confirmStore'
import { docContentBounds } from '../editor2d/render/bounds'
import { polygonBounds } from '../geometry/polygon'
import {
  EXPORT_MARGIN_M,
  exportPixelSize,
  RASTER_SCALE,
  renderPlanSvg,
  type ExportPlanOptions,
} from './exportPlanSvg'
import { layoutPaper, scaleLabel, type Orientation, type PaperSize } from './paper'

/**
 * Export flow (File menu → ExportDialog): render the plan SVG, then save
 * its bytes directly, rasterize via data-URI → Image → canvas → PNG, or
 * vector-convert onto a jsPDF page (svg2pdf). Uses the same adapter
 * dialogs/messages as the persistence controller and the same isTxActive
 * gate as the keymap file ops.
 */
const sanitizeName = (name: string): string => {
  const clean = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean || 'plan'
}

/** Raster density for fixed-scale PNG exports (print-oriented). */
const SCALED_PNG_DPI = 150
const RASTER_MAX_PX = 4096

async function rasterizePng(svg: string, w: number, h: number): Promise<Uint8Array> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not rasterize the plan.'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = w * RASTER_SCALE
  canvas.height = h * RASTER_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function exportImage(
  format: 'png' | 'svg',
  opts: ExportPlanOptions = {},
): Promise<void> {
  if (isTxActive()) return
  const { adapter } = usePersistStore.getState()
  const doc = useDocStore.getState().doc
  const derived = getDerived(doc)
  const svg = renderPlanSvg(doc, derived, opts)
  if (!svg) {
    await adapter.message('Nothing to export', 'Draw some walls or place furniture first.')
    return
  }
  const name = sanitizeName(doc.name)
  try {
    if (format === 'svg') {
      await adapter.saveBinaryDialog(new TextEncoder().encode(svg), `${name}.svg`, {
        name: 'SVG image',
        extensions: ['svg'],
      })
      return
    }
    // non-null: renderPlanSvg above proved the doc has content bounds
    const bounds = polygonBounds(docContentBounds(doc, derived))!
    const margin = opts.marginM ?? EXPORT_MARGIN_M
    let { w, h } = exportPixelSize(bounds, margin)
    if (opts.scaleDenominator) {
      // fixed scale: SCALED_PNG_DPI over the physical mm size, capped like
      // the fit path (rasterizePng draws at w×RASTER_SCALE)
      const wMm = ((bounds.maxX - bounds.minX + 2 * margin) * 1000) / opts.scaleDenominator
      const hMm = ((bounds.maxY - bounds.minY + 2 * margin) * 1000) / opts.scaleDenominator
      const fw = (wMm / 25.4) * SCALED_PNG_DPI
      const fh = (hMm / 25.4) * SCALED_PNG_DPI
      const cap = Math.min(1, RASTER_MAX_PX / Math.max(fw, fh))
      w = Math.max(1, Math.round((fw * cap) / RASTER_SCALE))
      h = Math.max(1, Math.round((fh * cap) / RASTER_SCALE))
    }
    const bytes = await rasterizePng(svg, w, h)
    await adapter.saveBinaryDialog(bytes, `${name}.png`, {
      name: 'PNG image',
      extensions: ['png'],
    })
  } catch (err) {
    await adapter.message('Export failed', String(err))
  }
}

export interface ExportPdfOptions extends ExportPlanOptions {
  paper: PaperSize
  orientation: Orientation
  titleBlock?: boolean
}

/**
 * True-vector PDF: renderPlanSvg → svg2pdf onto a jsPDF page laid out by
 * the pure paper module. jsPDF's standard fonts are WinAnsi-only — Latin
 * text (and m²) is fine; non-Latin project names come out garbled in the
 * title block (documented limitation, embedded fonts are a later feature).
 */
export async function exportPdf(opts: ExportPdfOptions): Promise<void> {
  if (isTxActive()) return
  const { adapter } = usePersistStore.getState()
  const doc = useDocStore.getState().doc
  const derived = getDerived(doc)
  const svg = renderPlanSvg(doc, derived, opts)
  if (!svg) {
    await adapter.message('Nothing to export', 'Draw some walls or place furniture first.')
    return
  }
  const name = sanitizeName(doc.name)
  try {
    const bounds = polygonBounds(docContentBounds(doc, derived))!
    const margin = opts.marginM ?? EXPORT_MARGIN_M
    const params = {
      paper: opts.paper,
      orientation: opts.orientation,
      contentWM: bounds.maxX - bounds.minX + 2 * margin,
      contentHM: bounds.maxY - bounds.minY + 2 * margin,
      ...(opts.titleBlock ? { titleBlock: true as const } : {}),
    }
    let layout = layoutPaper({
      ...params,
      ...(opts.scaleDenominator ? { scaleDenominator: opts.scaleDenominator } : {}),
    })
    if (!layout) throw new Error('Empty page layout.')

    // a fixed scale can overflow the page — never clip silently
    if (!layout.fits) {
      const fitLayout = layoutPaper(params)!
      const choice = await useConfirmStore
        .getState()
        .prompt(
          'Plan does not fit the page',
          `At ${scaleLabel(layout.scaleDenominator)} the plan overflows ${opts.paper.toUpperCase()} — ` +
            'only the top-left region would print.',
          [
            { value: 'fit', label: `Fit to page (${scaleLabel(fitLayout.scaleDenominator)})` },
            { value: 'clip', label: 'Export clipped' },
            { value: 'cancel', label: 'Cancel' },
          ],
          { escValue: 'cancel' },
        )
      if (choice === 'cancel') return
      if (choice === 'fit') layout = fitLayout
    }

    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    const pdf = new jsPDF({
      unit: 'mm',
      format: opts.paper,
      orientation: layout.pageW > layout.pageH ? 'landscape' : 'portrait',
    })
    await pdf.svg(el, layout.content)

    if (layout.titleBlock) {
      const tb = layout.titleBlock
      const date = new Date().toISOString().slice(0, 10)
      pdf.setDrawColor(60)
      pdf.setLineWidth(0.2)
      pdf.rect(tb.x, tb.y, tb.w, tb.h)
      pdf.setFontSize(11)
      pdf.setTextColor(20)
      pdf.text(doc.name, tb.x + 4, tb.y + tb.h / 2 + 1.5)
      pdf.setFontSize(9)
      pdf.setTextColor(90)
      pdf.text(`${date}   ·   ${scaleLabel(layout.scaleDenominator)}`, tb.x + tb.w - 4, tb.y + tb.h / 2 + 1.5, {
        align: 'right',
      })
    }

    const bytes = new Uint8Array(pdf.output('arraybuffer'))
    await adapter.saveBinaryDialog(bytes, `${name}.pdf`, {
      name: 'PDF document',
      extensions: ['pdf'],
    })
  } catch (err) {
    await adapter.message('Export failed', String(err))
  }
}
