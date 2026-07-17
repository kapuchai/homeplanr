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

export const curtain: CatalogItem = {
  id: 'curtain',
  name: 'Curtains',
  category: 'decor',
  dims: { w: 1.6, d: 0.2, h: 2.4 },
  wallSnap: true,
  passable: true,
  windowAttach: true,
  materials: { rod: 'metalDark', fabric: 'linen' },
  build3d: (b, { w, d, h }) => {
    // brackets reach the wall (back edge); rod + gathered panel pair hang
    // just in front, floor-length
    b.mirrorX(() => {
      b.box('rod', { size: [0.04, 0.14, 0.05], at: [w / 2 - 0.06, d / 2 - 0.07, h - 0.05] })
    })
    b.cylinder('rod', { r: 0.015, h: w, at: [0, d / 2 - 0.12, h - 0.05], axis: 'x' })
    b.mirrorX(() => {
      b.box('fabric', {
        size: [w * 0.32, 0.06, h - 0.12],
        at: [w / 2 - w * 0.16 - 0.02, d / 2 - 0.14, 0.02],
      })
    })
  },
}

export const blinds: CatalogItem = {
  id: 'blinds',
  name: 'Blinds',
  category: 'decor',
  dims: { w: 1.3, d: 0.2, h: 1.4 },
  wallSnap: true,
  passable: true,
  defaultElevation: 0.85,
  materials: { case: 'whiteLacquer', slats: 'linen' },
  build3d: (b, { w, d, h }) => {
    b.box('case', { size: [w, 0.14, 0.08], at: [0, d / 2 - 0.07, h - 0.08] })
    b.box('slats', { size: [w - 0.04, 0.03, h - 0.1], at: [0, d / 2 - 0.12, 0.01] })
    // two slightly-proud bars give the slat read without coplanar faces
    b.box('slats', { size: [w - 0.04, 0.035, 0.015], at: [0, d / 2 - 0.12, h * 0.32] })
    b.box('slats', { size: [w - 0.04, 0.035, 0.015], at: [0, d / 2 - 0.12, h * 0.62] })
  },
}

export const mirrorWall: CatalogItem = {
  id: 'mirror-wall',
  name: 'Mirror, wall',
  category: 'decor',
  dims: { w: 0.6, d: 0.2, h: 0.9 },
  wallSnap: true,
  defaultElevation: 0.95,
  materials: { frame: 'metalDark', mirror: 'mirror' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [0.25, 0.135, 0.18], at: [0, d / 2 - 0.0675, (h - 0.18) / 2] })
    b.box('frame', { size: [w, 0.03, h], at: [0, -0.05, 0] })
    b.box('mirror', { size: [w - 0.04, 0.02, h - 0.04], at: [0, -0.075, 0.02] })
  },
}

export const mirrorFull: CatalogItem = {
  id: 'mirror-full',
  name: 'Mirror, full-length',
  category: 'decor',
  dims: { w: 0.5, d: 0.2, h: 1.8 },
  wallSnap: true,
  materials: { frame: 'woodLight', mirror: 'mirror' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [0.3, 0.135, 0.2], at: [0, d / 2 - 0.0675, (h - 0.2) / 2] })
    b.box('frame', { size: [w, 0.04, h], at: [0, -0.05, 0] })
    b.box('mirror', { size: [w - 0.06, 0.02, h - 0.06], at: [0, -0.08, 0.03] })
  },
}

export const ceilingLamp: CatalogItem = {
  id: 'ceiling-lamp',
  name: 'Ceiling lamp',
  category: 'decor',
  dims: { w: 0.4, d: 0.4, h: 0.5 }, // shade + cord drop
  wallSnap: false,
  // shade hangs under a 2.5m default ceiling (top = 2.5); Furniture3D has
  // no per-room ceiling lookup, so taller/lower rooms adjust elevation
  defaultElevation: 2,
  materials: { cord: 'metalDark', shade: 'metal' },
  build3d: (b, { h }) => {
    b.cylinder('shade', { r: 0.19, h: 0.2, at: [0, 0, 0] })
    b.cylinder('cord', { r: 0.008, h: h - 0.2, at: [0, 0, 0.2] })
  },
  // spot: a pendant throws its cone straight down
  emitter: { kind: 'spot', at: [0, 0, 0.04], slot: 'shade', defaultLumen: 1500 },
}

export const wallSconce: CatalogItem = {
  id: 'wall-sconce',
  name: 'Wall sconce',
  category: 'decor',
  dims: { w: 0.2, d: 0.2, h: 0.3 },
  wallSnap: true,
  // hugs the wall at head height — its 1.75–2.05m span crosses the walk
  // EYE band (1.4–1.8), and an invisible wall-hugging blocker is worse
  // than clipping a sconce (the curtains precedent)
  passable: true,
  defaultElevation: 1.75,
  materials: { mount: 'metalDark', shade: 'linen' },
  build3d: (b, { d, h }) => {
    b.box('mount', { size: [0.06, 0.03, 0.16], at: [0, d / 2 - 0.015, (h - 0.16) / 2] })
    b.cylinder('shade', { r: 0.09, h: 0.26, at: [0, -0.01, 0.04] })
  },
  emitter: { kind: 'point', at: [0, -0.01, 0.2], slot: 'shade', defaultLumen: 400 },
}

export const DECOR_ITEMS: CatalogItem[] = [
  artPortrait,
  artLandscape,
  artSquare,
  curtain,
  blinds,
  mirrorWall,
  mirrorFull,
  ceilingLamp,
  wallSconce,
]
