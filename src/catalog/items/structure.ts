import type { CatalogItem, Dims, SymbolPrim } from '../types'

/**
 * Structure items (0.13.0) — storey connectors. All `connectsLevels`:
 * placed on level N they carve a stairwell in N's ceiling and N+1's floor
 * slab (derived at render) and walk mode links the two floors. Default
 * heights span a full storey (2.5 m walls + 0.3 m slab = 2.8 m) — the
 * conformance height cap is category-lifted for `structure`.
 *
 * Frame reminder: item-local meters, front = −y. Stairs ASCEND from the
 * front edge (−y, the walk-on end) toward the back (+y): the bottom tread
 * sits at the front. The symbol arrow (symbol2d hook) points up-run.
 */

/** The classic plan-notation direction arrow: shaft up the run + head.
 * Item-local coords; the run ascends front (−y) → back (+y). */
const runArrow = ({ d }: Dims): SymbolPrim[] => {
  const tail = -d * 0.38
  const head = d * 0.38
  return [
    { kind: 'line', role: 'detail', x1: 0, y1: tail, x2: 0, y2: head },
    { kind: 'line', role: 'detail', x1: 0, y1: head, x2: -0.09, y2: head - 0.16 },
    { kind: 'line', role: 'detail', x1: 0, y1: head, x2: 0.09, y2: head - 0.16 },
  ]
}

export const stairStraight: CatalogItem = {
  id: 'stair-straight',
  name: 'Stairs, straight',
  category: 'structure',
  dims: { w: 0.9, d: 2.8, h: 2.8 },
  wallSnap: true,
  connectsLevels: true,
  materials: { tread: 'woodLight', stringer: 'woodDark' },
  symbol2d: runArrow,
  build3d: (b, { w, d, h }) => {
    const steps = 14
    const rise = h / steps
    const tread = d / steps
    const stringerW = 0.05
    for (let i = 0; i < steps; i++) {
      // ascend front (−y) → back (+y); each tread's top = (i+1)·rise
      const y = -d / 2 + (i + 0.5) * tread
      b.box('tread', {
        size: [w - 2 * stringerW, tread, 0.045],
        at: [0, y, (i + 1) * rise - 0.045],
      })
    }
    // side stringers rising with the run (stepped boxes, chunky but honest)
    for (let i = 0; i < steps; i++) {
      const y = -d / 2 + (i + 0.5) * tread
      b.mirrorX(() =>
        b.box('stringer', {
          size: [stringerW, tread, (i + 1) * rise],
          at: [(w - stringerW) / 2, y, 0],
        }),
      )
    }
  },
}

export const stairL: CatalogItem = {
  id: 'stair-l',
  name: 'Stairs, L-shaped',
  category: 'structure',
  dims: { w: 2.0, d: 2.0, h: 2.8 },
  wallSnap: true,
  connectsLevels: true,
  materials: { tread: 'woodLight', stringer: 'woodDark' },
  build3d: (b, { w, d, h }) => {
    const runW = w * 0.45 // each arm's width
    const landing = runW
    const lowerSteps = 6
    const upperSteps = 6
    // lowerSteps risers up to the landing (one riser above the last lower
    // tread), then upperSteps more to the top = 13 rises total
    const rise = h / (lowerSteps + upperSteps + 1)
    const landingRise = (lowerSteps + 1) * rise
    // lower run: along the RIGHT edge, front → back
    const lowerLen = d - landing
    const treadL = lowerLen / lowerSteps
    for (let i = 0; i < lowerSteps; i++) {
      const y = -d / 2 + (i + 0.5) * treadL
      b.box('tread', {
        size: [runW, treadL, 0.045],
        at: [(w - runW) / 2, y, (i + 1) * rise - 0.045],
      })
    }
    // landing: back-right corner
    b.box('stringer', {
      size: [landing, landing, 0.09],
      at: [(w - landing) / 2, (d - landing) / 2, landingRise - 0.09],
    })
    // upper run: along the BACK edge, right → left
    const upperLen = w - landing
    const treadU = upperLen / upperSteps
    for (let i = 0; i < upperSteps; i++) {
      const x = w / 2 - landing - (i + 0.5) * treadU
      b.box('tread', {
        size: [treadU, runW, 0.045],
        at: [x, (d - runW) / 2, landingRise + (i + 1) * rise - 0.045],
      })
    }
  },
}

export const stairSpiral: CatalogItem = {
  id: 'stair-spiral',
  name: 'Stairs, spiral',
  category: 'structure',
  dims: { w: 1.5, d: 1.5, h: 2.8 },
  wallSnap: false,
  connectsLevels: true,
  materials: { tread: 'woodLight', pole: 'metalDark' },
  build3d: (b, { w, d, h }) => {
    const steps = 13
    const rise = h / steps
    const rOuter = Math.min(w, d) / 2
    const treadLen = rOuter - 0.06
    b.cylinder('pole', { r: 0.05, h, at: [0, 0, 0] })
    // one full turn over the climb, PHASED so the TOP tread points at the
    // back (+y) hole edge — the walker steps off onto the upper floor
    // there (0.13.0 feedback: the top tread must meet the stairwell edge,
    // not hang mid-air; matches the run-arrow / descend-zone convention)
    const phase = Math.PI / 2 - ((steps - 1) / steps) * Math.PI * 2
    for (let i = 0; i < steps; i++) {
      // wedge stand-in: a rotated slat from the pole outward (rot about z
      // carries the whole box)
      const a = phase + (i / steps) * Math.PI * 2
      const cx = (Math.cos(a) * (treadLen + 0.06)) / 2
      const cy = (Math.sin(a) * (treadLen + 0.06)) / 2
      b.box('tread', {
        size: [treadLen, 0.26, 0.04],
        at: [cx, cy, (i + 1) * rise - 0.04],
        rot: [0, 0, a],
      })
    }
  },
}

export const ladder: CatalogItem = {
  id: 'ladder',
  name: 'Loft ladder',
  category: 'structure',
  dims: { w: 0.5, d: 0.15, h: 2.8 },
  wallSnap: true,
  connectsLevels: true,
  materials: { rail: 'woodDark', rung: 'woodLight' },
  build3d: (b, { w, d, h }) => {
    // straight vertical ladder against its wall (front = the climb side);
    // slim by design — the footprint-coverage rule is exempted for it
    const railT = Math.min(0.045, d)
    const rungs = 9
    b.mirrorX(() =>
      b.box('rail', {
        size: [railT, railT, h],
        at: [(w - railT) / 2, (d - railT) / 2, 0],
      }),
    )
    for (let i = 1; i <= rungs; i++) {
      const t = i / (rungs + 1)
      b.box('rung', {
        size: [w - 2 * railT, 0.03, 0.035],
        at: [0, (d - railT) / 2, t * h],
      })
    }
  },
}

export const STRUCTURE_ITEMS: CatalogItem[] = [stairStraight, stairL, stairSpiral, ladder]
