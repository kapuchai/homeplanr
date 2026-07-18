import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { LevelId } from '../model/ids'

/**
 * The active storey (v7) — UI/session state, NEVER document data: switching
 * floors must not dirty the file or create undo entries (the snapEnabled
 * precedent). Its own module (not uiStore) so docStore's mutation seam can
 * read it without a docStore ↔ uiStore import cycle.
 *
 * `null` means "the document's first level" — the resolved fallback lives
 * in levelView.ts, so a fresh/loaded document needs no cross-store seeding
 * at module init. Doc-replacing operations reset to null; undo-follow and
 * the switcher set concrete ids (a stale id resolves to the first level
 * until the pruning subscription clears it).
 */
interface ActiveLevelState {
  activeLevelId: LevelId | null
  setActiveLevel: (id: LevelId | null) => void
}

export const useActiveLevel = create<ActiveLevelState>()(
  subscribeWithSelector((set) => ({
    activeLevelId: null,
    setActiveLevel: (id) => set({ activeLevelId: id }),
  })),
)

// Dev-only HMR guard (0.13.0 session lesson): this module holds LIVE STATE.
// Hot-swapping it creates a SECOND instance while older importers keep the
// first — clicks write to one store, renderers read another ("switching
// does nothing" in a long dev session). Decline HMR: edits here always
// full-reload the page. No-op in production builds. (location.reload,
// not hot.invalidate(): in this graph every importer is itself an
// accepting boundary, so invalidation can degrade to a partial
// re-execution — the exact split it must prevent.)
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload())
}
