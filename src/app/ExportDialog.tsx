import { useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { Modal } from './Modal'
import { exportImage, exportPdf } from '../export/exportController'
import type { Orientation, PaperSize } from '../export/paper'
import { EXPORT_MARGIN_M } from '../export/exportPlanSvg'

/**
 * Export options modal (M5, 0.4.0) — format, scale preset, grid, margin,
 * and (PDF) paper/orientation/title block. Choices are session-local
 * (reopening starts from the defaults on purpose: exports are occasional
 * and "what did I leave selected last month" surprises print jobs).
 * Escape / focus trapping / restore come from the shared Modal shell.
 */
type Format = 'png' | 'svg' | 'pdf'
type ScaleChoice = 'fit' | 50 | 100 | 200

const FORMATS: { value: Format; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
]

const SCALES: { value: ScaleChoice; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: 50, label: '1:50' },
  { value: 100, label: '1:100' },
  { value: 200, label: '1:200' },
]

const PAPERS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'letter', label: 'Letter' },
]

export function ExportDialog() {
  // gate OUTSIDE the stateful component: returning null would keep the
  // fiber (and its useState) alive — unmounting is what resets the choices
  // to the defaults on every open
  const open = useUiStore((s) => s.exportOpen)
  return open ? <ExportDialogInner /> : null
}

function ExportDialogInner() {
  const setOpen = useUiStore((s) => s.setExportOpen)
  const [format, setFormat] = useState<Format>('png')
  const [scale, setScale] = useState<ScaleChoice>('fit')
  const [includeGrid, setIncludeGrid] = useState(false)
  const [marginText, setMarginText] = useState(String(EXPORT_MARGIN_M))
  const [paper, setPaper] = useState<PaperSize>('a4')
  const [orientation, setOrientation] = useState<Orientation>('landscape')
  const [titleBlock, setTitleBlock] = useState(true)

  const parsedMargin = Number(marginText.replace(',', '.'))
  const marginM = Number.isFinite(parsedMargin) ? Math.min(5, Math.max(0, parsedMargin)) : EXPORT_MARGIN_M

  const run = () => {
    setOpen(false) // close first — the native save dialog takes over
    const base = {
      includeGrid,
      marginM,
      ...(scale !== 'fit' ? { scaleDenominator: scale } : {}),
    }
    if (format === 'pdf') {
      void exportPdf({ ...base, paper, orientation, titleBlock })
    } else {
      void exportImage(format, base)
    }
  }

  const seg = <T,>(
    choices: { value: T; label: string }[],
    current: T,
    onPick: (v: T) => void,
  ) => (
    <div className="segmented small">
      {choices.map((c) => (
        <button
          key={String(c.value)}
          type="button"
          aria-pressed={current === c.value}
          className={current === c.value ? 'active' : ''}
          onClick={() => onPick(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )

  return (
    <Modal label="Export plan" onClose={() => setOpen(false)}>
      <>
        <h3>Export plan</h3>
        <section className="options-section">
          <div className="options-row">
            <span>Format</span>
            {seg(FORMATS, format, setFormat)}
          </div>
          <div className="options-row">
            <span>Scale</span>
            {seg(SCALES, scale, setScale)}
          </div>
          <div className="options-row">
            <span>Grid</span>
            {seg(
              [
                { value: true, label: 'On' },
                { value: false, label: 'Off' },
              ],
              includeGrid,
              setIncludeGrid,
            )}
          </div>
          <div className="options-row">
            <span>Margin (m)</span>
            <input
              type="number"
              className="export-margin"
              min={0}
              max={5}
              step={0.1}
              value={marginText}
              aria-label="Margin in meters"
              onChange={(e) => setMarginText(e.target.value)}
            />
          </div>
        </section>
        {format === 'pdf' && (
          <section className="options-section">
            <h4>Paper</h4>
            <div className="options-row">
              <span>Size</span>
              {seg(PAPERS, paper, setPaper)}
            </div>
            <div className="options-row">
              <span>Orientation</span>
              {seg(
                [
                  { value: 'landscape' as Orientation, label: 'Landscape' },
                  { value: 'portrait' as Orientation, label: 'Portrait' },
                ],
                orientation,
                setOrientation,
              )}
            </div>
            <div className="options-row">
              <span>Title block</span>
              {seg(
                [
                  { value: true, label: 'On' },
                  { value: false, label: 'Off' },
                ],
                titleBlock,
                setTitleBlock,
              )}
            </div>
          </section>
        )}
        <div className="modal-buttons">
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={run}>
            Export…
          </button>
        </div>
      </>
    </Modal>
  )
}
