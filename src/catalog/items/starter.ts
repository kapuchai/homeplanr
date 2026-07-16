import type { CatalogItem } from '../types'

/**
 * M2 starter set — six recognizable items proving the full pipeline
 * (2D symbol + 3D builder + conformance). The remaining twelve land in M5.
 * All coordinates item-local meters; front = −y; `at` = [cx, cy, bottomZ].
 */

export const sofa3: CatalogItem = {
  id: 'sofa-3',
  name: 'Sofa, 3-seat',
  category: 'living',
  dims: { w: 2.2, d: 0.95, h: 0.85 },
  wallSnap: true,
  materials: { body: 'fabricGray', cushion: 'fabricGray', feet: 'metalDark' },
  build3d: (b, { w, d, h }) => {
    const armW = 0.2
    const backD = 0.22
    const baseTop = 0.3
    const seatW = w - 2 * armW
    const cushW = seatW / 3 - 0.012
    const cushD = d - backD - 0.06
    // plinth
    b.box('body', { size: [seatW, d, baseTop - 0.02], at: [0, 0, 0.02] })
    // arms
    b.mirrorX(() =>
      b.box('body', { size: [armW, d, 0.62], at: [(w - armW) / 2, 0, 0.02], round: 0.03 }),
    )
    // back panel (back = +y)
    b.box('body', { size: [seatW, backD, h - 0.02], at: [0, (d - backD) / 2, 0.02] })
    for (const i of [-1, 0, 1]) {
      const cx = (i * seatW) / 3
      b.box('cushion', { size: [cushW, cushD, 0.17], at: [cx, -backD / 2, baseTop], round: 0.045 })
      b.box('cushion', {
        size: [cushW, 0.14, 0.32],
        at: [cx, (d - backD) / 2 - 0.11, baseTop + 0.17],
        round: 0.045,
      })
    }
  },
}

export const bedDouble: CatalogItem = {
  id: 'bed-double',
  name: 'Bed, double',
  category: 'bedroom',
  dims: { w: 1.67, d: 2.12, h: 1.0 },
  wallSnap: true,
  materials: { frame: 'woodLight', mattress: 'linen', pillow: 'whiteLacquer' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [w, d, 0.22], at: [0, 0, 0.08] }) // frame on low feet
    b.box('frame', { size: [0.06, d, 0.08], at: [-(w / 2 - 0.06), 0, 0] })
    b.box('frame', { size: [0.06, d, 0.08], at: [w / 2 - 0.06, 0, 0] })
    b.box('mattress', { size: [w - 0.08, d - 0.1, 0.24], at: [0, -0.02, 0.3], round: 0.05 })
    // headboard at the back edge
    b.box('frame', { size: [w, 0.06, h], at: [0, d / 2 - 0.03, 0] })
    // pillows
    b.mirrorX(() =>
      b.box('pillow', {
        size: [w * 0.4, 0.38, 0.12],
        at: [w * 0.23, d / 2 - 0.32, 0.54],
        round: 0.05,
      }),
    )
  },
}

export const diningTable: CatalogItem = {
  id: 'dining-table',
  name: 'Dining table',
  category: 'dining',
  dims: { w: 1.6, d: 0.9, h: 0.74 },
  wallSnap: false,
  materials: { top: 'woodLight', legs: 'woodDark' },
  build3d: (b, { w, d, h }) => {
    b.box('top', { size: [w, d, 0.04], at: [0, 0, h - 0.04] })
    const inset = 0.08
    const lx = w / 2 - inset
    const ly = d / 2 - inset
    b.mirrorX(() => {
      b.box('legs', { size: [0.06, 0.06, h - 0.04], at: [lx, ly, 0] })
      b.box('legs', { size: [0.06, 0.06, h - 0.04], at: [lx, -ly, 0] })
    })
  },
}

export const diningChair: CatalogItem = {
  id: 'dining-chair',
  name: 'Dining chair',
  category: 'dining',
  dims: { w: 0.45, d: 0.52, h: 0.88 },
  wallSnap: false,
  materials: { seat: 'fabricBeige', frame: 'woodDark' },
  build3d: (b, { w, d, h }) => {
    const seatH = 0.46
    b.box('seat', { size: [w, d - 0.06, 0.06], at: [0, -0.03, seatH - 0.06], round: 0.02 })
    const lx = w / 2 - 0.04
    const ly = (d - 0.06) / 2 - 0.04
    b.mirrorX(() => {
      b.box('frame', { size: [0.04, 0.04, seatH - 0.06], at: [lx, ly - 0.03, 0] })
      b.box('frame', { size: [0.04, 0.04, seatH - 0.06], at: [lx, -ly - 0.03, 0] })
    })
    // back rest: two stiles + a top rail, raked slightly
    b.mirrorX(() =>
      b.box('frame', {
        size: [0.04, 0.04, h - seatH],
        at: [lx, d / 2 - 0.05, seatH - 0.02],
        rot: [-0.08, 0, 0],
      }),
    )
    b.box('frame', {
      size: [w, 0.05, 0.14],
      at: [0, d / 2 - 0.032, h - 0.16],
      rot: [-0.08, 0, 0],
    })
  },
}

export const wardrobe: CatalogItem = {
  id: 'wardrobe',
  name: 'Wardrobe',
  category: 'bedroom',
  dims: { w: 1.5, d: 0.6, h: 2.2 },
  wallSnap: true,
  materials: { body: 'whiteLacquer', handles: 'metal' },
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d, h - 0.06], at: [0, 0, 0.06] })
    // plinth: kick-recessed at the front, flush with the back
    b.box('body', { size: [w - 0.1, d - 0.04, 0.06], at: [0, 0.02, 0] })
    // handles near the door split — half-proud of the front face so the
    // part stays inside the footprint contract (dims + 1cm)
    b.box('handles', { size: [0.02, 0.02, 0.3], at: [-0.05, -d / 2 + 0.005, h * 0.45] })
    b.box('handles', { size: [0.02, 0.02, 0.3], at: [0.05, -d / 2 + 0.005, h * 0.45] })
  },
}

export const toilet: CatalogItem = {
  id: 'toilet',
  name: 'Toilet',
  category: 'bathroom',
  dims: { w: 0.38, d: 0.65, h: 0.78 },
  wallSnap: true,
  materials: { ceramic: 'ceramic', seat: 'whiteLacquer' },
  build3d: (b, { w, d, h }) => {
    // tank
    b.box('ceramic', { size: [w, 0.16, 0.4], at: [0, d / 2 - 0.09, h - 0.42], round: 0.02 })
    // pedestal
    b.box('ceramic', { size: [0.16, 0.2, 0.36], at: [0, d / 2 - 0.28, 0], round: 0.02 })
    // bowl — elongated cylinder
    b.cylinder('ceramic', {
      r: w / 2 - 0.02,
      h: 0.12,
      at: [0, -d / 2 + 0.31, 0.26],
      scale: [1, 1.5, 1],
    })
    // seat
    b.box('seat', {
      size: [w, 0.5, 0.04],
      at: [0, -d / 2 + 0.3, 0.38],
      round: 0.02,
    })
  },
}

export const STARTER_ITEMS: CatalogItem[] = [
  sofa3,
  bedDouble,
  diningTable,
  diningChair,
  wardrobe,
  toilet,
]
