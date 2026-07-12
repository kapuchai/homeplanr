import { useDocStore } from '../store/docStore'
import { getDerived } from '../store/derived'
import { isTxActive } from '../store/transactions'
import { usePersistStore } from '../store/persistence/controller'
import { docContentBounds } from '../editor2d/render/bounds'
import { polygonBounds } from '../geometry/polygon'
import {
  EXPORT_MARGIN_M,
  exportPixelSize,
  RASTER_SCALE,
  renderPlanSvg,
} from './exportPlanSvg'

/**
 * Export flow (File menu): render the plan SVG, then either save its bytes
 * directly or rasterize via data-URI → Image → canvas → PNG. Uses the same
 * adapter dialogs/messages as the persistence controller and the same
 * isTxActive gate as the keymap file ops.
 */
const sanitizeName = (name: string): string => {
  const clean = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean || 'plan'
}

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

export async function exportImage(format: 'png' | 'svg'): Promise<void> {
  if (isTxActive()) return
  const { adapter } = usePersistStore.getState()
  const doc = useDocStore.getState().doc
  const derived = getDerived(doc)
  const svg = renderPlanSvg(doc, derived)
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
    const { w, h } = exportPixelSize(bounds, EXPORT_MARGIN_M)
    const bytes = await rasterizePng(svg, w, h)
    await adapter.saveBinaryDialog(bytes, `${name}.png`, {
      name: 'PNG image',
      extensions: ['png'],
    })
  } catch (err) {
    await adapter.message('Export failed', String(err))
  }
}
