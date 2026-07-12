import type { ToolContext } from './toolTypes'
import { switchTool, type ToolRegistry } from './toolRegistry'
import { buildPasteParams, copyFurniture, hasClipboard, pasteTarget } from '../clipboard'
import { useConfirmStore } from '../../app/confirmStore'
import { isTxActive, safeRedo, safeUndo, beginTx, commitTx } from '../../store/transactions'
import { getDerived } from '../../store/derived'
import { polygonBounds } from '../../geometry/polygon'
import { docContentBounds } from '../render/bounds'
import { useViewportStore } from '../viewport/viewportStore'
import { useAppSettings } from '../../store/appSettings'
import { KEY_ZOOM_FACTOR } from '../viewport/viewportMath'
import type { FurnitureId, NodeId, OpeningId, WallId } from '../../model/ids'
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
}
const nudge: NudgeState = { timer: null }

export function handleKey(e: KeyInput, ctx: ToolContext, registry: ToolRegistry): void {
  // desktop app: never let the webview act like a browser
  if (e.key === 'F5' || (e.ctrlKey && ['r', 'p', 'f', 'j'].includes(e.key.toLowerCase()))) {
    e.preventDefault()
    return
  }
  // modal guard: a pending confirm or the Options dialog swallows every key
  // (Options handles its own Escape via a document listener)
  const confirm = useConfirmStore.getState()
  if (confirm.pending || ctx.ui().optionsOpen) {
    if (e.key === 'Escape' && confirm.pending) {
      confirm.resolve(confirm.pending.buttons[confirm.pending.buttons.length - 1]!.value)
    }
    return
  }
  if (e.editableTarget) {
    if (e.key === 'Escape') e.blurTarget?.()
    return
  }
  const ui = ctx.ui()
  const key = e.key

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

  // duplicate
  if (e.ctrlKey && key.toLowerCase() === 'd') {
    e.preventDefault()
    if (isTxActive()) return
    const ids = ui.selection.filter((id) => ctx.doc().furniture[id as FurnitureId])
    if (ids.length) {
      const copies = ctx.actions().duplicateFurniture(ids as FurnitureId[])
      ui.setSelection(copies)
    }
    return
  }

  // copy/paste — module clipboard, survives New/Open (the focus guard above
  // keeps native copy/paste working inside text inputs)
  if (e.ctrlKey && key.toLowerCase() === 'c') {
    if (isTxActive()) return
    copyFurniture(ctx.doc(), ui.selection) // silent no-op without furniture
    return
  }
  if (e.ctrlKey && key.toLowerCase() === 'v') {
    e.preventDefault()
    if (isTxActive() || !hasClipboard()) return
    const ids = ctx
      .actions()
      .addFurnitureBatch(buildPasteParams(pasteTarget(ctx.interaction().pointerWorld)))
    ui.setSelection(ids)
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
  }

  // rotate selected furniture ±90° — one transaction, one undo entry
  if (!isTxActive() && key.toLowerCase() === 'r' && !e.ctrlKey) {
    const ids = ui.selection.filter((id) => ctx.doc().furniture[id as FurnitureId])
    if (ids.length) {
      const dir = e.shiftKey ? -1 : 1
      beginTx()
      for (const id of ids) {
        const f = ctx.doc().furniture[id as FurnitureId]!
        ctx.actions().transformFurniture(id as FurnitureId, {
          rotation: f.rotation + (dir * Math.PI) / 2,
        })
      }
      commitTx()
      return
    }
  }

  // flip selected furniture (mirror across item-local x) — one entry
  if (!isTxActive() && key.toLowerCase() === 'f' && !e.ctrlKey) {
    const ids = ui.selection.filter((id) => ctx.doc().furniture[id as FurnitureId])
    if (ids.length) {
      beginTx()
      for (const id of ids) {
        const f = ctx.doc().furniture[id as FurnitureId]!
        ctx.actions().transformFurniture(id as FurnitureId, { mirrored: !f.mirrored })
      }
      commitTx()
      return
    }
  }

  // arrow nudge — coalesced into one tx committed after 300ms idle; with no
  // furniture selected the arrows pan the 2D viewport (screen px, no tx)
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
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
    if (!isTxActive()) beginTx()
    for (const id of ids) {
      const f = ctx.doc().furniture[id as FurnitureId]!
      ctx.actions().transformFurniture(id as FurnitureId, { x: f.x + dx, y: f.y + dy })
    }
    if (nudge.timer) clearTimeout(nudge.timer)
    nudge.timer = setTimeout(() => {
      nudge.timer = null
      if (isTxActive()) commitTx()
    }, 300)
    return
  }

  // deletion (never mid-gesture; rooms are derived — not deletable)
  if ((key === 'Delete' || key === 'Backspace') && !isTxActive()) {
    const tool = registry.get(ui.activeTool)
    if (tool.onKeyDown?.(key, ctx)) return // draw-wall Backspace steps back
    const ids = ui.selection.filter((id) => !ctx.doc().rooms[id as never]) as (
      | WallId
      | NodeId
      | OpeningId
      | FurnitureId
    )[]
    if (ids.length) ctx.actions().deleteEntities(ids)
    return
  }

  // zoom to fit
  if (e.shiftKey && (key === '1' || key === '!')) {
    zoomToFitContent(ctx.doc())
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

/** Test hook: flush a pending nudge coalescing timer immediately. */
export function flushNudgeForTests(): void {
  if (nudge.timer) {
    clearTimeout(nudge.timer)
    nudge.timer = null
    if (isTxActive()) commitTx()
  }
}
