import type { CatalogItem } from '../types'

/**
 * M5-R expansion — kitchen, bathroom, living, dining, bedroom, office.
 * Item-local meters; front = −y; at = [cx, cy, bottomZ].
 * Symbols are DERIVED from the parts (symbolFromParts) — the deprecated
 * symbol2d field stays empty for these items.
 */

export const stove: CatalogItem = {
  id: 'stove',
  name: 'Stove',
  category: 'kitchen',
  dims: { w: 0.6, d: 0.6, h: 0.85 }, // 60×60×85 cm
  wallSnap: true,
  materials: {
    body: 'whiteLacquer',
    cooktop: 'metalDark',
    burner: 'screenBlack',
    door: 'whiteLacquer',
    window: 'screenBlack',
    handle: 'metal',
  },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d - 0.02, h - 0.03], at: [0, 0.01, 0] })
    b.box('cooktop', { size: [w, d, 0.03], at: [0, 0, h - 0.03] })
    // 4 burners, two sizes, half-sunk into the cooktop
    const burners: [number, number, number][] = [
      [-0.14, -0.12, 0.095],
      [0.14, -0.12, 0.07],
      [-0.14, 0.15, 0.07],
      [0.14, 0.15, 0.095],
    ]
    for (const [cx, cy, r] of burners) {
      b.cylinder('burner', { r, h: 0.012, at: [cx, cy, h - 0.006] })
    }
    // oven door inset 1cm behind the footprint front, window + handle on it
    b.box('door', { size: [0.5, 0.02, 0.45], at: [0, -d / 2 + 0.02, 0.12] })
    b.box('window', { size: [0.36, 0.012, 0.18], at: [0, -d / 2 + 0.013, 0.25] })
    b.box('handle', { size: [0.44, 0.022, 0.022], at: [0, -d / 2 + 0.015, 0.6] })
  },
}

export const kitchenSink: CatalogItem = {
  id: 'kitchen-sink',
  name: 'Kitchen sink',
  category: 'kitchen',
  dims: { w: 0.6, d: 0.6, h: 0.9 }, // 60×60×90 cm (faucet included)
  wallSnap: true,
  materials: { counter: 'whiteLacquer', top: 'woodLight', basin: 'metal', faucet: 'metal' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    const topZ = 0.72 // counter surface; faucet rises to h
    b.box('counter', { size: [w, d, topZ], at: [0, 0, 0] })
    // worktop as a frame around the basin cutout
    b.box('top', { size: [w, 0.1, 0.03], at: [0, -d / 2 + 0.05, topZ] })
    b.box('top', { size: [w, 0.12, 0.03], at: [0, d / 2 - 0.06, topZ] })
    b.box('top', { size: [0.07, d - 0.22, 0.03], at: [-w / 2 + 0.035, -0.01, topZ] })
    b.box('top', { size: [0.07, d - 0.22, 0.03], at: [w / 2 - 0.035, -0.01, topZ] })
    // recessed basin floor, 3cm below the worktop surface
    b.box('basin', { size: [0.46, 0.38, 0.015], at: [0, -0.01, topZ - 0.015] })
    b.cylinder('faucet', { r: 0.015, h: h - topZ, at: [0, d / 2 - 0.06, topZ] })
    b.box('faucet', { size: [0.03, 0.1, 0.02], at: [0, d / 2 - 0.115, h - 0.04] })
  },
}

export const kitchenIsland: CatalogItem = {
  id: 'kitchen-island',
  name: 'Kitchen island',
  category: 'kitchen',
  dims: { w: 1.8, d: 0.9, h: 0.9 }, // 180×90×90 cm
  wallSnap: false,
  materials: { body: 'whiteLacquer', top: 'woodLight' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w - 0.12, d - 0.12, 0.1], at: [0, 0, 0] }) // inset toe-kick
    b.box('body', { size: [w - 0.08, d - 0.08, h - 0.14], at: [0, 0, 0.1] })
    b.box('top', { size: [w, d, 0.04], at: [0, 0, h - 0.04] }) // 4cm overhang
  },
}

export const wallCabinet: CatalogItem = {
  id: 'wall-cabinet',
  name: 'Wall cabinet',
  category: 'kitchen',
  dims: { w: 0.8, d: 0.35, h: 0.7 }, // 80×35×70 cm
  wallSnap: true,
  defaultElevation: 1.45,
  materials: { carcass: 'whiteLacquer', door: 'linen', handle: 'metal' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('carcass', { size: [w, d - 0.01, h], at: [0, 0.005, 0] })
    // two door fronts, 1cm proud of the carcass
    b.box('door', { size: [0.37, 0.02, h - 0.04], at: [-0.195, -d / 2 + 0.01, 0.02] })
    b.box('door', { size: [0.37, 0.02, h - 0.04], at: [0.195, -d / 2 + 0.01, 0.02] })
    // handles low on the doors, near the split
    b.box('handle', { size: [0.018, 0.018, 0.1], at: [-0.05, -d / 2, 0.06] })
    b.box('handle', { size: [0.018, 0.018, 0.1], at: [0.05, -d / 2, 0.06] })
  },
}

export const washbasin: CatalogItem = {
  id: 'washbasin',
  name: 'Washbasin',
  category: 'bathroom',
  dims: { w: 0.55, d: 0.45, h: 0.85 }, // 55×45×85 cm
  wallSnap: true,
  materials: { ceramic: 'ceramic', faucet: 'metal' },
  symbol2d: [],
  build3d: (b, { d, h }) => {
    b.box('ceramic', { size: [0.14, 0.18, 0.66], at: [0, d / 2 - 0.16, 0] }) // pedestal
    // squashed-cylinder bowl, back rim at the wall
    b.cylinder('ceramic', {
      r: 0.26,
      h: 0.12,
      at: [0, d / 2 - 0.215, 0.66],
      scale: [1, 0.8, 1],
    })
    b.cylinder('faucet', { r: 0.015, h: 0.11, at: [0, d / 2 - 0.065, h - 0.11] })
    b.box('faucet', { size: [0.024, 0.09, 0.02], at: [0, d / 2 - 0.11, h - 0.05] })
  },
}

export const shower: CatalogItem = {
  id: 'shower',
  name: 'Shower',
  category: 'bathroom',
  dims: { w: 0.9, d: 0.9, h: 2.1 }, // 90×90×210 cm
  wallSnap: true,
  materials: { tray: 'ceramic', glass: 'glass', frame: 'metal' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('tray', { size: [w, d, 0.05], at: [0, 0, 0] })
    // corner posts to full height
    b.mirrorX(() => {
      b.box('frame', { size: [0.04, 0.04, h - 0.05], at: [w / 2 - 0.02, d / 2 - 0.02, 0.05] })
      b.box('frame', { size: [0.04, 0.04, h - 0.05], at: [w / 2 - 0.02, -(d / 2 - 0.02), 0.05] })
    })
    // two thin glass panels: front + side (+x)
    b.box('glass', { size: [w - 0.12, 0.012, h - 0.35], at: [0, -d / 2 + 0.02, 0.05] })
    b.box('glass', { size: [0.012, d - 0.12, h - 0.35], at: [w / 2 - 0.02, 0, 0.05] })
    // shower head + arm from the back wall
    b.box('frame', { size: [0.02, 0.16, 0.02], at: [0, d / 2 - 0.14, h - 0.18] })
    b.cylinder('frame', { r: 0.07, h: 0.02, at: [0, d / 2 - 0.2, h - 0.2] })
  },
}

export const washingMachine: CatalogItem = {
  id: 'washing-machine',
  name: 'Washing machine',
  category: 'bathroom',
  dims: { w: 0.6, d: 0.6, h: 0.85 }, // 60×60×85 cm
  wallSnap: true,
  materials: { body: 'whiteLacquer', ring: 'metalDark', eye: 'glass', panel: 'metalDark' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d - 0.02, h], at: [0, 0.01, 0] })
    // porthole: dark ring disc with a glass eye proud of it
    b.cylinder('ring', { r: 0.17, h: 0.015, at: [0, -d / 2 + 0.0125, 0.4], axis: 'y' })
    b.cylinder('eye', { r: 0.13, h: 0.012, at: [0, -d / 2 + 0.004, 0.415], axis: 'y' })
    b.box('panel', { size: [w - 0.08, 0.02, 0.08], at: [0, -d / 2 + 0.01, 0.72] })
  },
}

export const sofaCorner: CatalogItem = {
  id: 'sofa-corner',
  name: 'Sofa, corner',
  category: 'living',
  dims: { w: 2.6, d: 1.6, h: 0.85 }, // 260×160×85 cm
  wallSnap: true,
  materials: { body: 'fabricGray', cushion: 'fabricGray', feet: 'metalDark' },
  symbol2d: [],
  // chaise pinned on +x — handedness comes from the instance-level
  // `mirrored` flag, so no builder.mirrorX here.
  build3d: (b, { w, d, h }) => {
    const runD = 0.95 // 3-seat run along the back edge
    const backD = 0.22
    const feetH = 0.04
    // feet under the run + chaise corners
    const feet: [number, number][] = [
      [-(w / 2 - 0.05), d / 2 - 0.1],
      [w / 2 - 0.05, d / 2 - 0.1],
      [-(w / 2 - 0.05), d / 2 - runD + 0.1],
      [w / 2 - 0.85, -(d / 2 - 0.08)],
      [w / 2 - 0.05, -(d / 2 - 0.08)],
    ]
    for (const [fx, fy] of feet) b.box('feet', { size: [0.05, 0.05, feetH], at: [fx, fy, 0] })
    // plinth run along the back
    b.box('body', { size: [w, runD, 0.26], at: [0, d / 2 - runD / 2, feetH] })
    // back panel (back = +y)
    b.box('body', { size: [w, backD, h - feetH], at: [0, d / 2 - backD / 2, feetH] })
    // arm on the −x end
    b.box('body', { size: [0.2, runD, 0.54], at: [-(w / 2 - 0.1), d / 2 - runD / 2, feetH], round: 0.03 })
    // chaise wing on +x, reaching the front edge
    const chaiseD = d - runD
    b.box('body', { size: [0.8, chaiseD, 0.26], at: [w / 2 - 0.4, -d / 2 + chaiseD / 2, feetH] })
    // seat cushions: 3 across the run + 1 on the chaise
    const seatZ = feetH + 0.26
    const cushD = runD - backD - 0.08
    for (const cx of [-0.7, 0.1, 0.9]) {
      b.box('cushion', {
        size: [0.78, cushD, 0.17],
        at: [cx, d / 2 - backD - cushD / 2 - 0.02, seatZ],
        round: 0.045,
      })
      b.box('cushion', {
        size: [0.78, 0.14, 0.31],
        at: [cx, d / 2 - backD - 0.07, seatZ + 0.17],
        round: 0.045,
      })
    }
    b.box('cushion', {
      size: [0.76, chaiseD - 0.04, 0.17],
      at: [w / 2 - 0.4, -d / 2 + chaiseD / 2, seatZ],
      round: 0.045,
    })
  },
}

export const floorLamp: CatalogItem = {
  id: 'floor-lamp',
  name: 'Floor lamp',
  category: 'living',
  dims: { w: 0.35, d: 0.35, h: 1.6 }, // 35×35×160 cm
  wallSnap: false,
  materials: { base: 'metalDark', pole: 'metal', shade: 'linen' },
  symbol2d: [],
  build3d: (b, { h }) => {
    b.cylinder('base', { r: 0.17, h: 0.02, at: [0, 0, 0] })
    b.cylinder('pole', { r: 0.015, h: h - 0.3, at: [0, 0, 0.02] })
    b.cylinder('shade', { r: 0.16, h: 0.28, at: [0, 0, h - 0.28] })
  },
}

export const plant: CatalogItem = {
  id: 'plant',
  name: 'Plant',
  category: 'living',
  dims: { w: 0.4, d: 0.4, h: 1.2 }, // 40×40×120 cm
  wallSnap: false,
  materials: { pot: 'ceramic', leaves: 'foliage' },
  symbol2d: [],
  build3d: (b, { h }) => {
    b.cylinder('pot', { r: 0.14, h: 0.3, at: [0, 0, 0] })
    // stacked squashed foliage tiers
    b.cylinder('leaves', { r: 0.2, h: 0.34, at: [0, 0, 0.26] })
    b.cylinder('leaves', { r: 0.17, h: 0.3, at: [0, 0, 0.56], scale: [1, 0.92, 1] })
    b.cylinder('leaves', { r: 0.12, h: 0.36, at: [0, 0, h - 0.36] })
  },
}

export const rug: CatalogItem = {
  id: 'rug',
  name: 'Rug',
  category: 'living',
  dims: { w: 2.0, d: 1.4, h: 0.02 }, // 200×140×2 cm — flat floor covering
  wallSnap: false,
  materials: { pile: 'fabricBeige' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('pile', { size: [w, d, h], at: [0, 0, 0], round: 0.01 })
  },
}

export const tvWall: CatalogItem = {
  id: 'tv-wall',
  name: 'TV, wall-mounted',
  category: 'living',
  // 125×20×75 cm — depth is the conformance floor (0.2m), screen sits
  // proud of the wall on its mount box
  dims: { w: 1.25, d: 0.2, h: 0.75 },
  wallSnap: true,
  defaultElevation: 1.1,
  materials: { screen: 'screenBlack', frame: 'metalDark' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    // mount box reaching the back (wall) edge
    b.box('frame', { size: [0.4, 0.135, 0.28], at: [0, d / 2 - 0.0675, (h - 0.28) / 2] })
    b.box('frame', { size: [w, 0.03, h], at: [0, -0.05, 0] })
    // screen slab at the front, inside the frame bezel
    b.box('screen', { size: [w - 0.06, 0.02, h - 0.06], at: [0, -0.075, 0.03] })
  },
}

export const sideTable: CatalogItem = {
  id: 'side-table',
  name: 'Side table',
  category: 'living',
  dims: { w: 0.5, d: 0.5, h: 0.55 }, // 50×50×55 cm
  wallSnap: false,
  materials: { top: 'woodLight', frame: 'metalDark' },
  symbol2d: [],
  build3d: (b, { w, h }) => {
    b.cylinder('top', { r: w / 2, h: 0.03, at: [0, 0, h - 0.03] })
    b.cylinder('frame', { r: 0.025, h: h - 0.05, at: [0, 0, 0.02] })
    b.cylinder('frame', { r: 0.15, h: 0.02, at: [0, 0, 0] })
  },
}

export const diningTableRound: CatalogItem = {
  id: 'dining-table-round',
  name: 'Dining table, round',
  category: 'dining',
  dims: { w: 1.2, d: 1.2, h: 0.74 }, // ⌀120×74 cm
  wallSnap: false,
  materials: { top: 'woodLight', pedestal: 'woodDark' },
  symbol2d: [],
  build3d: (b, { w, h }) => {
    b.cylinder('top', { r: w / 2, h: 0.035, at: [0, 0, h - 0.035] })
    b.cylinder('pedestal', { r: 0.07, h: h - 0.095, at: [0, 0, 0.06] })
    b.cylinder('pedestal', { r: 0.3, h: 0.06, at: [0, 0, 0] })
  },
}

export const barStool: CatalogItem = {
  id: 'bar-stool',
  name: 'Bar stool',
  category: 'dining',
  dims: { w: 0.4, d: 0.4, h: 0.75 }, // 40×40×75 cm
  wallSnap: false,
  materials: { seat: 'leather', frame: 'metalDark' },
  symbol2d: [],
  build3d: (b, { h }) => {
    b.cylinder('seat', { r: 0.17, h: 0.05, at: [0, 0, h - 0.05] })
    b.cylinder('frame', { r: 0.02, h: h - 0.08, at: [0, 0, 0.03] })
    b.cylinder('frame', { r: 0.13, h: 0.012, at: [0, 0, 0.2] }) // foot-ring
    b.cylinder('frame', { r: 0.17, h: 0.03, at: [0, 0, 0] })
  },
}

export const dresser: CatalogItem = {
  id: 'dresser',
  name: 'Dresser',
  category: 'bedroom',
  dims: { w: 1.2, d: 0.5, h: 0.8 }, // 120×50×80 cm
  wallSnap: true,
  materials: { carcass: 'woodLight', drawer: 'whiteLacquer', handle: 'metal' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    // low feet
    b.mirrorX(() => {
      b.box('carcass', { size: [0.05, 0.05, 0.06], at: [w / 2 - 0.07, d / 2 - 0.07, 0] })
      b.box('carcass', { size: [0.05, 0.05, 0.06], at: [w / 2 - 0.07, -(d / 2 - 0.07), 0] })
    })
    b.box('carcass', { size: [w, d - 0.02, h - 0.06], at: [0, 0.01, 0.06] })
    // 2×3 drawer fronts, 1cm proud, with handle bars
    for (const cx of [-0.4, 0, 0.4]) {
      for (const z of [0.1, 0.44]) {
        b.box('drawer', { size: [0.36, 0.02, 0.3], at: [cx, -d / 2 + 0.01, z] })
        b.box('handle', { size: [0.1, 0.015, 0.015], at: [cx, -d / 2, z + 0.22] })
      }
    }
  },
}

export const filingCabinet: CatalogItem = {
  id: 'filing-cabinet',
  name: 'Filing cabinet',
  category: 'office',
  dims: { w: 0.4, d: 0.5, h: 0.6 }, // 40×50×60 cm
  wallSnap: false,
  materials: { body: 'metalDark', drawer: 'metalDark', handle: 'metal' },
  symbol2d: [],
  build3d: (b, { w, d, h }) => {
    b.box('body', { size: [w, d - 0.02, h], at: [0, 0.01, 0] })
    // 3 drawer fronts, 1cm proud, with handle bars
    for (const z of [0.055, 0.23, 0.405]) {
      b.box('drawer', { size: [w - 0.06, 0.02, 0.155], at: [0, -d / 2 + 0.01, z] })
      b.box('handle', { size: [0.12, 0.015, 0.02], at: [0, -d / 2, z + 0.1] })
    }
  },
}

export const EXPANSION_ITEMS: CatalogItem[] = [
  stove,
  kitchenSink,
  kitchenIsland,
  wallCabinet,
  washbasin,
  shower,
  washingMachine,
  sofaCorner,
  floorLamp,
  plant,
  rug,
  tvWall,
  sideTable,
  diningTableRound,
  barStool,
  dresser,
  filingCabinet,
]
