import { beforeEach, describe, expect, it } from 'vitest'
import { emptyDocument, type ProjectDocument, type Wall } from '../model/types'
import { addWallChain, addWallSegment } from '../model/mutations/walls'
import { addOpening } from '../model/mutations/openings'
import { addFurniture, transformFurniture } from '../model/mutations/furniture'
import { getDerived, resetDerivedForTests } from '../store/derived'
import { useAppSettings } from '../store/appSettings'
import { openingSymbol } from '../editor2d/render/planGeometry'
import { docContentBounds } from '../editor2d/render/bounds'
import { polygonBounds } from '../geometry/polygon'
import { vec } from '../geometry/vec'
import { CATALOG } from '../catalog'
import { symbolFor } from '../catalog/symbolFromParts'
import { getTheme2d } from '../theme/theme2d'
import { formatArea } from '../format/units'
import { exportPixelSize, renderPlanSvg } from './exportPlanSvg'
import { addDimension, addLabel } from '../model/mutations/annotations'

/** The exporter is pinned to the LIGHT theme (accent-independent tokens). */
const theme = getTheme2d('light', 'blue')

const count = (s: string, needle: string): number => s.split(needle).length - 1

const wallBetween = (doc: ProjectDocument, a: { x: number; y: number }, b: { x: number; y: number }): Wall => {
  const hit = Object.values(doc.walls).find((w) => {
    const na = doc.nodes[w.a]!
    const nb = doc.nodes[w.b]!
    const at = (n: { x: number; y: number }, p: { x: number; y: number }) =>
      Math.abs(n.x - p.x) < 1e-9 && Math.abs(n.y - p.y) < 1e-9
    return (at(na, a) && at(nb, b)) || (at(na, b) && at(nb, a))
  })
  if (!hit) throw new Error('fixture wall not found')
  return hit
}

/** 4×3 room + door (bottom wall) + window (right wall) + sofa. */
function roomFixture(): ProjectDocument {
  const doc = emptyDocument('p_export', 'Export Fixture', '2026-07-12T00:00:00.000Z')
  addWallChain(doc, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
  addOpening(doc, {
    kind: 'door',
    wallId: wallBetween(doc, vec(0, 0), vec(4, 0)).id,
    t: 0.5,
    width: 0.9,
    hinge: 'a',
    swing: 'front',
  })
  addOpening(doc, {
    kind: 'window',
    wallId: wallBetween(doc, vec(4, 0), vec(4, 3)).id,
    t: 0.5,
  })
  addFurniture(doc, { catalogItemId: 'sofa-3', x: 2, y: 1.5, size: CATALOG['sofa-3']!.dims })
  return doc
}

/** Standalone 4m wall with one door — the sweep/parity workhorse. */
function doorFixture(hinge: 'a' | 'b', swing: 'front' | 'back'): {
  doc: ProjectDocument
  wall: Wall
} {
  const doc = emptyDocument('p_door', 'Door', '2026-07-12T00:00:00.000Z')
  addWallSegment(doc, vec(0, 0), vec(4, 0))
  const wall = Object.values(doc.walls)[0]!
  addOpening(doc, { kind: 'door', wallId: wall.id, t: 0.5, width: 0.9, hinge, swing })
  return { doc, wall }
}

beforeEach(() => {
  resetDerivedForTests()
  useAppSettings.getState().setShowDimensions(false)
})

describe('openingSymbol — WorldLayers parity pin', () => {
  it('reproduces the pre-refactor OpeningsLayer/WallsLayer door constants', () => {
    // Expected values transcribed by hand from WorldLayers.tsx BEFORE the
    // planGeometry extraction (commit 18b65a9): wall (0,0)→(4,0) thickness
    // 0.15 ⇒ half=0.075, cover half=0.077; door t=0.5 w=0.9 hinge 'a'
    // swing 'front' ⇒ u0=1.55 u1=2.45, hinge jamb (1.55, 0.075), leaf end
    // (1.55, 0.975), far (2.45, 0.075), arc r=0.9, sweep=0.
    const { doc, wall } = doorFixture('a', 'front')
    expect(doc.nodes[wall.a]!.x).toBe(0) // a→b orientation guard
    const solid = getDerived(doc).wallSolids[wall.id]!
    const realized = solid.openings[0]!
    const sym = openingSymbol(solid, wall, realized, doc.openings[realized.openingId]!)

    expect(realized.u0).toBeCloseTo(1.55, 9)
    expect(realized.u1).toBeCloseTo(2.45, 9)

    const expectPt = (p: { x: number; y: number }, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x, 9)
      expect(p.y).toBeCloseTo(y, 9)
    }
    // cover rect: WallsLayer order u0/-h, u1/-h, u1/h, u0/h with h=0.077
    expectPt(sym.coverRect[0]!, 1.55, -0.077)
    expectPt(sym.coverRect[1]!, 2.45, -0.077)
    expectPt(sym.coverRect[2]!, 2.45, 0.077)
    expectPt(sym.coverRect[3]!, 1.55, 0.077)
    // jamb ticks across the wall at both ends of the gap
    expectPt({ x: sym.jambs[0].x1, y: sym.jambs[0].y1 }, 1.55, -0.075)
    expectPt({ x: sym.jambs[0].x2, y: sym.jambs[0].y2 }, 1.55, 0.075)
    expectPt({ x: sym.jambs[1].x1, y: sym.jambs[1].y1 }, 2.45, -0.075)
    expectPt({ x: sym.jambs[1].x2, y: sym.jambs[1].y2 }, 2.45, 0.075)
    // leaf open 90° from the hinge jamb corner, arc back to the far jamb
    expect(sym.windowLines).toBeUndefined()
    const door = sym.door!
    expectPt({ x: door.leaf.x1, y: door.leaf.y1 }, 1.55, 0.075)
    expectPt({ x: door.leaf.x2, y: door.leaf.y2 }, 1.55, 0.975)
    expectPt(door.arc.from, 1.55, 0.975)
    expectPt(door.arc.to, 2.45, 0.075)
    expect(door.arc.r).toBeCloseTo(0.9, 9)
    expect(door.arc.sweep).toBe(0)
  })

  it('reproduces the pre-refactor window triple lines', () => {
    // window t=0.5 default width 1.2 on the same wall ⇒ u0=1.4 u1=2.6,
    // glazing lines at v ∈ {−0.0375, 0, 0.0375}
    const doc = emptyDocument('p_win', 'Win', '2026-07-12T00:00:00.000Z')
    addWallSegment(doc, vec(0, 0), vec(4, 0))
    const wall = Object.values(doc.walls)[0]!
    addOpening(doc, { kind: 'window', wallId: wall.id, t: 0.5 })
    const solid = getDerived(doc).wallSolids[wall.id]!
    const realized = solid.openings[0]!
    const sym = openingSymbol(solid, wall, realized, doc.openings[realized.openingId]!)
    expect(sym.door).toBeUndefined()
    const lines = sym.windowLines!
    expect(lines).toHaveLength(3)
    const vs = [-0.0375, 0, 0.0375]
    lines.forEach((l, i) => {
      expect(l.x1).toBeCloseTo(1.4, 9)
      expect(l.x2).toBeCloseTo(2.6, 9)
      expect(l.y1).toBeCloseTo(vs[i]!, 9)
      expect(l.y2).toBeCloseTo(vs[i]!, 9)
    })
  })
})

describe('door-arc sweep matrix (empirically pinned — see RUNBOOK)', () => {
  const MATRIX = [
    { hinge: 'a', swing: 'front', sweep: 0 },
    { hinge: 'a', swing: 'back', sweep: 1 },
    { hinge: 'b', swing: 'front', sweep: 1 },
    { hinge: 'b', swing: 'back', sweep: 0 },
  ] as const

  for (const c of MATRIX) {
    it(`hinge=${c.hinge} swing=${c.swing} → sweep ${c.sweep}, in symbol AND rendered SVG`, () => {
      const { doc, wall } = doorFixture(c.hinge, c.swing)
      const derived = getDerived(doc)
      const solid = derived.wallSolids[wall.id]!
      const realized = solid.openings[0]!
      const sym = openingSymbol(solid, wall, realized, doc.openings[realized.openingId]!)
      expect(sym.door!.arc.sweep).toBe(c.sweep)
      const svg = renderPlanSvg(doc, derived)!
      const arc = svg.match(/ A [\d.eE+-]+ [\d.eE+-]+ 0 0 ([01]) /)
      expect(arc?.[1]).toBe(String(sym.door!.arc.sweep))
    })
  }
})

describe('renderPlanSvg', () => {
  it('returns null for an empty document', () => {
    const doc = emptyDocument('p_empty', 'Empty', '2026-07-12T00:00:00.000Z')
    expect(renderPlanSvg(doc, getDerived(doc))).toBeNull()
  })

  it('is deterministic', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    expect(renderPlanSvg(doc, derived)).toBe(renderPlanSvg(doc, derived))
  })

  it('opens with the paper rect, then one y-flip content group', () => {
    const doc = roomFixture()
    const svg = renderPlanSvg(doc, getDerived(doc))!
    const body = svg.slice(svg.indexOf('>') + 1)
    expect(body.startsWith('<rect ')).toBe(true)
    expect(body.slice(0, body.indexOf('/>'))).toContain(`fill="${theme.paper}"`)
    expect(count(svg, '<g transform="scale(1 -1)">')).toBe(1)
  })

  it('viewBox = content bounds + margin, y-flipped', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    const b = polygonBounds(docContentBounds(doc, derived))!
    const m = 0.5
    const svg = renderPlanSvg(doc, derived)!
    expect(svg).toContain(
      `viewBox="${b.minX - m} ${-b.maxY - m} ${b.maxX - b.minX + 2 * m} ${b.maxY - b.minY + 2 * m}"`,
    )
    // custom margin
    const m2 = 1.25
    expect(renderPlanSvg(doc, derived, { marginM: m2 })).toContain(
      `viewBox="${b.minX - m2} ${-b.maxY - m2}`,
    )
  })

  it('draws exactly one wall path and one paper cover per opening', () => {
    const doc = roomFixture()
    const svg = renderPlanSvg(doc, getDerived(doc))!
    expect(count(svg, `fill="${theme.wall}"`)).toBe(1)
    // paper fill: 1 background rect + 1 cover per opening (door + window)
    expect(count(svg, `fill="${theme.paper}"`)).toBe(3)
  })

  it('renders the door leaf/arc and the window triple lines', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    const svg = renderPlanSvg(doc, derived)!
    // door arc present exactly once, sweep matches openingSymbol
    const doorWall = wallBetween(doc, vec(0, 0), vec(4, 0))
    const solid = derived.wallSolids[doorWall.id]!
    const realized = solid.openings[0]!
    const sym = openingSymbol(solid, doorWall, realized, doc.openings[realized.openingId]!)
    const arcs = svg.match(/ A [\d.eE+-]+ [\d.eE+-]+ 0 0 [01] /g)
    expect(arcs).toHaveLength(1)
    expect(arcs![0]).toContain(` 0 0 ${sym.door!.arc.sweep} `)
    // ink strokes: 2 jambs × 2 openings + door leaf + door arc + 3 window
    // lines = 9 (furniture symbols use the symbol* tokens, not text ink)
    expect(count(svg, `stroke="${theme.text}"`)).toBe(9)
  })

  it('renders room fill + name + area label (counter-flipped)', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    const svg = renderPlanSvg(doc, derived)!
    const room = Object.values(derived.rooms)[0]!
    expect(svg).toContain(`fill-opacity="0.6"`)
    expect(svg).toContain(`>${room.room.name ?? 'Room'}</text>`)
    expect(svg).toContain(`>${formatArea(room.areaM2, 'm')}</text>`)
    expect(count(svg, 'scale(1 -1)">')).toBeGreaterThanOrEqual(1)
  })

  it('serializes furniture prims 1:1 with symbolFor', () => {
    const item = CATALOG['sofa-3']!
    const doc = emptyDocument('p_sofa', 'Sofa', '2026-07-12T00:00:00.000Z')
    addFurniture(doc, { catalogItemId: item.id, x: 1, y: 1, size: item.dims })
    const svg = renderPlanSvg(doc, getDerived(doc))!
    const prims = symbolFor(item)
    const kinds = (k: string) => prims.filter((p) => p.kind === k).length
    expect(count(svg, '<rect')).toBe(kinds('rect') + 1) // + paper rect
    expect(count(svg, '<circle')).toBe(kinds('circle'))
    expect(count(svg, '<line')).toBe(kinds('line'))
    expect(count(svg, '<path')).toBe(kinds('path')) // no walls/rooms here
    expect(svg).toContain('translate(1 1) rotate(0)')
  })

  it('mirrored furniture emits scale(-1 1) inside its rotate', () => {
    const item = CATALOG['sofa-3']!
    const doc = emptyDocument('p_mir', 'Mir', '2026-07-12T00:00:00.000Z')
    const id = addFurniture(doc, { catalogItemId: item.id, x: 1, y: 1, size: item.dims })
    transformFurniture(doc, id, { mirrored: true })
    const svg = renderPlanSvg(doc, getDerived(doc))!
    expect(svg).toContain('rotate(0) scale(-1 1)"')
  })

  it('unknown catalog items fall back to a dashed rect', () => {
    const doc = emptyDocument('p_unk', 'Unk', '2026-07-12T00:00:00.000Z')
    addFurniture(doc, { catalogItemId: 'not-a-real-item', x: 0, y: 0, size: { w: 1, d: 1, h: 1 } })
    const svg = renderPlanSvg(doc, getDerived(doc))!
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain(`stroke="${theme.invalid}"`)
  })

  it('contains no editor chrome: selection, snaps, guides, grid, non-scaling strokes', () => {
    const doc = roomFixture()
    const svg = renderPlanSvg(doc, getDerived(doc))!
    expect(svg).not.toContain('non-scaling-stroke')
    expect(svg).not.toContain(theme.accent)
    expect(svg).not.toContain(theme.snap)
    expect(svg).not.toContain(theme.guide)
    expect(svg).not.toContain(theme.gridMinor)
    expect(svg).not.toContain(theme.gridMajor)
  })

  it('includeGrid opts the document grid in', () => {
    const doc = roomFixture()
    const svg = renderPlanSvg(doc, getDerived(doc), { includeGrid: true })!
    expect(svg).toContain(theme.gridMinor)
    expect(svg).toContain(theme.gridMajor)
  })

  it('adds wall dimension labels only when showDimensions is on', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    expect(renderPlanSvg(doc, derived)).not.toContain('4.00 m')
    useAppSettings.getState().setShowDimensions(true)
    expect(renderPlanSvg(doc, derived)).toContain('4.00 m')
  })

  it('escapes user text in labels', () => {
    const doc = roomFixture()
    const derived = getDerived(doc)
    const room = Object.values(derived.rooms)[0]!
    // derived.rooms[].room aliases doc.rooms[id] — mutate then re-render
    doc.rooms[room.roomId]!.name = 'A <&> "B"'
    const svg = renderPlanSvg(doc, derived)!
    expect(svg).toContain('A &lt;&amp;&gt; &quot;B&quot;')
  })
})

describe('exportPixelSize', () => {
  it('uses the nominal 100 px/m when unconstrained', () => {
    const size = exportPixelSize({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 0.5)
    expect(size.k).toBe(100)
    expect(size.w).toBe(1100)
    expect(size.h).toBe(600)
  })

  it('clamps huge plans so the 2× raster stays ≤ 4096', () => {
    const size = exportPixelSize({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 0.5)
    expect(Math.max(size.w, size.h) * 2).toBeLessThanOrEqual(4096)
    expect(Math.max(size.w, size.h)).toBe(2048)
    expect(size.k).toBeLessThan(100)
  })

  it('upscales tiny plans to the 512 px floor', () => {
    const size = exportPixelSize({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0)
    expect(Math.max(size.w, size.h)).toBe(512)
    expect(size.k).toBeGreaterThan(100)
  })
})

describe('annotations in the export (v3 — always rendered, they are document content)', () => {
  it('renders dimension lines with derived length text and labels with their text', () => {
    const doc = emptyDocument('p_ann', 'Ann', '2026-07-13T00:00:00.000Z')
    addWallChain(doc, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const dim = addDimension(doc, { x: 0, y: -1 }, { x: 4, y: -1 }, 0.3)!
    addLabel(doc, { x: 2, y: 2 }, 'Reading nook <3')
    resetDerivedForTests()
    const svg = renderPlanSvg(doc, getDerived(doc))!
    expect(svg).toContain('4.00 m') // derived from dist(a,b) + current units
    expect(svg).toContain('Reading nook &lt;3') // escaped label text
    void dim
  })

  it('annotation extents stretch the export framing (content bounds)', () => {
    const doc = emptyDocument('p_ann2', 'Ann2', '2026-07-13T00:00:00.000Z')
    addWallChain(doc, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const bare = renderPlanSvg(doc, getDerived(doc))!
    addLabel(doc, { x: 30, y: 30 }, 'Far away note')
    resetDerivedForTests()
    const withAnn = renderPlanSvg(doc, getDerived(doc))!
    const vb = (s: string) => s.match(/viewBox="([^"]+)"/)![1]!
    expect(vb(withAnn)).not.toBe(vb(bare))
  })
})
