import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { usePersistStore } from '../store/persistence/controller'

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
    return <div className="status-hint">Autosave failed — Ctrl+S to retry, or check the file location</div>
  }
  if (savedFlash && lastSavedAt !== null) {
    return (
      <div className="status-hint">
        Saved ·{' '}
        {new Date(lastSavedAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    )
  }

  let text: string
  if (tool === 'draw-wall') {
    text = 'Click to place wall points · Enter/double-click to finish · Backspace steps back · Esc drops the preview'
  } else if (tool === 'place-opening') {
    text = `Click a wall to place the ${openingKind} · stays armed for more · Esc to finish`
  } else if (tool === 'place-furniture') {
    text = 'Click to place · R rotates the ghost · Esc to finish'
  } else if (tool === 'measure') {
    text = 'Click two points to measure · Enter keeps it as a dimension · Esc clears'
  } else if (tool === 'annotate-text') {
    text = 'Click to place a text label · type its text in the panel · Esc exits'
  } else if (selection.length > 1) {
    text = `${selection.length} selected · drag moves all · R rotates · Ctrl+D duplicates · Del deletes`
  } else if (selection.length === 1) {
    text = 'Drag to move · R rotates · Ctrl+D duplicates · Del deletes · Esc deselects (also inside rooms)'
  } else if (empty) {
    text = 'Press W and click to draw your first wall'
  } else {
    text =
      'V select · W wall · D door · N window · M measure · T text · drag selects · right-drag pans · Shift+1 fit'
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
        <strong>Draw your first room</strong>
        <p>
          Press <kbd>W</kbd>, click to place wall corners, and close the loop back at the start.
          Then drag furniture in from the left.
        </p>
      </div>
    </div>
  )
}
