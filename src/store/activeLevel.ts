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
