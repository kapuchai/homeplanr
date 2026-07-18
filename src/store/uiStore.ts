import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useDocStore } from './docStore'
import { useActiveLevel } from './activeLevel'
import { levelDocOf } from './levelView'
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
  | 'draw-area'
export type ViewMode = '2d' | '3d'

export interface ToolParams {
  openingKind: 'door' | 'window'
  /** Armed opening style per kind (0.10.0) — remembered independently so
   * the door and window tools each keep their last choice. Absent =
   * standard. */
  doorStyle?: string
  windowStyle?: string
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
  notesOpen: boolean
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
  setNotesOpen: (open: boolean) => void
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
    notesOpen: false,
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
    setNotesOpen: (open) => set({ notesOpen: open }),
    setContextMenu: (menu) => set({ contextMenu: menu }),
    setHighlightWallSide: (side) => set({ highlightWallSide: side }),
  })),
)

/**
 * Prune selection/hover ids that no longer exist on the ACTIVE level (v7 —
 * selection is level-scoped: entities on another floor are neither visible
 * nor hittable, so a live Delete key on them reads as broken), and drop
 * annotation ids when the annotations layer is hidden (0.7.0).
 * Runs on doc commits AND floor switches; also clamps a stale
 * activeLevelId back to null when its level leaves the document.
 * Called once from app bootstrap (kept out of module scope so importing the
 * store in tests has no side effects). Returns the unsubscribe function.
 */
export function initSelectionPruning(): () => void {
  const prune = () => {
    const doc = useDocStore.getState().doc
    const levels = useActiveLevel.getState()
    if (levels.activeLevelId && !doc.levels.some((l) => l.id === levels.activeLevelId)) {
      levels.setActiveLevel(null) // re-fires this handler via the subscription
      return
    }
    const level = levelDocOf(doc, levels.activeLevelId)
    const exists = (id: string) =>
      id in level.walls ||
      id in level.nodes ||
      id in level.openings ||
      id in level.furniture ||
      id in level.rooms ||
      id in level.annotations
    const ui = useUiStore.getState()
    const kept = ui.selection.filter(exists)
    if (kept.length !== ui.selection.length) ui.setSelection(kept)
    if (ui.hoveredId && !exists(ui.hoveredId)) ui.setHovered(null)
  }
  const unsubDoc = useDocStore.subscribe((s) => s.doc, prune)
  const unsubLevel = useActiveLevel.subscribe((s) => s.activeLevelId, prune)
  const unsubVisibility = useAppSettings.subscribe(
    (s) => s.showAnnotations,
    (show) => {
      if (show) return
      const level = levelDocOf(
        useDocStore.getState().doc,
        useActiveLevel.getState().activeLevelId,
      )
      const ui = useUiStore.getState()
      const kept = ui.selection.filter((id) => !(id in level.annotations))
      if (kept.length !== ui.selection.length) ui.setSelection(kept)
      if (ui.hoveredId && ui.hoveredId in level.annotations) ui.setHovered(null)
    },
  )
  return () => {
    unsubDoc()
    unsubLevel()
    unsubVisibility()
  }
}
