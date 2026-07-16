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
  /**
   * Door ghosts: pre-click leaf + swing arc (world coords, produced by
   * planGeometry.doorGlyph — the SAME code path as placed doors, so the
   * pinned sweep flags cannot fork).
   */
  door?: {
    leaf: { x1: number; y1: number; x2: number; y2: number }
    arc: { from: Vec2; to: Vec2; r: number; sweep: 0 | 1 }
  }
}

export interface MarqueePreview {
  kind: 'marquee'
  a: Vec2
  b: Vec2
}

export interface AreaDrawPreview {
  kind: 'areaDraw'
  /** Committed trace vertices (tool state — nothing in the doc yet). */
  points: Vec2[]
  /** Rubber-band end (snapped), null while off-canvas. */
  cursor: Vec2 | null
  /** Cursor is close enough to the first vertex to close the loop. */
  closeHint: boolean
}

export type ToolPreview =
  | WallDrawPreview
  | GhostPreview
  | MarqueePreview
  | AreaDrawPreview
  | null

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
