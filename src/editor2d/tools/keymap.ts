import type { ToolContext } from './toolTypes'
import type { ToolRegistry } from './toolRegistry'
import { useConfirmStore } from '../../app/confirmStore'
import { isTxActive, safeRedo, safeUndo, beginTx, commitTx } from '../../store/transactions'
import { getDerived } from '../../store/derived'
import { polygonBounds } from '../../geometry/polygon'
import { docContentBounds } from '../render/bounds'
import { useViewportStore } from '../viewport/viewportStore'
import type { FurnitureId, NodeId, OpeningId, WallId } from '../../model/ids'

/**
 * THE keyboard entry point (plan-pinned):
 * - focus guard: every shortcut is dropped while an editable element has
 *   focus (only Esc blurs);
 * - browser accelerators (F5, Ctrl+R/P/F/J) are suppressed everywhere;
 * - undo/redo/Del/file/tool-switch are gated while a transaction is live;
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

  if (key === ' ') {
    e.preventDefault()
    if (!ui.spaceHeld) ui.setSpaceHeld(true)
    return
  }

  // tool hotkeys (blocked mid-gesture)
  if (!isTxActive() && !e.ctrlKey && !e.altKey) {
    if (key.toLowerCase() === 'v') {
      registry.switchTo(ctx, 'select')
      return
    }
    if (key.toLowerCase() === 'w') {
      registry.switchTo(ctx, 'draw-wall')
      return
    }
    if (key.toLowerCase() === 'd') {
      ui.setToolParams({ openingKind: 'door' })
      registry.switchTo(ctx, 'place-opening')
      return
    }
    if (key.toLowerCase() === 'n') {
      ui.setToolParams({ openingKind: 'window' })
      registry.switchTo(ctx, 'place-opening')
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

  // arrow nudge — coalesced into one tx committed after 300ms idle
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    const ids = ui.selection.filter((id) => ctx.doc().furniture[id as FurnitureId])
    if (!ids.length) return
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
    const doc = ctx.doc()
    useViewportStore.getState().zoomToFit(polygonBounds(docContentBounds(doc, getDerived(doc))))
    return
  }

  // Esc ladder
  if (key === 'Escape') {
    const tool = registry.get(ui.activeTool)
    if (tool.onKeyDown?.('Escape', ctx)) return // ① gesture / tool state
    if (ui.activeTool !== 'select') {
      registry.switchTo(ctx, 'select') // ② back to select
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
