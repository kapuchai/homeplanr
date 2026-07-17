import type { CatalogItem } from '../types'

/** M5 additions: bedroom, office, kitchen, bathroom. */

export const bedSingle: CatalogItem = {
  id: 'bed-single',
  name: 'Bed, single',
  category: 'bedroom',
  dims: { w: 0.97, d: 2.06, h: 0.95 },
  wallSnap: true,
  materials: { frame: 'woodLight', mattress: 'linen', pillow: 'whiteLacquer' },
  build3d: (b, { w, d, h }) => {
    b.box('frame', { size: [w, d, 0.2], at: [0, 0, 0.08] })
    b.box('frame', { size: [0.06, d, 0.08], at: [-(w / 2 - 0.06), 0, 0] })
    b.box('frame', { size: [0.06, d, 0.08], at: [w / 2 - 0.06, 0, 0] })
    b.box('mattress', { size: [w - 0.06, d - 0.08, 0.2], at: [0, -0.02, 0.28], round: 0.05 })
    b.box('frame', { size: [w, 0.05, h], at: [0, d / 2 - 0.025, 0] })
    b.box('pillow', { size: [w * 0.7, 0.36, 0.11], at: [0, d / 2 - 0.3, 0.5], round: 0.05 })
  },
}

export const nightstand: CatalogItem = {
  id: 'nightstand',
  name: 'Nightstand',
  category: 'bedroom',
  dims: { w: 0.45, d: 0.4, h: 0.55 },
  wallSnap: true,
  materials: { body: 'woodLight', handle: 'metal' },
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d, h - 0.08], at: [0, 0, 0.08] })
    b.mirrorX(() => b.box('body', { size: [0.04, 0.04, 0.08], at: [w / 2 - 0.06, d / 2 - 0.06, 0] }))
    b.mirrorX(() => b.box('body', { size: [0.04, 0.04, 0.08], at: [w / 2 - 0.06, -(d / 2 - 0.06), 0] }))
    b.box('handle', { size: [0.12, 0.02, 0.02], at: [0, -d / 2 + 0.005, h * 0.62] })
  },
}

export const desk: CatalogItem = {
  id: 'desk',
  name: 'Desk',
  category: 'office',
  dims: { w: 1.2, d: 0.6, h: 0.74 },
  wallSnap: true,
  materials: { top: 'woodLight', legs: 'metalDark' },
  build3d: (b, { w, d, h }) => {
    b.box('top', { size: [w, d, 0.035], at: [0, 0, h - 0.035] })
    b.mirrorX(() => {
      b.box('legs', { size: [0.05, d - 0.08, 0.03], at: [w / 2 - 0.05, 0, 0.02] })
      b.box('legs', { size: [0.05, 0.05, h - 0.09], at: [w / 2 - 0.05, d / 2 - 0.06, 0.05] })
      b.box('legs', { size: [0.05, 0.05, h - 0.09], at: [w / 2 - 0.05, -(d / 2 - 0.06), 0.05] })
    })
  },
}

export const deskChair: CatalogItem = {
  id: 'desk-chair',
  name: 'Office chair',
  category: 'office',
  dims: { w: 0.6, d: 0.6, h: 0.9 },
  wallSnap: false,
  materials: { seat: 'fabricGray', frame: 'metalDark' },
  build3d: (b, { w, d, h }) => {
    const seatH = 0.47
    // 5-star base — omitted from the 2D symbol (the crossing spokes read
    // as a fan in plan; seat + backrest carry the silhouette)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      b.box('frame', {
        size: [0.26, 0.05, 0.04],
        at: [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.02],
        rot: [0, 0, a],
        symbol: 'omit',
      })
    }
    b.cylinder('frame', { r: 0.025, h: seatH - 0.1, at: [0, 0, 0.04], symbol: 'omit' })
    b.box('seat', {
      size: [w - 0.12, d - 0.12, 0.09],
      at: [0, 0, seatH - 0.09],
      round: 0.035,
      symbol: 'outline',
    })
    // backrest: slightly taller than the nominal gap — the −0.12 rad rake
    // shortens vertical reach (conformance requires top ≈ h)
    b.box('seat', {
      size: [w - 0.16, 0.09, h - seatH + 0.02],
      at: [0, d / 2 - 0.16, seatH - 0.02],
      round: 0.035,
      rot: [-0.12, 0, 0],
    })
  },
}

export const kitchenCounter: CatalogItem = {
  id: 'kitchen-counter',
  name: 'Counter run',
  category: 'kitchen',
  dims: { w: 1.8, d: 0.6, h: 0.9 },
  wallSnap: true,
  family: 'counter',
  materials: { carcass: 'whiteLacquer', top: 'woodDark', handle: 'metal' },
  build3d: (b, { w, d, h }) => {
    b.box('carcass', { size: [w - 0.04, d - 0.06, 0.1], at: [0, 0.03, 0] }) // kick
    b.box('carcass', { size: [w, d - 0.03, h - 0.14], at: [0, 0.015, 0.1] })
    b.box('top', { size: [w, d, 0.04], at: [0, 0, h - 0.04] })
    for (const cx of [-w / 3, 0, w / 3]) {
      b.box('handle', { size: [0.14, 0.02, 0.02], at: [cx, -d / 2 + 0.02, h * 0.72] })
    }
  },
}

export const fridge: CatalogItem = {
  id: 'fridge',
  name: 'Fridge',
  category: 'kitchen',
  dims: { w: 0.6, d: 0.65, h: 1.8 },
  wallSnap: true,
  materials: { body: 'metal', handle: 'metalDark' },
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d, h], at: [0, 0, 0], round: 0.02 })
    b.box('handle', { size: [0.03, 0.03, 0.5], at: [-(w / 2 - 0.07), -d / 2 + 0.01, h * 0.55] })
    b.box('handle', { size: [0.03, 0.03, 0.28], at: [-(w / 2 - 0.07), -d / 2 + 0.01, h * 0.18] })
  },
}

export const bathtub: CatalogItem = {
  id: 'bathtub',
  name: 'Bathtub',
  category: 'bathroom',
  dims: { w: 1.7, d: 0.75, h: 0.58 },
  wallSnap: true,
  materials: { shell: 'ceramic' },
  build3d: (b, { w, d, h }) => {
    const t = 0.08
    b.box('shell', { size: [w, d, 0.12], at: [0, 0, 0], round: 0.02 }) // base
    b.box('shell', { size: [w, t, h - 0.12], at: [0, (d - t) / 2, 0.12], round: 0.02 })
    b.box('shell', { size: [w, t, h - 0.12], at: [0, -(d - t) / 2, 0.12], round: 0.02 })
    b.mirrorX(() =>
      b.box('shell', { size: [t, d - 2 * t, h - 0.12], at: [(w - t) / 2, 0, 0.12], round: 0.02 }),
    )
  },
}

export const MORE_ITEMS: CatalogItem[] = [
  bedSingle,
  nightstand,
  desk,
  deskChair,
  kitchenCounter,
  fridge,
  bathtub,
]
