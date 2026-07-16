import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { usePersistStore } from '../store/persistence/controller'
import { t } from '../i18n'

/** Bottom-left status line: contextual tips per tool/selection state. */
export function StatusHint() {
  const tool = useUiStore((s) => s.activeTool)
  const selection = useUiStore((s) => s.selection)
  const openingKind = useUiStore((s) => s.toolParams.openingKind)
  const empty = useDocStore(
    (s) => Object.keys(s.doc.walls).length === 0 && Object.keys(s.doc.furniture).length === 0,
  )
  const lastSavedAt = usePersistStore((s) => s.lastSavedAt)
  const lastSaveWasAuto = usePersistStore((s) => s.lastSaveWasAuto)
  const autosaveError = usePersistStore((s) => s.autosaveError)

  // transient save confirmation for EXPLICIT saves only (success used to be
  // silent) — autosaves stay quiet so the tool hints aren't supplanted once
  // per editing pause (the File menu's last-saved entry covers them)
  const [savedFlash, setSavedFlash] = useState(false)
  useEffect(() => {
    if (lastSavedAt === null || lastSaveWasAuto) return
    setSavedFlash(true)
    const t = setTimeout(() => setSavedFlash(false), 2500)
    return () => clearTimeout(t)
  }, [lastSavedAt, lastSaveWasAuto])

  if (autosaveError) {
    return <div className="status-hint">{t('status.autosaveFailed')}</div>
  }
  if (savedFlash && lastSavedAt !== null) {
    return (
      <div className="status-hint">
        {t('status.saved', {
          time: new Date(lastSavedAt).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </div>
    )
  }

  let text: string
  if (tool === 'draw-wall') {
    text = t('hint.drawWall')
  } else if (tool === 'place-opening') {
    text = t('hint.placeOpening', { kind: openingKind })
  } else if (tool === 'place-furniture') {
    text = t('hint.placeFurniture')
  } else if (tool === 'measure') {
    text = t('hint.measure')
  } else if (tool === 'annotate-text') {
    text = t('hint.annotateText')
  } else if (selection.length > 1) {
    text = t('hint.multiSelect', { count: selection.length })
  } else if (selection.length === 1) {
    text = t('hint.singleSelect')
  } else if (empty) {
    text = t('hint.empty')
  } else {
    text = t('hint.idle')
  }

  return <div className="status-hint">{text}</div>
}

/** Centered first-run hint over the empty canvas. */
export function EmptyState() {
  const empty = useDocStore(
    (s) => Object.keys(s.doc.walls).length === 0 && Object.keys(s.doc.furniture).length === 0,
  )
  if (!empty) return null
  return (
    <div className="empty-state" aria-hidden>
      <div>
        <strong>{t('status.emptyTitle')}</strong>
        <p>
          {t('status.emptyBodyBefore')} <kbd>W</kbd>{t('status.emptyBodyAfter')}
        </p>
      </div>
    </div>
  )
}
