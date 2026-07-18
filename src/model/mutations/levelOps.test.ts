import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../types'
import { makeLevelDoc } from '../levels'
import { addLevel, deleteLevel, duplicateLevel, moveLevel, renameLevel, setLevelWallHeight } from './levelOps'
import { addWallChain, addWallSegment } from './walls'
import { addOpening } from './openings'
import { addFurniture, setFurnitureAsset } from './furniture'
import { addAsset } from './assets'
import { attachFurnitureToOpening } from './attachment'
import { addLabel } from './annotations'
import { vec } from '../../geometry/vec'

const doc = () => emptyDocument('p_levels', 'Levels test', '2026-07-18T00:00:00.000Z')

/** Ground level populated with the full reference surface: a room, a door,
 * a window, an attached curtain, wall art with an embedded asset, a label. */
const populated = () => {
  const d = doc()
  const L = makeLevelDoc(d, d.levels[0]!)
  addWallChain(L, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
  const wall = Object.values(L.walls)[0]!
  addOpening(L, { kind: 'door', wallId: wall.id, t: 0.3 })
  const winId = addOpening(L, { kind: 'window', wallId: wall.id, t: 0.7 })!
  const curtain = addFurniture(L, {
    catalogItemId: 'curtain',
    x: 1,
    y: 0.2,
    size: { w: 1.5, d: 0.15, h: 2.4 },
  })
  attachFurnitureToOpening(L, curtain, winId)
  const art = addFurniture(L, {
    catalogItemId: 'art-portrait',
    x: 2,
    y: 2.8,
    size: { w: 0.5, d: 0.04, h: 0.7 },
  })
  setFurnitureAsset(L, art, addAsset(L, { mime: 'image/jpeg', data: 'YQ==', w: 8, h: 8 }))
  addLabel(L, vec(2, 1.5), 'Hall')
  return { d, L }
}

describe('addLevel', () => {
  it('appends an empty level on top and returns its id', () => {
    const d = doc()
    const id = addLevel(d)
    expect(d.levels).toHaveLength(2)
    expect(d.levels[1]!.id).toBe(id)
    expect(Object.keys(d.levels[1]!.walls)).toHaveLength(0)
  })
})

describe('duplicateLevel', () => {
  it('deep-copies directly above with fresh ids and remapped references', () => {
    const { d, L } = populated()
    const cloneId = duplicateLevel(d, d.levels[0]!.id)!
    expect(d.levels).toHaveLength(2)
    expect(d.levels[1]!.id).toBe(cloneId)
    const C = d.levels[1]!
    // counts match
    expect(Object.keys(C.nodes)).toHaveLength(Object.keys(L.nodes).length)
    expect(Object.keys(C.walls)).toHaveLength(Object.keys(L.walls).length)
    expect(Object.keys(C.openings)).toHaveLength(Object.keys(L.openings).length)
    expect(Object.keys(C.furniture)).toHaveLength(Object.keys(L.furniture).length)
    expect(Object.keys(C.annotations)).toHaveLength(Object.keys(L.annotations).length)
    // every id is fresh
    for (const key of Object.keys(C.walls)) expect(key in L.walls).toBe(false)
    for (const key of Object.keys(C.nodes)) expect(key in L.nodes).toBe(false)
    // internal references stay level-local
    for (const w of Object.values(C.walls)) {
      expect(C.nodes[w.a]).toBeDefined()
      expect(C.nodes[w.b]).toBeDefined()
    }
    for (const op of Object.values(C.openings)) expect(C.walls[op.wallId]).toBeDefined()
    for (const r of Object.values(C.rooms)) {
      for (const w of r.wallCycle) expect(C.walls[w]).toBeDefined()
    }
    const curtain = Object.values(C.furniture).find((f) => f.attachedOpeningId)!
    expect(C.openings[curtain.attachedOpeningId!]).toBeDefined()
    // the embedded image is SHARED content — same asset id, no copy
    const art = Object.values(C.furniture).find((f) => f.assetId)!
    const srcArt = Object.values(L.furniture).find((f) => f.assetId)!
    expect(art.assetId).toBe(srcArt.assetId)
    expect(Object.keys(d.assets)).toHaveLength(1)
    // source untouched
    expect(Object.keys(L.walls)).toHaveLength(4)
  })

  it('returns null for an unknown level', () => {
    expect(duplicateLevel(doc(), 'l_ghost' as never)).toBeNull()
  })
})

describe('renameLevel / moveLevel / deleteLevel', () => {
  it('rename trims; empty clears back to the fallback', () => {
    const d = doc()
    renameLevel(d, d.levels[0]!.id, '  Attic  ')
    expect(d.levels[0]!.name).toBe('Attic')
    renameLevel(d, d.levels[0]!.id, '   ')
    expect('name' in d.levels[0]!).toBe(false)
  })

  it('move swaps one slot and no-ops at the ends', () => {
    const d = doc()
    const a = d.levels[0]!.id
    const b = addLevel(d)
    expect(moveLevel(d, a, -1)).toBe(false)
    expect(moveLevel(d, a, 1)).toBe(true)
    expect(d.levels.map((l) => l.id)).toEqual([b, a])
    expect(moveLevel(d, a, 1)).toBe(false)
  })

  it('delete removes a storey but never the last one', () => {
    const d = doc()
    const first = d.levels[0]!.id
    expect(deleteLevel(d, first)).toBe(false)
    const second = addLevel(d)
    expect(deleteLevel(d, second)).toBe(true)
    expect(d.levels).toHaveLength(1)
    expect(deleteLevel(d, first)).toBe(false)
  })
})

describe('setLevelWallHeight (0.13.0 feedback: floor-wide height)', () => {
  it('stores the storey setting, re-heights every wall, seeds new walls', () => {
    const { d: full, L } = (() => {
      const { d, L } = populated()
      return { d, L }
    })()
    setLevelWallHeight(full, full.levels[0]!.id, 3.2)
    expect(full.levels[0]!.wallHeight).toBe(3.2)
    for (const w of Object.values(L.walls)) expect(w.height).toBe(3.2)
    // a NEW wall on the level defaults to the storey height
    const view = makeLevelDoc(full, full.levels[0]!)
    const { wallId } = addWallSegment(view, vec(0, 4), vec(2, 4))
    expect(view.walls[wallId!]!.height).toBe(3.2)
    // clamp parity with settings bounds
    setLevelWallHeight(full, full.levels[0]!.id, 99)
    expect(full.levels[0]!.wallHeight).toBe(6)
  })
})
