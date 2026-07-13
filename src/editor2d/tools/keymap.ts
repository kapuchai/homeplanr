import type { ToolContext } from './toolTypes'
import { switchTool, type ToolRegistry } from './toolRegistry'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  pasteClipboard,
  rotateSelection,
  selectAll,
  zoomToSelection,
} from '../commands'
import { useConfirmStore } from '../../app/confirmStore'
import {
  isTxActive,
  activeTxToken,
  safeRedo,
  safeUndo,
  beginTx,
  commitTx,
  abortTx,
  type TxToken,
} from '../../store/transactions'
import { getDerived } from '../../store/derived'
import { polygonBounds } from '../../geometry/polygon'
import { docContentBounds } from '../render/bounds'
import { useViewportStore } from '../viewport/viewportStore'
import { useAppSettings } from '../../store/appSettings'
import { KEY_ZOOM_FACTOR } from '../viewport/viewportMath'
import type { FurnitureId } from '../../model/ids'
import type { ProjectDocument } from '../../model/types'

/**
 * THE keyboard entry point (plan-pinned):
 * - focus guard: every shortcut is dropped while an editable element has
 *   focus (only Esc blurs);
 * - browser accelerators (F5, Ctrl+R/P/F/J) are suppressed everywhere;
 * - undo/redo/Del/file/tool-switch are gated while a transaction is live;
 * - 3D view: file ops (Ctrl+N/O/S/Shift+S) stay live, everything below the
 *   3D gate is 2D-only (walk mode owns its keys via WalkControls);
 * - Esc ladder: ① tool gesture/state → ② switch to select → ③ deselect.
 *
 * handleKey is DOM-free (headless-testable); Editor2D adapts real
 * KeyboardEvents via toKeyInput.
 */
export interface KeyInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** True when an input/textarea/contenteditable has focus. */
  editableTarget: boolean
  preventDefault: () => void
  /** Blur the focused editable (Esc inside inputs). */
  blurTarget?: () => void
}

export function toKeyInput(e: KeyboardEvent): KeyInput {
  const t = e.target
  const editable =
    typeof HTMLElement !== 'undefined' &&
    t instanceof HTMLElement &&
    (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
  return {
    key: e.key,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    editableTarget: editable,
    preventDefault: () => e.preventDefault(),
    ...(editable && t instanceof HTMLElement ? { blurTarget: () => t.blur() } : {}),
  }
}

/** Fit the 2D view to the doc content — Shift+1 and the ZoomControls Fit button. */
export function zoomToFitContent(doc: ProjectDocument): void {
  useViewportStore.getState().zoomToFit(polygonBounds(docContentBounds(doc, getDerived(doc))))
}

interface NudgeState {
  timer: ReturnType<typeof setTimeout> | null
  /** Owner token of the coalesced nudge tx — the idle timer and flush commit
   * ONLY this token, so a stale timer can never close a later gesture's tx. */
  tx: TxToken
}
const nudge: NudgeState = { timer: null, tx: 0 }

/**
 * Commit a pending arrow-nudge run immediately (instead of at the 300ms idle
 * timer). Called for every non-arrow, non-modifier key — and by pointer entry
 * points (Editor2D pointerdown, toolbar undo/redo, File menu, catalog drop) —
 * so subsequent actions act on the POST-nudge doc rather than silently
 * no-oping behind `isTxActive()` or folding into the nudge's undo entry.
 * Safe against later gestures: commitTx is token-gated, so if the nudge tx
 * was already preempted this is a no-op. Returns true when it actually
 * committed a pending nudge (callers with targeted-undo semantics swallow
 * their action for that press).
 */
export function flushPendingNudge(): boolean {
  if (!nudge.timer) return false
  clearTimeout(nudge.timer)
  nudge.timer = null
  const owned = activeTxToken() === nudge.tx && isTxActive()
  commitTx(nudge.tx)
  return owned
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
// bare non-acting keys that must not split a coalesced nudge run
// (AltGraph matters: it is a routinely-pressed bare key on EU layouts)
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Compose']

export function handleKey(e: KeyInput, ctx: ToolContext, registry: ToolRegistry): void {
  // desktop app: never let the webview act like a browser
  if (e.key === 'F5' || (e.ctrlKey && ['r', 'p', 'f', 'j'].includes(e.key.toLowerCase()))) {
    e.preventDefault()
    return
  }
  // modal guard: a pending confirm or the Options dialog swallows every key
  // (the shared Modal handles Escape itself in the document CAPTURE phase —
  // the resolve below is a belt-and-braces fallback that resolves the same
  // escValue if a modal ever renders without the Modal shell)
  const confirm = useConfirmStore.getState()
  if (confirm.pending || ctx.ui().optionsOpen || ctx.ui().helpOpen) {
    if (e.key === 'Escape' && confirm.pending) {
      // per-prompt escValue: non-destructive by contract (the recovery
      // prompt's Esc must never mean Discard)
      confirm.resolve(confirm.pending.escValue)
    }
    return
  }
  // context menu: focused MenuList navigation never reaches here (it stops
  // propagation); anything else while the menu is open only closes it
  if (ctx.ui().contextMenu) {
    if (e.key === 'Escape') ctx.ui().setContextMenu(null)
    return
  }
  if (e.editableTarget) {
    if (e.key === 'Escape') e.blurTarget?.()
    return
  }
  const ui = ctx.ui()
  const key = e.key

  // any non-arrow, non-modifier key commits a pending nudge run first, so
  // everything below sees the post-nudge doc (arrows continue the run;
  // bare modifiers must not split it — Shift mid-run switches step size)
  const nudgeFlushed =
    !ARROWS.includes(key) && !MODIFIERS.includes(key) ? flushPendingNudge() : false

  // file operations (gated while a gesture is live)
  if (e.ctrlKey && !isTxActive()) {
    const k = key.toLowerCase()
    if (k === 'n') {
      e.preventDefault()
      void import('../../store/persistence/controller').then((c) => c.newProject())
      return
    }
    if (k === 'o') {
      e.preventDefault()
      void import('../../store/persistence/controller').then((c) => c.openProject())
      return
    }
    if (k === 's') {
      e.preventDefault()
      void import('../../store/persistence/controller').then((c) =>
        e.shiftKey ? c.saveProjectAs() : c.saveProject(),
      )
      return
    }
  }

  // shortcut sheet — universal (works in 3D too; the toolbar button does)
  if (key === '?' && !isTxActive()) {
    ui.setHelpOpen(true)
    return
  }

  // 3D view: only the file accelerators above stay live — every editing/
  // navigation shortcut below is 2D-only (walk-mode WASD/Esc/arrows belong
  // to WalkControls' own listeners)
  if (ui.viewMode === '3d') return

  // undo/redo (gated inside safeUndo/safeRedo as well)
  if (e.ctrlKey && key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) safeRedo()
    else safeUndo()
    return
  }
  if (e.ctrlKey && key.toLowerCase() === 'y') {
    e.preventDefault()
    safeRedo()
    return
  }

  // select all — walls/openings/furniture; rooms are derived and bare nodes
  // are manipulation targets, so bulk selection skips both (matches marquee)
  if (e.ctrlKey && key.toLowerCase() === 'a') {
    e.preventDefault()
    if (!isTxActive()) selectAll(ctx)
    return
  }

  // duplicate
  if (e.ctrlKey && key.toLowerCase() === 'd') {
    e.preventDefault()
    duplicateSelection(ctx)
    return
  }

  // copy/paste — module clipboard, survives New/Open (the focus guard above
  // keeps native copy/paste working inside text inputs)
  if (e.ctrlKey && key.toLowerCase() === 'c') {
    copySelection(ctx) // silent no-op without furniture
    return
  }
  if (e.ctrlKey && key.toLowerCase() === 'v') {
    e.preventDefault()
    pasteClipboard(ctx)
    return
  }

  if (key === ' ') {
    e.preventDefault()
    if (!ui.spaceHeld) ui.setSpaceHeld(true)
    return
  }

  // tool hotkeys (blocked mid-gesture; plain letters only — Shift+letter is
  // reserved for view toggles like Shift+D)
  if (!isTxActive() && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    if (key.toLowerCase() === 'v') {
      switchTool('select')
      return
    }
    if (key.toLowerCase() === 'w') {
      switchTool('draw-wall')
      return
    }
    if (key.toLowerCase() === 'd') {
      ui.setToolParams({ openingKind: 'door' })
      switchTool('place-opening')
      return
    }
    if (key.toLowerCase() === 'n') {
      ui.setToolParams({ openingKind: 'window' })
      switchTool('place-opening')
      return
    }
    if (key.toLowerCase() === 'm') {
      switchTool('measure')
      return
    }
    if (key.toLowerCase() === 't') {
      switchTool('annotate-text')
      return
    }
    if (key.toLowerCase() === 's') {
      // snap toggle — device pref since v3, so this never dirties the file
      const settings = useAppSettings.getState()
      settings.setSnapEnabled(!settings.snapEnabled)
      return
    }
    if (key.toLowerCase() === 'g') {
      const settings = useAppSettings.getState()
      settings.setShowGrid(!settings.showGrid)
      return
    }
  }

  // R/F reach the ACTIVE TOOL first — the place-furniture ghost consumes
  // them for pre-placement rotate/flip. Without this, placement selecting
  // the dropped item would shadow the ghost forever after the first drop
  // (the global handlers below act on the selection and return). The raw
  // key is passed through: 'R' (shifted) means counter-rotate to the ghost.
  const lk = key.toLowerCase()
  if (!isTxActive() && !e.ctrlKey && !e.altKey && (lk === 'r' || lk === 'f')) {
    if (registry.get(ui.activeTool).onKeyDown?.(key, ctx)) return
  }

  // rotate selected furniture ±90° — one transaction, one undo entry
  if (!isTxActive() && key.toLowerCase() === 'r' && !e.ctrlKey) {
    if (rotateSelection(ctx, e.shiftKey ? -1 : 1)) return
  }

  // flip selected furniture (mirror across item-local x) — one entry
  if (!isTxActive() && key.toLowerCase() === 'f' && !e.ctrlKey) {
    if (flipSelection(ctx)) return
  }

  // arrow nudge — coalesced into one tx committed after 300ms idle; with no
  // furniture selected the arrows pan the 2D viewport (screen px, no tx)
  if (ARROWS.includes(key)) {
    const ids = ui.selection.filter((id) => ctx.doc().furniture[id as FurnitureId])
    if (!ids.length) {
      if (ui.viewMode !== '2d') return
      e.preventDefault()
      const s = e.shiftKey ? 240 : 80
      // camera moves toward the arrow ⇒ content slides the opposite way
      useViewportStore.getState().panBy(
        key === 'ArrowLeft' ? s : key === 'ArrowRight' ? -s : 0,
        key === 'ArrowUp' ? s : key === 'ArrowDown' ? -s : 0,
      )
      return
    }
    e.preventDefault()
    const step = (e.shiftKey ? 0.1 : 0.01) * (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1)
    const dx = key === 'ArrowLeft' || key === 'ArrowRight' ? step : 0
    const dy = key === 'ArrowUp' || key === 'ArrowDown' ? step : 0
    // arrows while a FOREIGN gesture owns the tx (mid-drag) are swallowed —
    // folding a nudge into another gesture's undo entry (and losing it on
    // that gesture's Esc) is worse than ignoring the keypress
    if (isTxActive() && activeTxToken() !== nudge.tx) return
    // preempt:'commit' — a drag starting inside the idle window COMMITS this
    // run (its own undo entry) instead of silently reverting it
    if (!isTxActive()) nudge.tx = beginTx({ preempt: 'commit' })
    for (const id of ids) {
      const f = ctx.doc().furniture[id as FurnitureId]!
      ctx.actions().transformFurniture(id as FurnitureId, { x: f.x + dx, y: f.y + dy })
    }
    if (nudge.timer) clearTimeout(nudge.timer)
    nudge.timer = setTimeout(() => {
      nudge.timer = null
      commitTx(nudge.tx) // token-gated: no-ops if a later gesture owns the tx
    }, 300)
    return
  }

  // deletion (never mid-gesture; rooms are derived — not deletable)
  if ((key === 'Delete' || key === 'Backspace') && !isTxActive()) {
    // Backspace is a TARGETED undo (draw-wall steps back one segment): when
    // this very press flushed a nudge, the top history entry is the nudge,
    // not the segment — swallow the press instead of desyncing the chain
    if (key === 'Backspace' && nudgeFlushed) return
    const tool = registry.get(ui.activeTool)
    if (tool.onKeyDown?.(key, ctx)) return // draw-wall Backspace steps back
    deleteSelection(ctx)
    return
  }

  // zoom to fit
  if (e.shiftKey && (key === '1' || key === '!')) {
    zoomToFitContent(ctx.doc())
    return
  }

  // zoom to selection
  if (e.shiftKey && (key === '2' || key === '@')) {
    zoomToSelection(ctx)
    return
  }

  // wall-dimension labels (2D annotation layer)
  if (e.shiftKey && !e.ctrlKey && !e.altKey && key.toLowerCase() === 'd' && ui.viewMode === '2d') {
    const settings = useAppSettings.getState()
    settings.setShowDimensions(!settings.showDimensions)
    return
  }

  // keyboard zoom about the viewport center ('+'/'=' in, '-'/'_' out) —
  // like wheel zoom, deliberately not isTxActive-gated
  if (!e.ctrlKey && !e.altKey && ['+', '=', '-', '_'].includes(key) && ui.viewMode === '2d') {
    e.preventDefault()
    const vp = useViewportStore.getState()
    vp.zoomAtPoint(
      { x: vp.width / 2, y: vp.height / 2 },
      key === '+' || key === '=' ? KEY_ZOOM_FACTOR : 1 / KEY_ZOOM_FACTOR,
    )
    return
  }

  // Esc ladder
  if (key === 'Escape') {
    const tool = registry.get(ui.activeTool)
    if (tool.onKeyDown?.('Escape', ctx)) return // ① gesture / tool state
    // ①.5 safety net: a tx no tool claims is stuck (exception mid-gesture) —
    // without this, token-gated aborts would leave the keyboard locked out
    if (isTxActive()) {
      abortTx()
      return
    }
    if (ui.activeTool !== 'select') {
      switchTool('select') // ② back to select
      return
    }
    ui.clearSelection() // ③ deselect
    return
  }

  // remaining keys offered to the active tool (Enter ends wall chains, …)
  registry.get(ui.activeTool).onKeyDown?.(key, ctx)
}

export function handleKeyUp(e: { key: string }, ctx: ToolContext): void {
  if (e.key === ' ') ctx.ui().setSpaceHeld(false)
}

