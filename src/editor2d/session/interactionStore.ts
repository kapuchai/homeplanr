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
  /** With `to`: a dashed measure line from→to (perpendicular end ticks); the pill floats at `at`. */
  from?: Vec2
  /** 'passive' renders muted (context readouts, e.g. full wall lengths). */
  tone?: 'measure' | 'passive'
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
  /**
   * Furniture ghosts: the real catalog symbol rendered at this transform
   * (InteractionOverlay); the polygon stays as the valid/invalid tint
   * underlay. Item-local prims at natural dims — rot in radians, mirrored
   * = reflection across item-local x=0 before rotation.
   */
  furniture?: { itemId: string; at: Vec2; rot: number; mirrored: boolean }
}

export interface MarqueePreview {
  kind: 'marquee'
  a: Vec2
  b: Vec2
}

export type ToolPreview = WallDrawPreview | GhostPreview | MarqueePreview | null

export interface InteractionState {
  preview: ToolPreview
  snap: SnapResult | null
  pills: DimensionPill[]
  /** Mirrors transactions.isTxActive for cheap subscription by UI chrome. */
  gestureActive: boolean
  /** Cursor override while a gesture owns the pointer (e.g. 'grabbing'). */
  cursorHint: string | null
  /**
   * Last pointer position in world coords, null while off-canvas. CURSOR
   * state, not gesture state — clear() leaves it alone; nothing subscribes
   * (read imperatively, e.g. as the paste target).
   */
  pointerWorld: Vec2 | null
  set: (patch: Partial<Omit<InteractionState, 'set' | 'clear'>>) => void
  clear: () => void
}

export const useInteractionStore = create<InteractionState>()((set) => ({
  preview: null,
  snap: null,
  pills: [],
  gestureActive: false,
  cursorHint: null,
  pointerWorld: null,
  set: (patch) => set(patch),
  clear: () =>
    set({ preview: null, snap: null, pills: [], gestureActive: false, cursorHint: null }),
}))
