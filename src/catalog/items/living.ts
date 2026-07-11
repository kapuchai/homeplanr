import type { CatalogItem } from '../types'

/** M5 living-room additions. Item-local meters; front = −y; at=[cx,cy,z0]. */

export const sofa2: CatalogItem = {
  id: 'sofa-2',
  name: 'Sofa, 2-seat',
  category: 'living',
  dims: { w: 1.7, d: 0.92, h: 0.85 },
  wallSnap: true,
  materials: { body: 'fabricBeige', cushion: 'fabricBeige' },
  symbol2d: [
    { kind: 'rect', x: -0.85, y: -0.46, w: 1.7, h: 0.92, rx: 0.04, role: 'body' },
    { kind: 'rect', x: -0.85, y: 0.24, w: 1.7, h: 0.22, role: 'detail' },
    { kind: 'rect', x: -0.85, y: -0.46, w: 0.18, h: 0.92, role: 'detail' },
    { kind: 'rect', x: 0.67, y: -0.46, w: 0.18, h: 0.92, role: 'detail' },
    { kind: 'line', x1: 0, y1: -0.44, x2: 0, y2: 0.24, role: 'detail' },
  ],
  build3d: (b, { w, d, h }) => {
    const armW = 0.18
    const backD = 0.22
    const baseTop = 0.3
    const seatW = w - 2 * armW
    const cushW = seatW / 2 - 0.012
    const cushD = d - backD - 0.06
    b.box('body', { size: [seatW, d, baseTop - 0.02], at: [0, 0, 0.02] })
    b.mirrorX(() =>
      b.box('body', { size: [armW, d, 0.6], at: [(w - armW) / 2, 0, 0.02], round: 0.03 }),
    )
    b.box('body', { size: [seatW, backD, h - 0.02], at: [0, (d - backD) / 2, 0.02] })
    for (const i of [-1, 1]) {
      const cx = (i * seatW) / 4
      b.box('cushion', { size: [cushW, cushD, 0.16], at: [cx, -backD / 2, baseTop], round: 0.04 })
      b.box('cushion', {
        size: [cushW, 0.13, 0.3],
        at: [cx, (d - backD) / 2 - 0.11, baseTop + 0.16],
        round: 0.04,
      })
    }
  },
}

export const armchair: CatalogItem = {
  id: 'armchair',
  name: 'Armchair',
  category: 'living',
  dims: { w: 0.85, d: 0.85, h: 0.8 },
  wallSnap: false,
  materials: { body: 'leather', cushion: 'leather', legs: 'woodDark' },
  symbol2d: [
    { kind: 'rect', x: -0.425, y: -0.425, w: 0.85, h: 0.85, rx: 0.06, role: 'body' },
    { kind: 'rect', x: -0.425, y: 0.2, w: 0.85, h: 0.22, role: 'detail' },
    { kind: 'rect', x: -0.425, y: -0.4, w: 0.16, h: 0.8, role: 'detail' },
    { kind: 'rect', x: 0.265, y: -0.4, w: 0.16, h: 0.8, role: 'detail' },
  ],
  build3d: (b, { w, d, h }) => {
    const armW = 0.16
    const backD = 0.2
    b.box('body', { size: [w - 2 * armW, d, 0.3], at: [0, 0, 0.06] })
    b.mirrorX(() =>
      b.box('body', { size: [armW, d, 0.56], at: [(w - armW) / 2, 0, 0.06], round: 0.04 }),
    )
    b.box('body', { size: [w - 2 * armW, backD, h - 0.06], at: [0, (d - backD) / 2, 0.06], round: 0.03 })
    b.box('cushion', {
      size: [w - 2 * armW - 0.02, d - backD - 0.08, 0.14],
      at: [0, -backD / 2, 0.36],
      round: 0.04,
    })
    b.mirrorX(() => {
      b.box('legs', { size: [0.05, 0.05, 0.06], at: [w / 2 - 0.08, d / 2 - 0.08, 0] })
      b.box('legs', { size: [0.05, 0.05, 0.06], at: [w / 2 - 0.08, -(d / 2 - 0.08), 0] })
    })
  },
}

export const coffeeTable: CatalogItem = {
  id: 'coffee-table',
  name: 'Coffee table',
  category: 'living',
  dims: { w: 1.1, d: 0.6, h: 0.45 },
  wallSnap: false,
  materials: { top: 'woodDark', legs: 'metalDark' },
  symbol2d: [{ kind: 'rect', x: -0.55, y: -0.3, w: 1.1, h: 0.6, rx: 0.03, role: 'body' }],
  build3d: (b, { w, d, h }) => {
    b.box('top', { size: [w, d, 0.035], at: [0, 0, h - 0.035] })
    b.box('top', { size: [w - 0.16, d - 0.16, 0.03], at: [0, 0, h * 0.45] }) // shelf
    b.mirrorX(() => {
      b.box('legs', { size: [0.04, 0.04, h - 0.035], at: [w / 2 - 0.06, d / 2 - 0.06, 0] })
      b.box('legs', { size: [0.04, 0.04, h - 0.035], at: [w / 2 - 0.06, -(d / 2 - 0.06), 0] })
    })
  },
}

export const tvStand: CatalogItem = {
  id: 'tv-stand',
  name: 'TV stand + TV',
  category: 'living',
  dims: { w: 1.6, d: 0.42, h: 1.2 },
  wallSnap: true,
  materials: { body: 'woodDark', screen: 'screenBlack', legs: 'metalDark' },
  symbol2d: [
    { kind: 'rect', x: -0.8, y: -0.21, w: 1.6, h: 0.42, role: 'body' },
    { kind: 'line', x1: -0.55, y1: 0.12, x2: 0.55, y2: 0.12, role: 'detail' },
  ],
  build3d: (b, { w, d, h }) => {
    const standH = 0.45
    b.box('body', { size: [w, d, standH - 0.1], at: [0, 0, 0.1] })
    b.mirrorX(() => b.box('legs', { size: [0.04, 0.04, 0.1], at: [w / 2 - 0.1, 0, 0] }))
    // TV panel standing on the unit, against the back edge
    b.box('screen', { size: [w * 0.72, 0.045, h - standH - 0.05], at: [0, d / 2 - 0.08, standH + 0.05] })
    b.box('legs', { size: [0.3, 0.16, 0.05], at: [0, d / 2 - 0.1, standH] })
  },
}

export const bookshelf: CatalogItem = {
  id: 'bookshelf',
  name: 'Bookshelf',
  category: 'living',
  dims: { w: 0.8, d: 0.32, h: 2.02 },
  wallSnap: true,
  materials: { body: 'woodLight' },
  symbol2d: [
    { kind: 'rect', x: -0.4, y: -0.16, w: 0.8, h: 0.32, role: 'body' },
    { kind: 'line', x1: -0.4, y1: 0, x2: 0.4, y2: 0, role: 'detail' },
  ],
  build3d: (b, { w, d, h }) => {
    const t = 0.025
    b.box('body', { size: [t, d, h], at: [-(w / 2 - t / 2), 0, 0] })
    b.box('body', { size: [t, d, h], at: [w / 2 - t / 2, 0, 0] })
    b.box('body', { size: [w, d, t], at: [0, 0, 0] })
    b.box('body', { size: [w, d, t], at: [0, 0, h - t] })
    b.box('body', { size: [w - 2 * t, 0.02, h - 2 * t], at: [0, d / 2 - 0.01, t] }) // back
    for (let i = 1; i <= 4; i++) {
      b.box('body', { size: [w - 2 * t, d - 0.02, t], at: [0, 0.01, (h / 5) * i] })
    }
  },
}

export const LIVING_ITEMS: CatalogItem[] = [sofa2, armchair, coffeeTable, tvStand, bookshelf]
