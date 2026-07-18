import { useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { useActiveLevel } from '../store/activeLevel'
import { resolveLevel } from '../store/levelView'
import { levelDisplayName } from './levelName'
import type { LevelId } from '../model/ids'
import { Modal } from './Modal'
import { exportImage, exportPdf } from '../export/exportController'
import type { Orientation, PaperSize } from '../export/paper'
import { EXPORT_MARGIN_M } from '../export/exportPlanSvg'
import { t } from '../i18n'

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
  { value: 'fit', label: t('export.scaleFit') },
  { value: 50, label: t('export.scale50') },
  { value: 100, label: t('export.scale100') },
  { value: 200, label: t('export.scale200') },
]

const PAPERS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: t('export.paperA4') },
  { value: 'a3', label: t('export.paperA3') },
  { value: 'letter', label: t('export.paperLetter') },
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
  const levels = useDocStore((s) => s.doc.levels)
  const activeLevelId = useActiveLevel((s) => s.activeLevelId)
  const fullDoc = useDocStore.getState().doc
  const [levelId, setLevelId] = useState<LevelId>(
    () => resolveLevel(fullDoc, activeLevelId).id,
  )
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
      levelId,
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
    <Modal label={t('export.title')} onClose={() => setOpen(false)}>
      <>
        <h3>{t('export.title')}</h3>
        <section className="options-section">
          {levels.length > 1 && (
            <div className="options-row">
              <span>{t('export.floor')}</span>
              {seg(
                levels.map((l, i) => ({ value: l.id, label: levelDisplayName(l, i) })),
                levelId,
                setLevelId,
              )}
            </div>
          )}
          <div className="options-row">
            <span>{t('export.format')}</span>
            {seg(FORMATS, format, setFormat)}
          </div>
          <div className="options-row">
            <span>{t('export.scale')}</span>
            {seg(SCALES, scale, setScale)}
          </div>
          <div className="options-row">
            <span>{t('export.grid')}</span>
            {seg(
              [
                { value: true, label: t('common.on') },
                { value: false, label: t('common.off') },
              ],
              includeGrid,
              setIncludeGrid,
            )}
          </div>
          <div className="options-row">
            <span>{t('export.margin')}</span>
            <input
              type="number"
              className="export-margin"
              min={0}
              max={5}
              step={0.1}
              value={marginText}
              aria-label={t('export.marginAria')}
              onChange={(e) => setMarginText(e.target.value)}
            />
          </div>
        </section>
        {format === 'pdf' && (
          <section className="options-section">
            <h4>{t('export.section.paper')}</h4>
            <div className="options-row">
              <span>{t('export.size')}</span>
              {seg(PAPERS, paper, setPaper)}
            </div>
            <div className="options-row">
              <span>{t('export.orientation')}</span>
              {seg(
                [
                  { value: 'landscape' as Orientation, label: t('export.landscape') },
                  { value: 'portrait' as Orientation, label: t('export.portrait') },
                ],
                orientation,
                setOrientation,
              )}
            </div>
            <div className="options-row">
              <span>{t('export.titleBlock')}</span>
              {seg(
                [
                  { value: true, label: t('common.on') },
                  { value: false, label: t('common.off') },
                ],
                titleBlock,
                setTitleBlock,
              )}
            </div>
          </section>
        )}
        <div className="modal-buttons">
          <button type="button" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={run}>
            {t('export.run')}
          </button>
        </div>
      </>
    </Modal>
  )
}
