import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useDocStore } from './docStore'

/**
 * UI/session state — never undoable, never persisted.
 * Per-frame tool ephemera (ghost previews, snap indicators) live in the
 * editor's interactionStore (M3), not here.
 */
export type ToolId = 'select' | 'draw-wall' | 'place-opening' | 'place-furniture'
export type ViewMode = '2d' | '3d'

export interface ToolParams {
  openingKind: 'door' | 'window'
  /** Armed catalog item for click-to-place. */
  catalogItemId: string | null
  wallThickness?: number
  wallHeight?: number
}

export interface UiState {
  activeTool: ToolId
  toolParams: ToolParams
  selection: string[]
  hoveredId: string | null
  viewMode: ViewMode
  spaceHeld: boolean
  snapSuspended: boolean
  optionsOpen: boolean
  setActiveTool: (tool: ToolId) => void
  setToolParams: (patch: Partial<ToolParams>) => void
  setSelection: (ids: string[]) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  setHovered: (id: string | null) => void
  setViewMode: (mode: ViewMode) => void
  setSpaceHeld: (held: boolean) => void
  setSnapSuspended: (suspended: boolean) => void
  setOptionsOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()(
  subscribeWithSelector((set) => ({
    activeTool: 'select',
    toolParams: { openingKind: 'door', catalogItemId: null },
    selection: [],
    hoveredId: null,
    viewMode: '2d',
    spaceHeld: false,
    snapSuspended: false,
    optionsOpen: false,
    setActiveTool: (tool) => set({ activeTool: tool }),
    setToolParams: (patch) =>
      set((s) => ({ toolParams: { ...s.toolParams, ...patch } })),
    setSelection: (ids) => set({ selection: ids }),
    toggleSelected: (id) =>
      set((s) => ({
        selection: s.selection.includes(id)
          ? s.selection.filter((x) => x !== id)
          : [...s.selection, id],
      })),
    clearSelection: () => set({ selection: [] }),
    setHovered: (id) => set({ hoveredId: id }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setSpaceHeld: (held) => set({ spaceHeld: held }),
    setSnapSuspended: (suspended) => set({ snapSuspended: suspended }),
    setOptionsOpen: (open) => set({ optionsOpen: open }),
  })),
)

/**
 * Prune selection/hover ids that no longer exist in the document.
 * Called once from app bootstrap (kept out of module scope so importing the
 * store in tests has no side effects). Returns the unsubscribe function.
 */
export function initSelectionPruning(): () => void {
  return useDocStore.subscribe(
    (s) => s.doc,
    (doc) => {
      const exists = (id: string) =>
        id in doc.walls ||
        id in doc.nodes ||
        id in doc.openings ||
        id in doc.furniture ||
        id in doc.rooms
      const ui = useUiStore.getState()
      const kept = ui.selection.filter(exists)
      if (kept.length !== ui.selection.length) ui.setSelection(kept)
      if (ui.hoveredId && !exists(ui.hoveredId)) ui.setHovered(null)
    },
  )
}
