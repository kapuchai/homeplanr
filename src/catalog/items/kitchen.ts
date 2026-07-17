import type { Builder } from '../builder'
import type { CatalogItem, Dims } from '../types'

/**
 * Modular counter family (0.9.0): straight runs in four widths, a corner
 * piece, and sink/cooktop modules — all 0.6 m deep with the worktop
 * surface at 0.9 m so a mixed run reads as one continuous counter, and
 * all tagged family:'counter' for the edge-kiss snap (runs click together
 * end-to-end, backs flush). The full parametric run system (continuous
 * top, appliance slots) is backlogged.
 */

const runBuild = (b: Builder, { w, d, h }: Dims): void => {
  b.box('carcass', { size: [w - 0.04, d - 0.06, 0.1], at: [0, 0.03, 0] })
  b.box('carcass', { size: [w, d - 0.03, h - 0.14], at: [0, 0.015, 0.1] })
  b.box('top', { size: [w, d, 0.04], at: [0, 0, h - 0.04] })
  const xs = w > 0.8 ? [-w / 4, w / 4] : [0]
  for (const cx of xs) {
    b.box('handle', {
      size: [Math.min(0.14, w - 0.12), 0.02, 0.02],
      at: [cx, -d / 2 + 0.02, h * 0.72],
    })
  }
}

const run = (id: string, name: string, w: number): CatalogItem => ({
  id,
  name,
  category: 'kitchen',
  dims: { w, d: 0.6, h: 0.9 },
  wallSnap: true,
  family: 'counter',
  materials: { carcass: 'whiteLacquer', top: 'woodDark', handle: 'metal' },
  build3d: runBuild,
})

export const counter30 = run('counter-30', 'Counter, 30 cm', 0.3)
export const counter60 = run('counter-60', 'Counter, 60 cm', 0.6)
export const counter90 = run('counter-90', 'Counter, 90 cm', 0.9)
export const counter120 = run('counter-120', 'Counter, 120 cm', 1.2)

export const counterCorner: CatalogItem = {
  id: 'counter-corner',
  name: 'Counter, corner',
  category: 'kitchen',
  dims: { w: 0.9, d: 0.9, h: 0.9 },
  wallSnap: true,
  family: 'counter',
  materials: { carcass: 'whiteLacquer', top: 'woodDark' },
  build3d: (b, { w, d, h }) => {
    const arm = 0.6
    // L as two NON-overlapping arms (coplanar overlaps would z-fight):
    // back arm spans the full width; the side arm fills the remainder.
    b.box('carcass', { size: [w - 0.04, arm - 0.06, 0.1], at: [0, d / 2 - arm / 2 + 0.015, 0] })
    b.box('carcass', { size: [w, arm - 0.03, h - 0.14], at: [0, d / 2 - arm / 2 + 0.015, 0.1] })
    b.box('top', { size: [w, arm, 0.04], at: [0, d / 2 - arm / 2, h - 0.04] })
    b.box('carcass', {
      size: [arm - 0.06, d - arm - 0.02, 0.1],
      at: [w / 2 - arm / 2 + 0.015, -arm / 2, 0],
    })
    b.box('carcass', {
      size: [arm - 0.03, d - arm, h - 0.14],
      at: [w / 2 - arm / 2 + 0.015, -arm / 2, 0.1],
    })
    b.box('top', { size: [arm, d - arm, 0.04], at: [w / 2 - arm / 2, -arm / 2, h - 0.04] })
  },
}

export const counterSink: CatalogItem = {
  id: 'counter-sink',
  name: 'Counter with sink',
  category: 'kitchen',
  dims: { w: 0.9, d: 0.6, h: 1.1 }, // faucet included; worktop at h − 0.2
  wallSnap: true,
  family: 'counter',
  materials: {
    carcass: 'whiteLacquer',
    top: 'woodDark',
    handle: 'metal',
    basin: 'metal',
    faucet: 'metal',
  },
  build3d: (b, { w, d, h }) => {
    const ch = h - 0.2 // structural counter height (0.9 at stock size)
    runBuild(b, { w, d, h: ch })
    // recessed basin floor below the worktop surface (kitchen-sink pattern)
    b.box('basin', { size: [0.5, 0.4, 0.015], at: [0, -0.02, ch - 0.02] })
    b.cylinder('faucet', { r: 0.015, h: h - ch, at: [0, d / 2 - 0.08, ch] })
    b.box('faucet', { size: [0.03, 0.12, 0.02], at: [0, d / 2 - 0.145, h - 0.04] })
  },
}

export const counterCooktop: CatalogItem = {
  id: 'counter-cooktop',
  name: 'Counter with cooktop',
  category: 'kitchen',
  dims: { w: 0.9, d: 0.6, h: 0.92 },
  wallSnap: true,
  family: 'counter',
  materials: {
    carcass: 'whiteLacquer',
    top: 'woodDark',
    handle: 'metal',
    burner: 'screenBlack',
  },
  build3d: (b, { w, d, h }) => {
    const ch = h - 0.02
    runBuild(b, { w, d, h: ch })
    // four burners half-proud of the worktop (stove pattern)
    const burners: [number, number, number][] = [
      [-0.18, -0.1, 0.095],
      [0.18, -0.1, 0.07],
      [-0.18, 0.14, 0.07],
      [0.18, 0.14, 0.095],
    ]
    for (const [cx, cy, r] of burners) {
      b.cylinder('burner', { r, h: 0.02, at: [cx, cy, ch] })
    }
  },
}

export const KITCHEN_ITEMS: CatalogItem[] = [
  counter30,
  counter60,
  counter90,
  counter120,
  counterCorner,
  counterSink,
  counterCooktop,
]
