import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useDocStore } from './docStore'
import { useAppSettings } from './appSettings'

/**
 * UI/session state — never undoable, never persisted.
 * Per-frame tool ephemera (ghost previews, snap indicators) live in the
 * editor's interactionStore (M3), not here.
 */
export type ToolId =
  | 'select'
  | 'draw-wall'
  | 'place-opening'
  | 'place-furniture'
  | 'measure'
  | 'annotate-text'
export type ViewMode = '2d' | '3d'

export interface ToolParams {
  openingKind: 'door' | 'window'
  /** Armed catalog item for click-to-place. */
  catalogItemId: string | null
  wallThickness?: number
  wallHeight?: number
}

/** Canvas context menu (0.3.0 M4): position in editor-root px + the world
 * point under the cursor (paste target / wall-split point). */
export interface ContextMenuState {
  x: number
  y: number
  world: { x: number; y: number }
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
  exportOpen: boolean
  helpOpen: boolean
  contextMenu: ContextMenuState | null
  /** Wall side hovered in the paint rows of the properties panel (2D badge ring). */
  highlightWallSide: 'front' | 'back' | null
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
  setExportOpen: (open: boolean) => void
  setHelpOpen: (open: boolean) => void
  setContextMenu: (menu: ContextMenuState | null) => void
  setHighlightWallSide: (side: 'front' | 'back' | null) => void
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
    exportOpen: false,
    helpOpen: false,
    contextMenu: null,
    highlightWallSide: null,
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
    setExportOpen: (open) => set({ exportOpen: open }),
    setHelpOpen: (open) => set({ helpOpen: open }),
    setContextMenu: (menu) => set({ contextMenu: menu }),
    setHighlightWallSide: (side) => set({ highlightWallSide: side }),
  })),
)

/**
 * Prune selection/hover ids that no longer exist in the document, and drop
 * annotation ids when the annotations layer is hidden (0.7.0) — an invisible
 * selection outline with a live Delete key reads as broken.
 * Called once from app bootstrap (kept out of module scope so importing the
 * store in tests has no side effects). Returns the unsubscribe function.
 */
export function initSelectionPruning(): () => void {
  const unsubDoc = useDocStore.subscribe(
    (s) => s.doc,
    (doc) => {
      const exists = (id: string) =>
        id in doc.walls ||
        id in doc.nodes ||
        id in doc.openings ||
        id in doc.furniture ||
        id in doc.rooms ||
        id in doc.annotations
      const ui = useUiStore.getState()
      const kept = ui.selection.filter(exists)
      if (kept.length !== ui.selection.length) ui.setSelection(kept)
      if (ui.hoveredId && !exists(ui.hoveredId)) ui.setHovered(null)
    },
  )
  const unsubVisibility = useAppSettings.subscribe(
    (s) => s.showAnnotations,
    (show) => {
      if (show) return
      const doc = useDocStore.getState().doc
      const ui = useUiStore.getState()
      const kept = ui.selection.filter((id) => !(id in doc.annotations))
      if (kept.length !== ui.selection.length) ui.setSelection(kept)
      if (ui.hoveredId && ui.hoveredId in doc.annotations) ui.setHovered(null)
    },
  )
  return () => {
    unsubDoc()
    unsubVisibility()
  }
}
