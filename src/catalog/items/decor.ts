import type { CatalogItem } from '../types'

/**
 * Decor (0.9.0) — wall-mounted pieces. All follow the tv-wall archetype:
 * a mount block reaching the back edge (wallSnap conformance), a frame
 * plate spanning the full face, and a single flat front slab. For art the
 * slab is the `imageSlot` — the per-instance uploaded image textures it,
 * and the 'canvas' palette entry is the placeholder when no image is set.
 * Elevations put the piece's center near 1.5m eye height.
 */

export const artPortrait: CatalogItem = {
  id: 'art-portrait',
  name: 'Framed art, portrait',
  category: 'decor',
  dims: { w: 0.5, d: 0.2, h: 0.7 },
  wallSnap: true,
  defaultElevation: 1.15,
  imageSlot: 'canvas',
  materials: { frame: 'woodDark', canvas: 'canvas' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [0.25, 0.135, 0.18], at: [0, d / 2 - 0.0675, (h - 0.18) / 2] })
    b.box('frame', { size: [w, 0.03, h], at: [0, -0.05, 0] })
    b.box('canvas', { size: [w - 0.06, 0.02, h - 0.06], at: [0, -0.075, 0.03] })
  },
}

export const artLandscape: CatalogItem = {
  id: 'art-landscape',
  name: 'Framed art, wide',
  category: 'decor',
  dims: { w: 1.2, d: 0.2, h: 0.6 },
  wallSnap: true,
  defaultElevation: 1.2,
  imageSlot: 'canvas',
  materials: { frame: 'metalDark', canvas: 'canvas' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [0.4, 0.135, 0.18], at: [0, d / 2 - 0.0675, (h - 0.18) / 2] })
    b.box('frame', { size: [w, 0.03, h], at: [0, -0.05, 0] })
    b.box('canvas', { size: [w - 0.06, 0.02, h - 0.06], at: [0, -0.075, 0.03] })
  },
}

export const artSquare: CatalogItem = {
  id: 'art-square',
  name: 'Canvas, square',
  category: 'decor',
  dims: { w: 0.8, d: 0.2, h: 0.8 },
  wallSnap: true,
  defaultElevation: 1.1,
  imageSlot: 'canvas',
  materials: { frame: 'woodLight', canvas: 'canvas' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [0.3, 0.135, 0.2], at: [0, d / 2 - 0.0675, (h - 0.2) / 2] })
    b.box('frame', { size: [w, 0.03, h], at: [0, -0.05, 0] })
    b.box('canvas', { size: [w - 0.04, 0.02, h - 0.04], at: [0, -0.075, 0.02] })
  },
}

export const DECOR_ITEMS: CatalogItem[] = [artPortrait, artLandscape, artSquare]
