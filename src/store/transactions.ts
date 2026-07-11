import { docTemporal, useDocStore } from './docStore'
import type { ProjectDocument } from '../model/types'

/**
 * Drag-transaction lifecycle — the SOLE owner of the zundo temporal API.
 *
 * beginTx  → snapshot the doc reference + pause recording
 * (live-mode mutations run per pointer-frame, unrecorded)
 * commitTx → the tool has already re-run the final mutation in 'commit'
 *            mode; silently revert to the snapshot, resume recording, then
 *            re-apply the final doc ⇒ EXACTLY ONE history entry
 * abortTx  → restore the snapshot, resume, no entry (Esc / pointercancel)
 *
 * Guards: beginTx while active aborts the previous tx (dev warning);
 * commit/abort with no tx are no-ops (Esc-then-pointer-up); undo/redo are
 * exposed here as safeUndo/safeRedo which no-op while a tx is active —
 * the keymap and toolbar must use these, never docTemporal directly.
 */
let txSnapshot: ProjectDocument | null = null

export const isTxActive = (): boolean => txSnapshot !== null

export function beginTx(): void {
  if (txSnapshot !== null) {
    if (import.meta.env?.DEV) {
      console.warn('beginTx while a transaction is active — aborting the previous one')
    }
    abortTx()
  }
  txSnapshot = useDocStore.getState().doc
  docTemporal.getState().pause()
}

export function commitTx(): void {
  if (txSnapshot === null) return
  const snapshot = txSnapshot
  txSnapshot = null
  const final = useDocStore.getState().doc
  if (final !== snapshot) {
    // Silent revert (still paused), then one recorded change to `final`.
    useDocStore.setState({ doc: snapshot })
    docTemporal.getState().resume()
    useDocStore.setState({ doc: final })
  } else {
    docTemporal.getState().resume()
  }
}

export function abortTx(): void {
  if (txSnapshot === null) return
  useDocStore.setState({ doc: txSnapshot })
  txSnapshot = null
  docTemporal.getState().resume()
}

/** Undo/redo gated against active transactions (keymap/toolbar entry point). */
export function safeUndo(): void {
  if (txSnapshot !== null) return
  docTemporal.getState().undo()
}

export function safeRedo(): void {
  if (txSnapshot !== null) return
  docTemporal.getState().redo()
}

export function clearHistory(): void {
  docTemporal.getState().clear()
}

export const canUndo = (): boolean => docTemporal.getState().pastStates.length > 0
export const canRedo = (): boolean => docTemporal.getState().futureStates.length > 0
