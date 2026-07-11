import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Vec2 } from '../../geometry/vec'
import type { Bounds } from '../../geometry/polygon'
import { fitBounds, zoomAt, K_DEFAULT, type Viewport } from './viewportMath'

/**
 * 2D viewport state — updated every pan/zoom frame. World content NEVER
 * subscribes to it via React; useViewportTransform applies the transform
 * imperatively (zustand transient-update pattern). Only counter-scaled
 * labels/handles subscribe, and only to `k` (or the derived grid tier).
 */
interface ViewportState extends Viewport {
  panBy: (dx: number, dy: number) => void
  zoomAtPoint: (screen: Vec2, factor: number) => void
  zoomToFit: (bounds: Bounds | null) => void
  setSize: (width: number, height: number) => void
}

export const useViewportStore = create<ViewportState>()(
  subscribeWithSelector((set) => ({
    k: K_DEFAULT,
    tx: 0,
    ty: 0,
    width: 0,
    height: 0,
    panBy: (dx, dy) => set((s) => ({ tx: s.tx + dx, ty: s.ty + dy })),
    zoomAtPoint: (screen, factor) => set((s) => zoomAt(s, screen, factor)),
    zoomToFit: (bounds) => set((s) => fitBounds(bounds, s)),
    setSize: (width, height) =>
      set((s) => {
        // first size measurement centers the default view
        if (s.width === 0 && s.height === 0 && s.tx === 0 && s.ty === 0) {
          return { width, height, tx: width / 2, ty: height / 2 }
        }
        return { width, height }
      }),
  })),
)
