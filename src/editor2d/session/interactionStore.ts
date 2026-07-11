import { create } from 'zustand'
import type { Vec2 } from '../../geometry/vec'
import type { SnapResult } from '../../geometry/snapping'

/**
 * Per-frame tool overlay view-model. Tools WRITE here on pointer moves;
 * ONLY InteractionOverlay subscribes — 60fps previews never touch the
 * world layers or the document store.
 */
export interface DimensionPill {
  at: Vec2
  text: string
  /** Optional leader line from `at` to `to`. */
  to?: Vec2
}

export interface WallDrawPreview {
  kind: 'wallDraw'
  /** Committed chain points (already in the doc as walls). */
  anchor: Vec2 | null
  /** Rubber-band end (snapped). */
  cursor: Vec2 | null
  thickness: number
  angleBadge?: string
}

export interface GhostPreview {
  kind: 'ghost'
  polygon: Vec2[]
  valid: boolean
}

export type ToolPreview = WallDrawPreview | GhostPreview | null

export interface InteractionState {
  preview: ToolPreview
  snap: SnapResult | null
  pills: DimensionPill[]
  /** Mirrors transactions.isTxActive for cheap subscription by UI chrome. */
  gestureActive: boolean
  set: (patch: Partial<Omit<InteractionState, 'set' | 'clear'>>) => void
  clear: () => void
}

export const useInteractionStore = create<InteractionState>()((set) => ({
  preview: null,
  snap: null,
  pills: [],
  gestureActive: false,
  set: (patch) => set(patch),
  clear: () => set({ preview: null, snap: null, pills: [], gestureActive: false }),
}))
