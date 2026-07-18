import { useStore } from 'zustand'
import { docTemporal, useDocStore } from './docStore'
import { useActiveLevel } from './activeLevel'
import type { ProjectDocument } from '../model/types'

/**
 * Drag-transaction lifecycle — the SOLE owner of the zundo temporal API.
 *
 * beginTx  → snapshot the doc reference + pause recording; returns a TOKEN
 * (live-mode mutations run per pointer-frame, unrecorded)
 * commitTx → the tool has already re-run the final mutation in 'commit'
 *            mode; silently revert to the snapshot, resume recording, then
 *            re-apply the final doc ⇒ EXACTLY ONE history entry
 * abortTx  → restore the snapshot, resume, no entry (Esc / pointercancel)
 *
 * Ownership: commitTx/abortTx act only when the given token owns the live
 * tx — a stale owner (the arrow-nudge idle timer, an outgoing tool's
 * onDeactivate) can never close a LATER gesture's transaction. Omitting the
 * token forces the close regardless of owner (test cleanup only; production
 * callers always pass their token).
 *
 * Preemption: beginTx while a tx is open closes the previous one first,
 * honoring ITS declared policy — `preempt: 'commit'` txs (the coalesced
 * arrow nudge) are committed so their work survives as one entry; default
 * txs are aborted (dev warning: gestures should be closed by their owner).
 *
 * commit/abort with no active tx are no-ops (Esc-then-pointer-up); undo/redo
 * are exposed here as safeUndo/safeRedo which no-op while a tx is active —
 * the keymap and toolbar must use these, never docTemporal directly.
 */
export type TxToken = number

let txSnapshot: ProjectDocument | null = null
let txPreempt: 'abort' | 'commit' = 'abort'
let activeToken = 0
let nextToken = 1

export const isTxActive = (): boolean => txSnapshot !== null

/** Token of the currently-open tx, or 0 when none — lets a coalescing owner
 * (the arrow nudge) distinguish "my tx is still open" from "a different
 * gesture owns the tx now". */
export const activeTxToken = (): TxToken => activeToken

export function beginTx(opts?: { preempt?: 'abort' | 'commit' }): TxToken {
  if (txSnapshot !== null) {
    if (txPreempt === 'commit') {
      commitTx(activeToken)
    } else {
      if (import.meta.env?.DEV) {
        console.warn('beginTx while a transaction is active — aborting the previous one')
      }
      abortTx(activeToken)
    }
  }
  txSnapshot = useDocStore.getState().doc
  txPreempt = opts?.preempt ?? 'abort'
  activeToken = nextToken++
  docTemporal.getState().pause()
  return activeToken
}

export function commitTx(token?: TxToken): void {
  if (txSnapshot === null) return
  if (token !== undefined && token !== activeToken) return // not the owner
  const snapshot = txSnapshot
  txSnapshot = null
  activeToken = 0
  txPreempt = 'abort'
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

export function abortTx(token?: TxToken): void {
  if (txSnapshot === null) return
  if (token !== undefined && token !== activeToken) return // not the owner
  useDocStore.setState({ doc: txSnapshot })
  txSnapshot = null
  activeToken = 0
  txPreempt = 'abort'
  docTemporal.getState().resume()
}

/**
 * Undo-follow (v7): after an undo/redo lands, switch the active floor to
 * the level the step actually changed — undoing a wall you drew upstairs
 * while looking at the ground floor must not read as "nothing happened".
 * Level identity is by id; content change is by reference (immer gives a
 * changed level a new object). Doc-scoped steps (rename, notes) change no
 * level and leave the floor alone; the pruning subscription clamps a
 * vanished active id.
 */
function followChangedLevel(before: ProjectDocument): void {
  const after = useDocStore.getState().doc
  if (after === before) return
  const prevById = new Map(before.levels.map((l) => [l.id, l]))
  const changed = after.levels.find((l) => prevById.get(l.id) !== l)
  if (changed && changed.id !== useActiveLevel.getState().activeLevelId) {
    useActiveLevel.getState().setActiveLevel(changed.id)
  }
}

/** Undo/redo gated against active transactions (keymap/toolbar entry point). */
export function safeUndo(): void {
  if (txSnapshot !== null) return
  const before = useDocStore.getState().doc
  docTemporal.getState().undo()
  followChangedLevel(before)
}

export function safeRedo(): void {
  if (txSnapshot !== null) return
  const before = useDocStore.getState().doc
  docTemporal.getState().redo()
  followChangedLevel(before)
}

export function clearHistory(): void {
  docTemporal.getState().clear()
}

export const canUndo = (): boolean => docTemporal.getState().pastStates.length > 0
export const canRedo = (): boolean => docTemporal.getState().futureStates.length > 0

/** Reactive variants for components (the toolbar) — subscribe here, never
 * to docTemporal directly. */
export const useCanUndo = (): boolean =>
  useStore(docTemporal, (s) => s.pastStates.length > 0)
export const useCanRedo = (): boolean =>
  useStore(docTemporal, (s) => s.futureStates.length > 0)

// Dev-only HMR guard (0.13.0 session lesson): this module holds LIVE STATE.
// Hot-swapping it creates a SECOND instance while older importers keep the
// first — clicks write to one store, renderers read another ("switching
// does nothing" in a long dev session). Decline HMR: edits here always
// full-reload the page. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate())
}
