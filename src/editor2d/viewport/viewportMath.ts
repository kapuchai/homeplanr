import type { Vec2 } from '../../geometry/vec'
import type { Bounds } from '../../geometry/polygon'

/**
 * Viewport transform (k in px per meter):
 *   screen.x = world.x · k + tx
 *   screen.y = ty − world.y · k     ← 2D renders Y-UP
 * All conversions live here — no other module may do px↔m math.
 *
 * WHY y-up (M6 packaged-gate finding): plan data is y-down, but a y-down
 * SCREEN view is chirality-flipped relative to ANY above-ground 3D camera
 * of the same world — no azimuth can undo a reflection, so 2D and 3D read
 * as mirrored. Flipping the RENDER transform (this one matrix) makes both
 * views agree; the document model, geometry, and 3D pipeline are untouched.
 */
export interface Viewport {
  k: number
  tx: number
  ty: number
  width: number
  height: number
}

export const K_MIN = 5
export const K_MAX = 1000
export const K_DEFAULT = 60
/** Zoom step per '+'/'−' key press and per ZoomControls button click. */
export const KEY_ZOOM_FACTOR = 1.25

export const clampK = (k: number): number => Math.min(K_MAX, Math.max(K_MIN, k))

export const worldToScreen = (p: Vec2, vp: Viewport): Vec2 => ({
  x: p.x * vp.k + vp.tx,
  y: vp.ty - p.y * vp.k,
})

export const screenToWorld = (p: Vec2, vp: Viewport): Vec2 => ({
  x: (p.x - vp.tx) / vp.k,
  y: (vp.ty - p.y) / vp.k,
})

/** Screen px → world meters at the current zoom (snap radii etc.). */
export const pxToWorld = (px: number, vp: Viewport): number => px / vp.k

/** Zoom about a fixed screen point; the world point under it stays put. */
export function zoomAt(vp: Viewport, screen: Vec2, factor: number): Viewport {
  const k = clampK(vp.k * factor)
  const scale = k / vp.k
  return {
    ...vp,
    k,
    tx: screen.x - (screen.x - vp.tx) * scale,
    ty: screen.y - (screen.y - vp.ty) * scale,
  }
}

/** Fit world bounds into the viewport with padding; empty → default view. */
export function fitBounds(bounds: Bounds | null, vp: Viewport, padding = 0.1): Viewport {
  if (!bounds || vp.width <= 0 || vp.height <= 0) {
    return { ...vp, k: K_DEFAULT, tx: vp.width / 2, ty: vp.height / 2 }
  }
  const bw = Math.max(bounds.maxX - bounds.minX, 0.5)
  const bh = Math.max(bounds.maxY - bounds.minY, 0.5)
  const k = clampK(Math.min(vp.width / bw, vp.height / bh) * (1 - padding))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    ...vp,
    k,
    tx: vp.width / 2 - cx * k,
    ty: vp.height / 2 + cy * k, // y-up: screen.y = ty − y·k
  }
}

/**
 * Grid tiers (one rule, plan-pinned): minor candidates = gridSize×{1,5,10,50};
 * the displayed minor is the smallest candidate rendering ≥ ~12 screen px;
 * major = 10× minor. Grid SNAP step always equals the displayed minor.
 */
export function gridTier(k: number, gridSize: number): { minor: number; major: number } {
  const candidates = [1, 5, 10, 50].map((m) => gridSize * m)
  const minor = candidates.find((c) => c * k >= 12) ?? candidates[candidates.length - 1]!
  return { minor, major: minor * 10 }
}

/**
 * Wheel normalization (plan-pinned): deltaMode line≈16px, page≈100px;
 * exponential zoom clamped to ≤1.25× per event. ctrlKey wheel (touchpad
 * pinch / Ctrl+zoom) uses a finer response.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY
  const speed = ctrlKey ? 0.005 : 0.0015
  const factor = Math.exp(-px * speed)
  return Math.min(1.25, Math.max(1 / 1.25, factor))
}
