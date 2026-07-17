import { describe, expect, it } from 'vitest'
import { emptyDocument, type ProjectDocument, type WallFinishId } from '../types'
import type { FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../ids'
import {
  addWallChain,
  addWallSegment,
  deleteEntities,
  mergeNodes,
  moveNode,
  normalizeGraph,
  splitWall,
  updateWall,
} from './walls'
import { addOpening, updateOpening } from './openings'
import { runPipeline } from './pipeline'
import { paintRoomWalls, renameRoom, setRoomType } from './rooms'
import { addDimension, addLabel, updateAnnotation } from './annotations'
import { pasteSubgraph } from './paste'
import { captureRigStarts, collectRoomRig, tearRoomRig, transformRigRigid } from './roomRig'
import { alignFurniture, distributeFurniture } from './furniture'
import {
  addFurniture,
  addFurnitureBatch,
  duplicateFurniture,
  resizeFurniture,
  setFurnitureMeta,
  setMaterialOverride,
  transformFurniture,
} from './furniture'
import { vec, type Vec2 } from '../../geometry/vec'
import { MERGE_EPS } from '../../geometry/constants'
import { dist } from '../../geometry/vec'
import { produce } from 'immer'
import fc from 'fast-check'

const doc = (): ProjectDocument => emptyDocument('p_test', 'test', '2026-07-11T00:00:00.000Z')

const square = (d: ProjectDocument, size = 4) =>
  addWallChain(d, [vec(0, 0), vec(size, 0), vec(size, size), vec(0, size), vec(0, 0)])

const wallCount = (d: ProjectDocument) => Object.keys(d.walls).length
const nodeCount = (d: ProjectDocument) => Object.keys(d.nodes).length
const roomCount = (d: ProjectDocument) => Object.keys(d.rooms).length
const firstRoom = (d: ProjectDocument) => Object.values(d.rooms)[0]!

/** Invariant assertions (the document contract). */
function checkInvariants(d: ProjectDocument) {
  const nodeIds = Object.keys(d.nodes) as NodeId[]
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const a = d.nodes[nodeIds[i]!]!
      const b = d.nodes[nodeIds[j]!]!
      expect(dist(a, b), `nodes ${a.id}/${b.id} too close`).toBeGreaterThanOrEqual(MERGE_EPS - 1e-12)
    }
  }
  const pairs = new Set<string>()
  for (const w of Object.values(d.walls)) {
    expect(w.a).not.toBe(w.b)
    expect(d.nodes[w.a], `wall ${w.id} node a`).toBeDefined()
    expect(d.nodes[w.b], `wall ${w.id} node b`).toBeDefined()
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`
    expect(pairs.has(key), `duplicate wall pair ${key}`).toBe(false)
    pairs.add(key)
  }
  const used = new Set(Object.values(d.walls).flatMap((w) => [w.a, w.b]))
  for (const n of Object.values(d.nodes)) {
    expect(used.has(n.id), `orphan node ${n.id}`).toBe(true)
  }
  for (const op of Object.values(d.openings)) {
    expect(d.walls[op.wallId], `orphan opening ${op.id}`).toBeDefined()
    expect(op.t).toBeGreaterThan(0)
    expect(op.t).toBeLessThan(1)
  }
}

describe('addWallChain + rooms pipeline', () => {
  it('closed square → 4 walls, 4 nodes, 1 room of exact area', () => {
    const d = doc()
    const ids = square(d)
    expect(ids).toHaveLength(4)
    expect(wallCount(d)).toBe(4)
    expect(nodeCount(d)).toBe(4)
    expect(roomCount(d)).toBe(1)
    checkInvariants(d)
  })

  it('micro-walls and duplicate pairs are rejected', () => {
    const d = doc()
    addWallSegment(d, vec(0, 0), vec(4, 0))
    const dup = addWallSegment(d, vec(0, 0), vec(4, 0))
    expect(dup.wallId).toBeNull()
    const micro = addWallSegment(d, vec(0, 0), vec(0.004, 0))
    expect(micro.wallId).toBeNull()
    expect(wallCount(d)).toBe(1)
  })
})

describe('normalizeGraph', () => {
  it('X-crossing: two crossing segments become 4 walls + center node', () => {
    const d = doc()
    addWallSegment(d, vec(-2, 0), vec(2, 0))
    addWallSegment(d, vec(0, -2), vec(0, 2))
    expect(wallCount(d)).toBe(4)
    expect(nodeCount(d)).toBe(5)
    checkInvariants(d)
  })

  it('T-junction: endpoint on another wall interior splits it', () => {
    const d = doc()
    addWallSegment(d, vec(-2, 0), vec(2, 0))
    addWallSegment(d, vec(0, 0.004), vec(0, 3)) // endpoint within MERGE_EPS of interior
    expect(wallCount(d)).toBe(3)
    expect(nodeCount(d)).toBe(4)
    checkInvariants(d)
  })

  it('near-coincident nodes weld; lexicographically-smallest id keeps ITS position', () => {
    const d = doc()
    const r1 = addWallSegment(d, vec(0, 0), vec(4, 0))
    const r2 = addWallSegment(d, vec(4.005, 0.002), vec(8, 0))
    expect(r1.wallId).not.toBeNull()
    expect(r2.wallId).not.toBeNull()
    expect(nodeCount(d)).toBe(3)
    checkInvariants(d)
    // survivor kept its own position (one of the two originals, not an average)
    const xs = Object.values(d.nodes).map((n) => n.x).sort((a, b) => a - b)
    expect(xs[1] === 4 || xs[1] === 4.005).toBe(true)
  })

  it('drawing a wall straight through a square splits both crossed walls and the room persists', () => {
    const d = doc()
    square(d)
    const before = firstRoom(d).id
    renameRoom(d, before, 'Living room')
    addWallSegment(d, vec(-1, 2), vec(5, 2)) // slices horizontally through
    checkInvariants(d)
    // the square is now two rooms; at least one must have inherited identity
    expect(roomCount(d)).toBe(2)
    const names = Object.values(d.rooms).map((r) => r.name)
    expect(names).toContain('Living room')
  })

  it('fuzz: random small graphs converge and satisfy invariants', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x1: fc.integer({ min: -30, max: 30 }),
            y1: fc.integer({ min: -30, max: 30 }),
            x2: fc.integer({ min: -30, max: 30 }),
            y2: fc.integer({ min: -30, max: 30 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (segs) => {
          const d = doc()
          for (const s of segs) {
            // scale to decimeters so coordinates land on a coarse lattice
            addWallSegment(d, vec(s.x1 / 5, s.y1 / 5), vec(s.x2 / 5, s.y2 / 5))
          }
          normalizeGraph(d)
          checkInvariants(d)
        },
      ),
      { numRuns: 60 },
    )
  })
})

describe('splitWall + opening remapping', () => {
  function wallWithDoor(): { d: ProjectDocument; wallId: WallId; openingId: OpeningId } {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const openingId = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.25 })!
    return { d, wallId: r.wallId!, openingId }
  }

  it('a-side keeps the original id; opening t rescales on the kept side', () => {
    const { d, wallId, openingId } = wallWithDoor()
    splitWall(d, wallId, 0.5)
    expect(d.walls[wallId]).toBeDefined() // a-side kept id
    expect(wallCount(d)).toBe(2)
    const op = d.openings[openingId]!
    expect(op.wallId).toBe(wallId)
    expect(op.t).toBeCloseTo(0.5, 9) // 1.5m center on a 3m wall
  })

  it('opening past the split re-hosts to the b-side with remapped t', () => {
    const { d, wallId, openingId } = wallWithDoor()
    splitWall(d, wallId, 0.1) // split at 0.6m; door spans [1.05, 1.95] — fully b-side
    const op = d.openings[openingId]!
    expect(op.wallId).not.toBe(wallId)
    // center 1.5 on the (6−0.6)=5.4m b-side → local u = 0.9 → t = 1/6
    expect(op.t).toBeCloseTo(0.9 / 5.4, 9)
    checkInvariants(d)
  })

  it('straddling opening is deleted', () => {
    const { d, wallId, openingId } = wallWithDoor()
    splitWall(d, wallId, 0.25) // split exactly through the door center
    expect(d.openings[openingId]).toBeUndefined()
  })
})

describe('opening cascades on wall edits', () => {
  it('shrinking a wall clamps t; shrinking below fit deletes', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const opId = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.8 })!
    // shrink to 2m: door (0.9 wide) still fits but must clamp toward center
    moveNode(d, d.walls[r.wallId!]!.b, vec(2, 0))
    let op = d.openings[opId]!
    expect(op).toBeDefined()
    const u = op.t * 2
    expect(u + 0.45).toBeLessThanOrEqual(2 - 0.01 + 1e-9)
    // shrink to 0.8m: cannot fit a 0.9 door
    moveNode(d, d.walls[r.wallId!]!.b, vec(0.8, 0))
    expect(d.openings[opId]).toBeUndefined()
  })

  it('overlapping openings are serialized; the one that cannot fit is deleted', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(3, 0))
    const id1 = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 })!
    const id2 = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.52 })
    // 3m wall: two 0.9 doors + margins = 1.83m — fits, but serialized
    expect(id2).not.toBeNull()
    const o1 = d.openings[id1]!
    const o2 = d.openings[id2!]!
    const [l, rr] = o1.t < o2.t ? [o1, o2] : [o2, o1]
    expect(rr.t * 3 - rr.width / 2).toBeGreaterThanOrEqual(l.t * 3 + l.width / 2 - 1e-9)
    // a third standard door still fits in the left gap (3m holds 3×0.9)…
    const id3 = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 })
    expect(id3).not.toBeNull()
    // …but a wide 1.2m door has no gap left — rejected WITHOUT evicting others
    const id4 = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5, width: 1.2 })
    expect(id4).toBeNull()
    expect(d.openings[id1]).toBeDefined()
    expect(d.openings[id2!]).toBeDefined()
    expect(d.openings[id3!]).toBeDefined()
  })

  it('vertical: lowering the wall clamps door height; window below min height dies', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const door = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.3 })!
    const win = addOpening(d, { kind: 'window', wallId: r.wallId!, t: 0.7 })! // sill .9 h 1.2
    updateWall(d, r.wallId!, { height: 1.5 })
    expect(d.openings[door]!.height).toBeCloseTo(1.5 - 0.02, 9)
    // window: sill clamps to ≤1.48, height ≤ 1.48−0.9 = 0.58 → survives
    expect(d.openings[win]).toBeDefined()
    updateWall(d, r.wallId!, { height: 1.1 })
    // height ≤ 1.08−0.9 = 0.18 < 0.3 → deleted
    expect(d.openings[win]).toBeUndefined()
  })
})

describe('room identity (Jaccard reconcile)', () => {
  it('name survives adding a door and moving a node', () => {
    const d = doc()
    square(d)
    const id = firstRoom(d).id
    renameRoom(d, id, 'Bedroom')
    const wallId = firstRoom(d).wallCycle[0]!
    addOpening(d, { kind: 'door', wallId, t: 0.5 })
    expect(d.rooms[id]?.name).toBe('Bedroom')
    const anyNode = Object.keys(d.nodes)[0]! as NodeId
    moveNode(d, anyNode, vec(-0.5, -0.5))
    expect(d.rooms[id]?.name).toBe('Bedroom')
  })

  it('name survives splitting a boundary wall', () => {
    const d = doc()
    square(d)
    const id = firstRoom(d).id
    renameRoom(d, id, 'Kitchen')
    splitWall(d, firstRoom(d).wallCycle[0]!, 0.5)
    expect(d.rooms[id]?.name).toBe('Kitchen')
    expect(d.rooms[id]?.wallCycle).toHaveLength(5)
  })

  it('deleting the divider merges two rooms into one surviving identity', () => {
    const d = doc()
    // two adjacent 4x4 rooms sharing a divider
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(8, 0), vec(8, 4), vec(4, 4), vec(0, 4), vec(0, 0)])
    const divider = addWallSegment(d, vec(4, 0), vec(4, 4))
    expect(roomCount(d)).toBe(2)
    for (const r of Object.values(d.rooms)) renameRoom(d, r.id, `Room ${r.id.slice(0, 4)}`)
    const namesBefore = Object.values(d.rooms).map((r) => r.name)
    deleteEntities(d, [divider.wallId!])
    expect(roomCount(d)).toBe(1)
    expect(namesBefore).toContain(firstRoom(d).name) // survivor kept a prior identity
    checkInvariants(d)
  })
})

describe('deleteEntities + mergeNodes', () => {
  it('deleting a wall cascades its openings and GCs orphan nodes', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(4, 0))
    const op = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 })!
    deleteEntities(d, [r.wallId!])
    expect(wallCount(d)).toBe(0)
    expect(nodeCount(d)).toBe(0)
    expect(d.openings[op]).toBeUndefined()
  })

  it('deleting a node cascades attached walls', () => {
    const d = doc()
    square(d)
    const n = Object.keys(d.nodes)[0]! as NodeId
    deleteEntities(d, [n])
    expect(wallCount(d)).toBe(2)
    checkInvariants(d)
  })

  it('mergeNodes collapses degenerate walls', () => {
    const d = doc()
    const r1 = addWallSegment(d, vec(0, 0), vec(2, 0))
    addWallSegment(d, vec(2, 0), vec(4, 0))
    mergeNodes(d, r1.a, r1.b) // collapse the first wall
    expect(wallCount(d)).toBe(1)
    checkInvariants(d)
  })
})

describe('wall paint + finish (updateWall)', () => {
  it('valid ids assign; invalid, undefined, or default values delete the fields', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(4, 0))
    const w = () => d.walls[r.wallId!]!
    updateWall(d, r.wallId!, {
      paintFront: 'sage',
      paintBack: 'charcoal',
      finishFront: 'brick',
      finishBack: 'tile',
    })
    expect(w().paintFront).toBe('sage')
    expect(w().paintBack).toBe('charcoal')
    expect(w().finishFront).toBe('brick')
    expect(w().finishBack).toBe('tile')
    updateWall(d, r.wallId!, { paintFront: 'not-a-paint' }) // invalid → delete
    expect('paintFront' in w()).toBe(false)
    expect(w().paintBack).toBe('charcoal') // untouched key stays
    updateWall(d, r.wallId!, { paintBack: undefined }) // explicit reset → delete
    expect('paintBack' in w()).toBe(false)
    updateWall(d, r.wallId!, { finishFront: 'stucco' as WallFinishId }) // unknown → delete
    expect('finishFront' in w()).toBe(false)
    expect(w().finishBack).toBe('tile') // per-side: the other side stays
    updateWall(d, r.wallId!, { finishBack: 'paint' }) // 'paint' = default → delete
    expect('finishBack' in w()).toBe(false)
    updateWall(d, r.wallId!, { finishFront: 'wallpaperStripe' }) // 0.8.0 registry id
    expect(w().finishFront).toBe('wallpaperStripe')
  })

  it('a no-op paint/finish patch keeps document identity under immer', () => {
    const base = produce(doc(), (draft) => {
      const r = addWallSegment(draft, vec(0, 0), vec(4, 0))
      updateWall(draft, r.wallId!, { paintFront: 'sage', finishFront: 'brick' })
    })
    const wallId = Object.keys(base.walls)[0]! as WallId
    const next = produce(base, (draft) =>
      updateWall(draft, wallId, { paintFront: 'sage', paintBack: 'nope', finishFront: 'brick' }),
    )
    expect(next).toBe(base)
  })
})

describe('paintRoomWalls', () => {
  /** Directed lookup: the wall whose a-node sits at pa and b-node at pb. */
  const wallAt = (d: ProjectDocument, pa: Vec2, pb: Vec2) =>
    Object.values(d.walls).find(
      (w) => dist(d.nodes[w.a]!, pa) < 1e-9 && dist(d.nodes[w.b]!, pb) < 1e-9,
    )!

  it('rect room: paints the room-facing side per wall a→b orientation', () => {
    const d = doc()
    // three walls drawn a→b around the boundary…
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4)])
    // …closed by a wall whose +perp (front) faces AWAY from the interior
    addWallSegment(d, vec(0, 0), vec(0, 4))
    expect(roomCount(d)).toBe(1)
    paintRoomWalls(d, firstRoom(d).id, 'sage')
    // dir (1,0) → +perp (0,1) → y>0 = interior → front
    const south = wallAt(d, vec(0, 0), vec(4, 0))
    expect(south.paintFront).toBe('sage')
    expect('paintBack' in south).toBe(false)
    // dir (0,1) → +perp (−1,0) → x<4 = interior → front
    expect(wallAt(d, vec(4, 0), vec(4, 4)).paintFront).toBe('sage')
    // dir (−1,0) → +perp (0,−1) → y<4 = interior → front
    expect(wallAt(d, vec(4, 4), vec(0, 4)).paintFront).toBe('sage')
    // dir (0,1) at x=0 → +perp (−1,0) → x<0 = outside → back
    const west = wallAt(d, vec(0, 0), vec(0, 4))
    expect(west.paintBack).toBe('sage')
    expect('paintFront' in west).toBe(false)
  })

  it('island hole cycle: paints the hole walls on their room-facing side', () => {
    const d = doc()
    square(d, 8)
    addWallChain(d, [vec(3, 3), vec(5, 3), vec(5, 5), vec(3, 5), vec(3, 3)])
    const outer = Object.values(d.rooms).find((r) => r.holeCycles.length === 1)!
    const islandRoom = Object.values(d.rooms).find((r) => r.id !== outer.id)!
    paintRoomWalls(d, outer.id, 'denim')
    // island wall (3,3)→(5,3): +perp (0,1) probe lands INSIDE the hole →
    // skipped; the −perp probe lies on the room floor → back face painted
    const islandSouth = wallAt(d, vec(3, 3), vec(5, 3))
    expect(islandSouth.paintBack).toBe('denim')
    expect('paintFront' in islandSouth).toBe(false)
    // the outer boundary painted like a plain rect room
    expect(wallAt(d, vec(0, 0), vec(8, 0)).paintFront).toBe('denim')
    // painting the island's own room hits the island-facing front sides only
    paintRoomWalls(d, islandRoom.id, 'sage')
    expect(islandSouth.paintFront).toBe('sage')
    expect(islandSouth.paintBack).toBe('denim')
  })

  it('unknown/undefined ids reset faces; a repeated apply keeps doc identity', () => {
    const d0 = produce(doc(), (draft) => {
      addWallChain(draft, [vec(0, 0), vec(4, 0), vec(4, 4), vec(0, 4), vec(0, 0)])
    })
    const roomId = Object.values(d0.rooms)[0]!.id
    const d1 = produce(d0, (draft) => paintRoomWalls(draft, roomId, 'olive'))
    expect(d1).not.toBe(d0)
    for (const w of Object.values(d1.walls)) expect(w.paintFront).toBe('olive')
    // one mutation = one immer set; already-applied → zero writes → same identity
    const d2 = produce(d1, (draft) => paintRoomWalls(draft, roomId, 'olive'))
    expect(d2).toBe(d1)
    const d3 = produce(d2, (draft) => paintRoomWalls(draft, roomId, 'not-a-paint'))
    for (const w of Object.values(d3.walls)) expect('paintFront' in w).toBe(false)
    const d4 = produce(d3, (draft) => paintRoomWalls(draft, roomId, undefined))
    expect(d4).toBe(d3)
  })
})

describe('furniture', () => {
  it('duplicate offsets by 0.25 and quantizes to 1cm', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1.005,
      y: 2.003,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    expect(d.furniture[id]!.x).toBeCloseTo(1.0, 9)
    const [copy] = duplicateFurniture(d, [id])
    expect(d.furniture[copy!]!.x).toBeCloseTo(1.25, 9)
    expect(d.furniture[copy!]!.y).toBeCloseTo(2.25, 9)
  })

  it('v4 per-item meta rides add + duplicate; overrides are CLONED, never aliased', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
      price: 499,
      notes: 'corner unit',
      materialOverrides: { fabric: '#aabbcc' },
    })
    const f = d.furniture[id]!
    expect(f.price).toBe(499)
    expect(f.notes).toBe('corner unit')
    const [copy] = duplicateFurniture(d, [id])
    const c = d.furniture[copy!]!
    expect(c.price).toBe(499)
    expect(c.materialOverrides).toEqual({ fabric: '#aabbcc' })
    expect(c.materialOverrides).not.toBe(f.materialOverrides) // no aliasing
  })

  it('setFurnitureMeta: key presence is intent; junk prices clear; notes trim', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    setFurnitureMeta(d, id, { price: 499.999 })
    expect(d.furniture[id]!.price).toBe(500) // 2-decimal rounding
    setFurnitureMeta(d, id, { notes: '  IKEA 2026  ' })
    expect(d.furniture[id]!.notes).toBe('IKEA 2026')
    setFurnitureMeta(d, id, { price: -5 }) // invalid clears
    expect('price' in d.furniture[id]!).toBe(false)
    expect(d.furniture[id]!.notes).toBe('IKEA 2026') // untouched key untouched
    setFurnitureMeta(d, id, { notes: '   ' })
    expect('notes' in d.furniture[id]!).toBe(false)
  })

  it('setMaterialOverride sets, replaces, clears per slot; empty record leaves the doc', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    setMaterialOverride(d, id, 'fabric', '#ff0000')
    expect(d.furniture[id]!.materialOverrides).toEqual({ fabric: '#ff0000' })
    setMaterialOverride(d, id, 'legs', 'woodDark')
    setMaterialOverride(d, id, 'fabric', '#00ff00') // replace in place
    expect(d.furniture[id]!.materialOverrides).toEqual({ fabric: '#00ff00', legs: 'woodDark' })
    setMaterialOverride(d, id, 'fabric', undefined)
    expect(d.furniture[id]!.materialOverrides).toEqual({ legs: 'woodDark' })
    setMaterialOverride(d, id, 'legs', undefined)
    expect('materialOverrides' in d.furniture[id]!).toBe(false) // files stay clean
    setMaterialOverride(d, id, '', '#123456') // junk slot: no-op
    expect('materialOverrides' in d.furniture[id]!).toBe(false)
  })

  it('transformFurniture mirrored: true writes the flag, false deletes it', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
    })
    expect('mirrored' in d.furniture[id]!).toBe(false)
    transformFurniture(d, id, { mirrored: true })
    expect(d.furniture[id]!.mirrored).toBe(true)
    transformFurniture(d, id, { mirrored: false })
    expect('mirrored' in d.furniture[id]!).toBe(false)
  })

  it('duplicateFurniture carries mirrored', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'sofa-3',
      x: 1,
      y: 2,
      size: { w: 2.2, d: 0.95, h: 0.85 },
      mirrored: true,
    })
    const [copy] = duplicateFurniture(d, [id])
    expect(d.furniture[copy!]!.mirrored).toBe(true)
  })

  it('placing a 0.02-high item keeps its height', () => {
    const d = doc()
    const id = addFurniture(d, {
      catalogItemId: 'rug',
      x: 0,
      y: 0,
      size: { w: 2.0, d: 1.4, h: 0.02 },
    })
    expect(d.furniture[id]!.size.h).toBe(0.02)
    // resize keeps the split floors too: h down to 1cm, w/d still 10cm
    resizeFurniture(d, id, { h: 0.005, w: 0.005 })
    expect(d.furniture[id]!.size.h).toBe(0.01)
    expect(d.furniture[id]!.size.w).toBe(0.1)
  })

  it('addFurnitureBatch adds every item with the shared validation', () => {
    const d = doc()
    const ids = addFurnitureBatch(d, [
      { catalogItemId: 'test-box', x: 1.004, y: 0, size: { w: 1, d: 1, h: 1 } },
      { catalogItemId: 'test-box', x: 5, y: 5, size: { w: 99, d: 1, h: 1 } },
    ])
    expect(ids).toHaveLength(2)
    expect(Object.keys(d.furniture)).toHaveLength(2)
    expect(d.furniture[ids[0]!]!.x).toBeCloseTo(1, 9) // 1cm quantization
    expect(d.furniture[ids[1]!]!.size.w).toBe(5) // SIZE_MAX clamp
  })
})

describe('live-mode opening survival (S4, 0.3.0)', () => {
  it('a transient live shrink below door width never deletes; the commit re-run decides', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const opId = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 })!
    const nb = d.walls[r.wallId!]!.b
    const tBefore = d.openings[opId]!.t
    // live overshoot: a 0.5m wall cannot fit a 0.9m door — must survive UNTOUCHED
    moveNode(d, nb, vec(0.5, 0), { mode: 'live' })
    expect(d.openings[opId]).toBeDefined()
    expect(d.openings[opId]!.t).toBe(tBefore)
    // drag back out to a fitting length and commit: the door is still there
    moveNode(d, nb, vec(5, 0), { mode: 'live' })
    moveNode(d, nb, vec(5, 0), { mode: 'commit' })
    expect(d.openings[opId]).toBeDefined()
    const op = d.openings[opId]!
    expect(op.t * 5 - op.width / 2).toBeGreaterThanOrEqual(0)
    expect(op.t * 5 + op.width / 2).toBeLessThanOrEqual(5)
    // commit-mode shrink below fit still deletes (pinned since M2)
    moveNode(d, nb, vec(0.5, 0), { mode: 'commit' })
    expect(d.openings[opId]).toBeUndefined()
  })

  it('live-sliding a door into a neighbor on a tight wall deletes neither', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(3, 0))
    const a = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.25 })!
    const b = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.75 })!
    // drag A onto B: serialization has no room for both at commit rules,
    // but a live frame must not destroy either
    updateOpening(d, a, { t: 0.75 }, { mode: 'live' })
    expect(d.openings[a]).toBeDefined()
    expect(d.openings[b]).toBeDefined()
    // settle A back to a legal spot and commit: both survive
    updateOpening(d, a, { t: 0.25 }, { mode: 'commit' })
    expect(d.openings[a]).toBeDefined()
    expect(d.openings[b]).toBeDefined()
  })
})

describe('annotations (v3)', () => {
  it('addDimension/addLabel validate; updates clamp; clearing label text deletes it', () => {
    const d = doc()
    expect(addDimension(d, vec(0, 0), vec(0.001, 0))).toBeNull() // degenerate
    expect(addLabel(d, vec(1, 1), '   ')).toBeNull() // blank
    const dim = addDimension(d, vec(0, 0), vec(4, 0), 0.5)!
    const lab = addLabel(d, vec(2, 1), 'Pantry')!
    expect(d.annotations[dim]!.kind).toBe('dimension')
    updateAnnotation(d, dim, { offset: 999 })
    expect((d.annotations[dim] as { offset: number }).offset).toBe(20) // clamped
    updateAnnotation(d, lab, { fontSize: 3, rotation: Math.PI / 2 })
    const l = d.annotations[lab] as { fontSize?: number; rotation?: number }
    expect(l.fontSize).toBe(1) // clamped
    expect(l.rotation).toBeCloseTo(Math.PI / 2, 9)
    updateAnnotation(d, lab, { text: '  ' })
    expect(d.annotations[lab]).toBeUndefined() // cleared text deletes
  })

  it('deleteEntities removes annotations alongside other entities', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(4, 0))
    const dim = addDimension(d, vec(0, 1), vec(4, 1))!
    deleteEntities(d, [r.wallId!, dim])
    expect(d.annotations[dim]).toBeUndefined()
    expect(d.walls[r.wallId!]).toBeUndefined()
  })
})

describe('M9 (0.3.0): graph paste — the pipeline IS the merge semantics', () => {
  const roomPayload = () => {
    const src = doc()
    addWallChain(src, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const living = Object.values(src.rooms)[0]!
    renameRoom(src, living.id, 'Snug')
    const nodes = Object.values(src.nodes)
    const anchor = {
      x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
      y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
    }
    return {
      payload: {
        nodes: nodes.map((n) => ({ key: n.id, dx: n.x - anchor.x, dy: n.y - anchor.y })),
        walls: Object.values(src.walls).map((w) => ({
          key: w.id,
          aKey: w.a,
          bKey: w.b,
          thickness: w.thickness,
          height: w.height,
        })),
        openings: [],
        roomMeta: [{ wallKeys: [...living.wallCycle], name: 'Snug' }],
      },
      srcWallIds: Object.keys(src.walls),
    }
  }

  it('a DISJOINT paste recreates the room with fresh ids and its name', () => {
    const { payload, srcWallIds } = roomPayload()
    const d = doc()
    const pasted = pasteSubgraph(d, payload, vec(20, 20))
    expect(pasted).toHaveLength(4)
    expect(Object.keys(d.walls)).toHaveLength(4)
    expect(pasted.every((id) => !srcWallIds.includes(id))).toBe(true) // fresh ids
    const rooms = Object.values(d.rooms)
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.name).toBe('Snug')
  })

  it('an OVERLAPPING paste welds through the pipeline (no duplicate walls, valid graph)', () => {
    const { payload } = roomPayload()
    const d = doc()
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const anchor = { x: 2, y: 1.5 } // paste EXACTLY on top of the existing room
    pasteSubgraph(d, payload, anchor)
    // welded: same four walls, no duplicated pairs, still exactly one room
    expect(Object.keys(d.walls)).toHaveLength(4)
    expect(Object.values(d.rooms)).toHaveLength(1)
    const pairs = new Set(
      Object.values(d.walls).map((w) => [w.a, w.b].sort().join('~')),
    )
    expect(pairs.size).toBe(4)
  })

  it('openings ride the pasted walls and re-clamp through the oracle', () => {
    const src = doc()
    const r = addWallSegment(src, vec(0, 0), vec(6, 0))
    const op = addOpening(src, { kind: 'door', wallId: r.wallId!, t: 0.5 })!
    const na = src.nodes[src.walls[r.wallId!]!.a]!
    const nb = src.nodes[src.walls[r.wallId!]!.b]!
    const anchor = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 }
    const payload = {
      nodes: [na, nb].map((n) => ({ key: n.id, dx: n.x - anchor.x, dy: n.y - anchor.y })),
      walls: [
        {
          key: r.wallId!,
          aKey: na.id,
          bKey: nb.id,
          thickness: 0.15,
          height: 2.5,
        },
      ],
      openings: [
        {
          wallKey: r.wallId!,
          kind: 'door' as const,
          t: src.openings[op]!.t,
          width: 0.9,
          height: 2,
          hinge: 'a' as const,
          swing: 'front' as const,
        },
      ],
      roomMeta: [],
    }
    const d = doc()
    pasteSubgraph(d, payload, vec(3, 5))
    expect(Object.keys(d.walls)).toHaveLength(1)
    const doors = Object.values(d.openings)
    expect(doors).toHaveLength(1)
    expect(doors[0]!.kind).toBe('door')
  })
})

describe('0.4.0 M1: paste demotion — existing geometry always wins', () => {
  it('node weld: a demoted id loses even when lexicographically smaller (survivor keeps ITS position)', () => {
    const build = () => {
      const d = doc()
      const idA = 'n_aaa' as NodeId // lexicographically FIRST — old rule made it survive
      const idZ = 'n_zzz' as NodeId
      const idB = 'n_bbb' as NodeId
      const idC = 'n_ccc' as NodeId
      d.nodes[idA] = { id: idA, x: 0, y: 0 }
      d.nodes[idZ] = { id: idZ, x: 0, y: MERGE_EPS / 2 }
      d.nodes[idB] = { id: idB, x: 3, y: 0 }
      d.nodes[idC] = { id: idC, x: 0, y: 3 }
      d.walls['w_1' as WallId] = { id: 'w_1' as WallId, a: idZ, b: idB, thickness: 0.15, height: 2.5 }
      d.walls['w_2' as WallId] = { id: 'w_2' as WallId, a: idA, b: idC, thickness: 0.15, height: 2.5 }
      return { d, idA, idZ }
    }
    // control: without demotion the lexicographic rule keeps n_aaa
    const control = build()
    normalizeGraph(control.d)
    expect(control.d.nodes[control.idA]).toBeDefined()
    expect(control.d.nodes[control.idZ]).toBeUndefined()
    // demoted: n_aaa (the "pasted" node) loses; n_zzz keeps ITS position
    const { d, idA, idZ } = build()
    normalizeGraph(d, new Set([idA]))
    expect(d.nodes[idA]).toBeUndefined()
    expect(d.nodes[idZ]).toBeDefined()
    expect(d.nodes[idZ]!.y).toBe(MERGE_EPS / 2)
    for (const w of Object.values(d.walls)) {
      expect([w.a, w.b]).not.toContain(idA)
    }
    checkInvariants(d)
  })

  it('wall dedupe: a demoted duplicate loses despite the smaller id; its openings re-point', () => {
    const d = doc()
    const nA = 'n_a' as NodeId
    const nB = 'n_b' as NodeId
    d.nodes[nA] = { id: nA, x: 0, y: 0 }
    d.nodes[nB] = { id: nB, x: 4, y: 0 }
    const kept = 'w_zzz' as WallId
    const pasted = 'w_aaa' as WallId // smaller id — old rule made IT survive
    d.walls[kept] = { id: kept, a: nA, b: nB, thickness: 0.15, height: 2.5 }
    d.walls[pasted] = { id: pasted, a: nA, b: nB, thickness: 0.15, height: 2.5 }
    const opId = 'op_1' as OpeningId
    d.openings[opId] = {
      id: opId, wallId: pasted, kind: 'door', t: 0.5, width: 0.9, height: 2,
      hinge: 'a', swing: 'front',
    }
    normalizeGraph(d, new Set([pasted]))
    expect(d.walls[kept]).toBeDefined()
    expect(d.walls[pasted]).toBeUndefined()
    expect(d.openings[opId]!.wallId).toBe(kept)
  })

  it('a demoted opening keeps its EXACT spot when it is free', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const existing = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.25 })!
    const tBefore = d.openings[existing]!.t
    const pasted = 'op_pasted' as OpeningId
    d.openings[pasted] = {
      id: pasted, wallId: r.wallId!, kind: 'door', t: 0.75, width: 0.9, height: 2,
      hinge: 'a', swing: 'front',
    }
    runPipeline(d, 'commit', { demoted: new Set([pasted]) })
    expect(d.openings[existing]!.t).toBe(tBefore)
    expect(d.openings[pasted]).toBeDefined()
    expect(d.openings[pasted]!.t).toBe(0.75) // exact — no drift through the fit
  })

  it('a demoted opening overlapping a kept one is DROPPED — never shifted, never evicting', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    const existing = addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 })!
    const tBefore = d.openings[existing]!.t
    const pasted = 'op_pasted' as OpeningId
    d.openings[pasted] = {
      // 0.3m off-center: overlaps the existing 0.9m door but plenty of wall
      // is free — a shift-to-gap rule would leave a phantom door here
      id: pasted, wallId: r.wallId!, kind: 'door', t: 0.55, width: 0.9, height: 2,
      hinge: 'a', swing: 'front',
    }
    runPipeline(d, 'commit', { demoted: new Set([pasted]) })
    expect(d.openings[existing]).toBeDefined()
    expect(d.openings[existing]!.t).toBe(tBefore)
    expect(d.openings[pasted]).toBeUndefined()
    expect(Object.keys(d.openings)).toHaveLength(1)
  })

  it('split fragments of a demoted wall inherit demotion (partial-overlay paste)', () => {
    // existing wall (0,0)-(4,0); "pasted" demoted wall (-2,0)-(4,0) overlays
    // it: after welds, the kept node at (0,0) T-splits the pasted wall and
    // its b-side fragment exactly duplicates the existing wall. Without
    // demotion inheritance the survivor was a lexicographic coin flip.
    const build = (keptWallId: string) => {
      const d = doc()
      const e1 = 'n_e1' as NodeId
      const e2 = 'n_e2' as NodeId
      const p1 = 'n_p1' as NodeId
      const p2 = 'n_p2' as NodeId
      d.nodes[e1] = { id: e1, x: 0, y: 0 }
      d.nodes[e2] = { id: e2, x: 4, y: 0 }
      d.nodes[p1] = { id: p1, x: -2, y: 0 }
      d.nodes[p2] = { id: p2, x: 4, y: 0 }
      const kept = keptWallId as WallId
      const pasted = 'w_pasted' as WallId
      d.walls[kept] = { id: kept, a: e1, b: e2, thickness: 0.15, height: 2.5 }
      d.walls[pasted] = { id: pasted, a: p1, b: p2, thickness: 0.15, height: 2.5 }
      normalizeGraph(d, new Set([p1, p2, pasted]))
      return d
    }
    // 'w_zzzzzzzzzz' sorts AFTER any fresh split fragment id — the old
    // lexicographic rule would delete it every time
    const d = build('w_zzzzzzzzzz')
    expect(d.walls['w_zzzzzzzzzz' as WallId]).toBeDefined()
    expect(Object.keys(d.walls)).toHaveLength(2) // (-2,0)-(0,0) + the kept wall
    checkInvariants(d)
  })

  it('reversed-orientation dedupe mirrors t/hinge/swing — overlay duplicate drops, free spot flips', () => {
    const build = () => {
      const d = doc()
      const nA = 'n_a' as NodeId
      const nB = 'n_b' as NodeId
      d.nodes[nA] = { id: nA, x: 0, y: 0 }
      d.nodes[nB] = { id: nB, x: 6, y: 0 }
      const kept = 'w_kept' as WallId
      const pasted = 'w_pasted' as WallId
      d.walls[kept] = { id: kept, a: nA, b: nB, thickness: 0.15, height: 2.5 }
      d.walls[pasted] = { id: pasted, a: nB, b: nA, thickness: 0.15, height: 2.5 } // REVERSED
      const existing = 'op_kept' as OpeningId
      d.openings[existing] = {
        id: existing, wallId: kept, kind: 'door', t: 0.25, width: 0.9, height: 2,
        hinge: 'a', swing: 'front',
      }
      return { d, kept, pasted, existing }
    }
    // (a) pasted door at t=0.75 on the REVERSED wall = world position of the
    // existing door → after mirroring it collides and DROPS (no phantom)
    {
      const { d, pasted, existing } = build()
      const dup = 'op_dup' as OpeningId
      d.openings[dup] = {
        id: dup, wallId: pasted, kind: 'door', t: 0.75, width: 0.9, height: 2,
        hinge: 'a', swing: 'front',
      }
      runPipeline(d, 'commit', { demoted: new Set([pasted, dup]) })
      expect(Object.keys(d.openings)).toEqual([existing])
      expect(d.openings[existing]!.t).toBe(0.25)
    }
    // (b) pasted door at t=0.25 on the REVERSED wall = world 0.75 (free) →
    // kept, with t mirrored and hinge/swing flipped to preserve world pose
    {
      const { d, pasted } = build()
      const other = 'op_other' as OpeningId
      d.openings[other] = {
        id: other, wallId: pasted, kind: 'door', t: 0.25, width: 0.9, height: 2,
        hinge: 'a', swing: 'front',
      }
      runPipeline(d, 'commit', { demoted: new Set([pasted, other]) })
      const op = d.openings[other]!
      expect(op).toBeDefined()
      expect(op.wallId).toBe('w_kept')
      expect(op.t).toBeCloseTo(0.75, 12)
      expect(op.kind === 'door' && op.hinge).toBe('b')
      expect(op.kind === 'door' && op.swing).toBe('back')
    }
  })

  it('a demoted opening squeezed by a few cm still fits (weld-sized tolerance)', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(6, 0))
    addOpening(d, { kind: 'door', wallId: r.wallId!, t: 0.5 }) // occupies [2.55, 3.45]
    const pasted = 'op_pasted' as OpeningId
    // requested [3.48, 4.38] — 2cm short of clearing the margin after the
    // existing door; the nearest fit shifts it ~3cm right, well under the
    // 0.1m tolerance (weld displacement scale), so it must survive
    d.openings[pasted] = {
      id: pasted, wallId: r.wallId!, kind: 'door', t: 3.93 / 6, width: 0.9, height: 2,
      hinge: 'a', swing: 'front',
    }
    runPipeline(d, 'commit', { demoted: new Set([pasted]) })
    expect(d.openings[pasted]).toBeDefined()
    expect(Object.keys(d.openings)).toHaveLength(2)
    const u = d.openings[pasted]!.t * 6
    expect(Math.abs(u - 3.93)).toBeLessThanOrEqual(0.1)
    // no overlap with the existing door
    expect(u - 0.45).toBeGreaterThanOrEqual(3.45 - 1e-9)
  })

  it('splitting a painted wall keeps paint and finish on BOTH halves', () => {
    const d = doc()
    const r = addWallSegment(d, vec(0, 0), vec(4, 0))
    updateWall(d, r.wallId!, {
      paintFront: 'sage',
      paintBack: 'charcoal',
      finishFront: 'brick',
      finishBack: 'tile',
    })
    splitWall(d, r.wallId!, 0.5)
    const halves = Object.values(d.walls)
    expect(halves).toHaveLength(2)
    for (const w of halves) {
      expect(w.paintFront).toBe('sage')
      expect(w.paintBack).toBe('charcoal')
      expect(w.finishFront).toBe('brick')
      expect(w.finishBack).toBe('tile')
    }
  })

  it('EXACT-OVERLAY paste is a no-op: existing wall/room/opening identity and meta all survive', () => {
    // target document: 4×3 room named Kitchen with a door on the south wall
    const d = doc()
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const room = firstRoom(d)
    renameRoom(d, room.id, 'Kitchen')
    const south = Object.values(d.walls).find((w) => {
      const a = d.nodes[w.a]!
      const b = d.nodes[w.b]!
      return a.y === 0 && b.y === 0
    })!
    const doorId = addOpening(d, { kind: 'door', wallId: south.id, t: 0.5 })!
    const wallIdsBefore = Object.keys(d.walls).sort()
    const nodeIdsBefore = Object.keys(d.nodes).sort()
    const roomIdBefore = room.id
    const doorTBefore = d.openings[doorId]!.t

    // source payload: the SAME room shape + door, named differently
    const src = doc()
    addWallChain(src, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
    const srcRoom = firstRoom(src)
    renameRoom(src, srcRoom.id, 'Snug')
    const srcSouth = Object.values(src.walls).find((w) => {
      const a = src.nodes[w.a]!
      const b = src.nodes[w.b]!
      return a.y === 0 && b.y === 0
    })!
    addOpening(src, { kind: 'door', wallId: srcSouth.id, t: 0.5 })
    const srcNodes = Object.values(src.nodes)
    const anchor = {
      x: srcNodes.reduce((s, n) => s + n.x, 0) / srcNodes.length,
      y: srcNodes.reduce((s, n) => s + n.y, 0) / srcNodes.length,
    }
    const payload = {
      nodes: srcNodes.map((n) => ({ key: n.id, dx: n.x - anchor.x, dy: n.y - anchor.y })),
      walls: Object.values(src.walls).map((w) => ({
        key: w.id, aKey: w.a, bKey: w.b, thickness: w.thickness, height: w.height,
      })),
      openings: Object.values(src.openings).map((o) => ({
        wallKey: o.wallId,
        kind: 'door' as const,
        t: o.t,
        width: o.width,
        height: o.height,
        hinge: 'a' as const,
        swing: 'front' as const,
      })),
      roomMeta: [{ wallKeys: [...srcRoom.wallCycle], name: 'Snug' }],
    }

    const survivors = pasteSubgraph(d, payload, { x: 2, y: 1.5 })

    expect(survivors).toHaveLength(0) // every pasted wall was consumed
    expect(Object.keys(d.walls).sort()).toEqual(wallIdsBefore)
    expect(Object.keys(d.nodes).sort()).toEqual(nodeIdsBefore)
    expect(Object.keys(d.rooms)).toEqual([roomIdBefore])
    expect(d.rooms[roomIdBefore]!.name).toBe('Kitchen') // pasted meta did NOT hijack
    expect(Object.keys(d.openings)).toEqual([doorId]) // duplicate door dropped
    expect(d.openings[doorId]!.t).toBe(doorTBefore)
    checkInvariants(d)
  })
})

describe('M9 (0.3.0): align / distribute', () => {
  const box = (x: number, y: number, w = 1, dd = 1, rotation = 0): FurnitureId =>
    addFurniture(doc2, { catalogItemId: 'test-box', x, y, rotation, size: { w, d: dd, h: 1 } })
  let doc2: ProjectDocument
  beforeEach2()
  function beforeEach2() {
    doc2 = doc()
  }

  it('align left lines up rotated footprints by their AABB edge', () => {
    doc2 = doc()
    const a = box(2, 0, 2, 1) // AABB minX = 1
    const b = box(5, 2, 1, 1, Math.PI / 2) // rotated 90°: AABB half = d/2=0.5 → minX 4.5
    alignFurniture(doc2, [a, b], 'left')
    const fa = doc2.furniture[a]!
    const fb = doc2.furniture[b]!
    expect(fa.x - 1).toBeCloseTo(fb.x - 0.5, 6) // equal minX
  })

  it("align top uses SCREEN top (max data-y, the view renders y-up)", () => {
    doc2 = doc()
    const a = box(0, 1)
    const b = box(3, 4)
    alignFurniture(doc2, [a, b], 'top')
    expect(doc2.furniture[a]!.y).toBeCloseTo(4, 6)
    expect(doc2.furniture[b]!.y).toBeCloseTo(4, 6)
  })

  it('distribute equalizes edge gaps; stable order; <3 items is a no-op', () => {
    doc2 = doc()
    const a = box(0, 0, 1, 1)
    const b = box(1.2, 0, 1, 1) // uneven gaps
    const c = box(6, 0, 1, 1)
    distributeFurniture(doc2, [a, b, c], 'x')
    const xs = [a, b, c].map((id) => doc2.furniture[id]!.x)
    expect(xs[0]).toBeCloseTo(0, 6) // ends pinned
    expect(xs[2]).toBeCloseTo(6, 6)
    const g1 = xs[1]! - 0.5 - (xs[0]! + 0.5)
    const g2 = xs[2]! - 0.5 - (xs[1]! + 0.5)
    expect(g1).toBeCloseTo(g2, 6)
    distributeFurniture(doc2, [a, b], 'x') // no-op below 3
  })
})

describe('0.8.0 M1: room rig — collect / tear / rigid transform', () => {
  const nodeAt = (d: ProjectDocument, p: Vec2) =>
    Object.values(d.nodes).find((n) => dist(n, p) < 1e-6)!
  const wallBetween = (d: ProjectDocument, p: Vec2, q: Vec2) =>
    Object.values(d.walls).find((w) => {
      const na = d.nodes[w.a]!
      const nb = d.nodes[w.b]!
      return (
        (dist(na, p) < 1e-6 && dist(nb, q) < 1e-6) ||
        (dist(na, q) < 1e-6 && dist(nb, p) < 1e-6)
      )
    })
  /** Room owning a wall that touches the node at `p`. */
  const roomTouching = (d: ProjectDocument, p: Vec2) => {
    const n = nodeAt(d, p)
    const wids = new Set(
      Object.values(d.walls)
        .filter((w) => w.a === n.id || w.b === n.id)
        .map((w) => w.id),
    )
    return Object.values(d.rooms).find((r) => r.wallCycle.some((id) => wids.has(id)))!
  }

  /** Two adjacent 4x4 rooms sharing the x=4 divider (7 walls, 8 nodes). */
  function twoRooms(d: ProjectDocument) {
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(8, 0), vec(8, 4), vec(4, 4), vec(0, 4), vec(0, 0)])
    const divider = addWallSegment(d, vec(4, 0), vec(4, 4)).wallId!
    const left = roomTouching(d, vec(0, 0))
    const right = roomTouching(d, vec(8, 0))
    renameRoom(d, left.id, 'Left')
    renameRoom(d, right.id, 'Right')
    return { divider, leftId: left.id, rightId: right.id }
  }

  /** The full gesture at model level: collect → tear → live frame → commit. */
  function dragRoom(d: ProjectDocument, roomId: RoomId, delta: Vec2, angleRad = 0) {
    const info = collectRoomRig(d, roomId)
    expect(info).not.toBeNull()
    const rig = tearRoomRig(d, info!.rig)
    const starts = captureRigStarts(d, rig)
    const center = info!.centroid
    transformRigRigid(
      d,
      rig,
      starts,
      { delta: { x: delta.x / 2, y: delta.y / 2 }, angleRad, center },
      { mode: 'live' },
    )
    transformRigRigid(d, rig, starts, { delta, angleRad, center }, { mode: 'commit' })
    return { info: info!, rig }
  }

  it('collectRoomRig: null for unknown room; spatial furniture attribution', () => {
    const d = doc()
    expect(collectRoomRig(d, 'r_missing' as RoomId)).toBeNull()
    const { rightId } = twoRooms(d)
    const inside = addFurniture(d, { catalogItemId: 'test-box', x: 5, y: 2, size: { w: 1, d: 1, h: 1 } })
    const outside = addFurniture(d, { catalogItemId: 'test-box', x: 3, y: 2, size: { w: 1, d: 1, h: 1 } })
    const info = collectRoomRig(d, rightId)!
    expect(info.rig.furnitureIds).toContain(inside)
    expect(info.rig.furnitureIds).not.toContain(outside)
    expect(info.rig.wallIds).toHaveLength(4)
    expect(info.rig.nodeIds).toHaveLength(4)
  })

  it('divider tear: neighbor keeps the wall AND its door; dragged room gets a bare copy', () => {
    const d = doc()
    const { divider, leftId, rightId } = twoRooms(d)
    const doorId = addOpening(d, { kind: 'door', wallId: divider, t: 0.5 })!
    d.rooms[rightId]!.floorMaterialId = 'marble'
    d.rooms[rightId]!.roomType = 'bedroom'
    dragRoom(d, rightId, vec(2, 0))
    // neighbor intact: divider survives with the door
    expect(d.walls[divider]).toBeDefined()
    expect(d.openings[doorId]).toBeDefined()
    expect(d.openings[doorId]!.wallId).toBe(divider)
    expect(Object.keys(d.openings)).toHaveLength(1)
    expect(d.rooms[leftId]?.name).toBe('Left')
    expect(d.rooms[leftId]!.wallCycle).toContain(divider)
    // dragged room: identity + meta survive; its cycle holds the torn copy, not the divider
    const right = d.rooms[rightId]
    expect(right?.name).toBe('Right')
    expect(right?.floorMaterialId).toBe('marble')
    expect(right?.roomType).toBe('bedroom')
    expect(right!.wallCycle).not.toContain(divider)
    // torn copy moved with the room and is bare
    expect(wallBetween(d, vec(6, 0), vec(6, 4))).toBeDefined()
    expect(wallCount(d)).toBe(8)
    expect(nodeCount(d)).toBe(8) // 6 fixture nodes + 2 tear duplicates
    expect(roomCount(d)).toBe(2)
    checkInvariants(d)
  })

  it('live frames never weld: coincident tear duplicates survive until commit', () => {
    const d = doc()
    const { rightId } = twoRooms(d)
    const info = collectRoomRig(d, rightId)!
    const rig = tearRoomRig(d, info.rig)
    const starts = captureRigStarts(d, rig)
    expect(wallCount(d)).toBe(8) // divider + coincident copy
    expect(nodeCount(d)).toBe(8)
    transformRigRigid(d, rig, starts, { delta: vec(0, 0), angleRad: 0, center: info.centroid }, { mode: 'live' })
    expect(wallCount(d)).toBe(8) // still not welded
    expect(nodeCount(d)).toBe(8)
    transformRigRigid(d, rig, starts, { delta: vec(1, 0), angleRad: 0, center: info.centroid }, { mode: 'live' })
    expect(wallCount(d)).toBe(8)
    expect(nodeCount(d)).toBe(8)
    // (no checkInvariants here: live docs legitimately hold coincident nodes
    // until the commit re-run normalizes)
  })

  it('exact drop-back is a topological no-op (tear dedupes away)', () => {
    const d = doc()
    const { divider, leftId, rightId } = twoRooms(d)
    const doorId = addOpening(d, { kind: 'door', wallId: divider, t: 0.5 })!
    dragRoom(d, rightId, vec(0, 0))
    expect(wallCount(d)).toBe(7)
    expect(nodeCount(d)).toBe(6)
    expect(roomCount(d)).toBe(2)
    expect(d.openings[doorId]).toBeDefined()
    expect(d.rooms[leftId]?.name).toBe('Left')
    expect(d.rooms[rightId]?.name).toBe('Right')
    checkInvariants(d)
  })

  it('sub-MERGE_EPS drag commits as an exact no-op — never a sheared room', () => {
    const d = doc()
    const { rightId } = twoRooms(d)
    const before = new Map(Object.values(d.nodes).map((n) => [n.id, { x: n.x, y: n.y }]))
    dragRoom(d, rightId, vec(MERGE_EPS / 2, 0))
    expect(wallCount(d)).toBe(7)
    expect(nodeCount(d)).toBe(6)
    for (const n of Object.values(d.nodes)) {
      const b = before.get(n.id)
      expect(b, `node ${n.id} survived`).toBeDefined()
      expect(n.x).toBe(b!.x)
      expect(n.y).toBe(b!.y)
    }
    checkInvariants(d)
  })

  it('pure translate with no shared geometry keeps every id (no tear)', () => {
    const d = doc()
    square(d)
    const room = firstRoom(d)
    renameRoom(d, room.id, 'Solo')
    const cycleBefore = [...room.wallCycle]
    const f = addFurniture(d, { catalogItemId: 'test-box', x: 1, y: 1, size: { w: 1, d: 1, h: 1 } })
    dragRoom(d, room.id, vec(2, 3))
    expect(d.rooms[room.id]?.name).toBe('Solo')
    expect(d.rooms[room.id]!.wallCycle).toEqual(cycleBefore)
    expect(nodeAt(d, vec(2, 3))).toBeDefined()
    expect(nodeAt(d, vec(6, 7))).toBeDefined()
    expect(d.furniture[f]!.x).toBeCloseTo(3, 9)
    expect(d.furniture[f]!.y).toBeCloseTo(4, 9)
    checkInvariants(d)
  })

  it('slide along the neighbor: collinear overlap resolves into a shared segment', () => {
    const d = doc()
    const { divider, leftId, rightId } = twoRooms(d)
    const doorId = addOpening(d, { kind: 'door', wallId: divider, t: 0.5 })!
    dragRoom(d, rightId, vec(0, 1))
    expect(roomCount(d)).toBe(2)
    expect(d.rooms[leftId]?.name).toBe('Left')
    expect(d.rooms[rightId]?.name).toBe('Right')
    expect(d.openings[doorId]).toBeDefined() // door stayed on the stationary side
    // x=4 boundary: left-only [0,1], shared [1,4], right-only [4,5]
    const xWalls = Object.values(d.walls).filter(
      (w) => Math.abs(d.nodes[w.a]!.x - 4) < 1e-6 && Math.abs(d.nodes[w.b]!.x - 4) < 1e-6,
    )
    expect(xWalls).toHaveLength(3)
    checkInvariants(d)
  })

  it('partial-overlap docking: neighbor wall T-splits and the middle fragment is shared', () => {
    const d = doc()
    square(d) // 4x4 room A
    renameRoom(d, firstRoom(d).id, 'A')
    addWallChain(d, [vec(6, 1), vec(9, 1), vec(9, 3), vec(6, 3), vec(6, 1)])
    const b = roomTouching(d, vec(9, 1))
    renameRoom(d, b.id, 'B')
    dragRoom(d, b.id, vec(-2, 0))
    expect(roomCount(d)).toBe(2)
    expect(Object.values(d.rooms).map((r) => r.name).sort()).toEqual(['A', 'B'])
    const xWalls = Object.values(d.walls).filter(
      (w) => Math.abs(d.nodes[w.a]!.x - 4) < 1e-6 && Math.abs(d.nodes[w.b]!.x - 4) < 1e-6,
    )
    expect(xWalls).toHaveLength(3) // [0,1], [1,3] shared, [3,4]
    const shared = wallBetween(d, vec(4, 1), vec(4, 3))!
    const bRoom = Object.values(d.rooms).find((r) => r.name === 'B')!
    expect(bRoom.wallCycle).toContain(shared.id)
    checkInvariants(d)
  })

  it('full edge-to-edge weld: rig wall dedupes away, its door re-hosts onto the kept wall', () => {
    const d = doc()
    square(d) // A: 0..4
    const aRight = wallBetween(d, vec(4, 0), vec(4, 4))!
    addWallChain(d, [vec(6, 0), vec(10, 0), vec(10, 4), vec(6, 4), vec(6, 0)])
    const b = roomTouching(d, vec(10, 0))
    const bLeft = wallBetween(d, vec(6, 0), vec(6, 4))!
    const doorId = addOpening(d, { kind: 'door', wallId: bLeft.id, t: 0.5 })!
    dragRoom(d, b.id, vec(-2, 0))
    expect(d.walls[aRight.id]).toBeDefined()
    expect(d.walls[bLeft.id]).toBeUndefined() // demoted rig wall lost the dedupe
    expect(d.openings[doorId]).toBeDefined()
    expect(d.openings[doorId]!.wallId).toBe(aRight.id) // door migrated to the kept wall
    expect(wallCount(d)).toBe(7)
    expect(roomCount(d)).toBe(2)
    checkInvariants(d)
  })

  it("weld conflict: a rig door that can't near-exactly fit next to a kept door drops", () => {
    const d = doc()
    square(d)
    const aRight = wallBetween(d, vec(4, 0), vec(4, 4))!
    const keptDoor = addOpening(d, { kind: 'door', wallId: aRight.id, t: 0.5 })!
    addWallChain(d, [vec(6, 0), vec(10, 0), vec(10, 4), vec(6, 4), vec(6, 0)])
    const b = roomTouching(d, vec(10, 0))
    const bLeft = wallBetween(d, vec(6, 0), vec(6, 4))!
    const rigDoor = addOpening(d, { kind: 'door', wallId: bLeft.id, t: 0.5 })!
    dragRoom(d, b.id, vec(-2, 0))
    expect(d.openings[keptDoor]).toBeDefined()
    expect(d.openings[rigDoor]).toBeUndefined() // same-slot demoted door drops, never evicts
    expect(Object.keys(d.openings)).toHaveLength(1)
    checkInvariants(d)
  })

  it('island drag-out: walls + furniture leave wholesale, no phantom hole remains', () => {
    const d = doc()
    square(d, 8)
    addWallChain(d, [vec(3, 3), vec(5, 3), vec(5, 5), vec(3, 5), vec(3, 3)])
    const outer = Object.values(d.rooms).find((r) => r.holeCycles.length === 1)!
    const island = Object.values(d.rooms).find((r) => r.id !== outer.id)!
    renameRoom(d, outer.id, 'Hall')
    renameRoom(d, island.id, 'Closet')
    const inIsland = addFurniture(d, { catalogItemId: 'test-box', x: 4, y: 4, size: { w: 0.5, d: 0.5, h: 1 } })
    const inHall = addFurniture(d, { catalogItemId: 'test-box', x: 1, y: 1, size: { w: 0.5, d: 0.5, h: 1 } })
    const wallsBefore = wallCount(d)
    dragRoom(d, island.id, vec(0, 6)) // exits through the south — fully outside
    expect(wallCount(d)).toBe(wallsBefore) // no tear: container/island never tears
    expect(d.rooms[outer.id]?.name).toBe('Hall')
    expect(d.rooms[outer.id]!.holeCycles).toHaveLength(0) // hole regenerated away
    expect(d.rooms[island.id]?.name).toBe('Closet')
    expect(d.furniture[inIsland]!.y).toBeCloseTo(10, 9) // rode with the island
    expect(d.furniture[inHall]!.y).toBeCloseTo(1, 9) // stayed
    checkInvariants(d)
  })

  it('container drag: islands ride along — walls, furniture, and identities', () => {
    const d = doc()
    square(d, 8)
    addWallChain(d, [vec(3, 3), vec(5, 3), vec(5, 5), vec(3, 5), vec(3, 3)])
    const outer = Object.values(d.rooms).find((r) => r.holeCycles.length === 1)!
    const island = Object.values(d.rooms).find((r) => r.id !== outer.id)!
    renameRoom(d, outer.id, 'Hall')
    renameRoom(d, island.id, 'Closet')
    const inIsland = addFurniture(d, { catalogItemId: 'test-box', x: 4, y: 4, size: { w: 0.5, d: 0.5, h: 1 } })
    const info = collectRoomRig(d, outer.id)!
    expect(info.rig.nestedRoomIds).toEqual([island.id])
    expect(info.rig.wallIds).toHaveLength(8)
    expect(info.rig.furnitureIds).toContain(inIsland) // hole contents belong to the rig
    dragRoom(d, outer.id, vec(10, 0))
    expect(d.rooms[outer.id]?.name).toBe('Hall')
    expect(d.rooms[outer.id]!.holeCycles).toHaveLength(1)
    expect(d.rooms[island.id]?.name).toBe('Closet')
    expect(nodeAt(d, vec(13, 3))).toBeDefined() // island corner moved
    expect(d.furniture[inIsland]!.x).toBeCloseTo(14, 9)
    checkInvariants(d)
  })

  it('rotation: nodes orbit the centroid, openings keep t, furniture composes', () => {
    const d = doc()
    addWallChain(d, [vec(0, 0), vec(4, 0), vec(4, 2), vec(0, 2), vec(0, 0)])
    const room = firstRoom(d)
    renameRoom(d, room.id, 'Rect')
    const bottom = wallBetween(d, vec(0, 0), vec(4, 0))!
    const doorId = addOpening(d, { kind: 'door', wallId: bottom.id, t: 0.25 })!
    const f = addFurniture(d, { catalogItemId: 'test-box', x: 1, y: 1, size: { w: 0.5, d: 0.5, h: 1 } })
    dragRoom(d, room.id, vec(0, 0), Math.PI / 2)
    // 4x2 rect about centroid (2,1) → corners (1,-1),(3,-1),(3,3),(1,3)
    for (const p of [vec(1, -1), vec(3, -1), vec(3, 3), vec(1, 3)]) {
      expect(nodeAt(d, p), `corner ${p.x},${p.y}`).toBeDefined()
    }
    expect(d.rooms[room.id]?.name).toBe('Rect')
    expect(d.openings[doorId]).toBeDefined()
    expect(d.openings[doorId]!.wallId).toBe(bottom.id)
    expect(d.openings[doorId]!.t).toBeCloseTo(0.25, 9)
    expect(d.furniture[f]!.x).toBeCloseTo(2, 9)
    expect(d.furniture[f]!.y).toBeCloseTo(0, 9)
    expect(d.furniture[f]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    checkInvariants(d)
  })

  it('rotating a square room next to its neighbor is topology-stable (tear + reweld)', () => {
    const d = doc()
    const { divider, leftId, rightId } = twoRooms(d)
    const doorId = addOpening(d, { kind: 'door', wallId: divider, t: 0.5 })!
    const f = addFurniture(d, { catalogItemId: 'test-box', x: 5, y: 1, size: { w: 0.5, d: 0.5, h: 1 } })
    dragRoom(d, rightId, vec(0, 0), Math.PI / 2)
    expect(wallCount(d)).toBe(7) // square maps onto itself; tear rewelds
    expect(nodeCount(d)).toBe(6)
    expect(roomCount(d)).toBe(2)
    expect(d.rooms[leftId]?.name).toBe('Left')
    expect(d.rooms[rightId]?.name).toBe('Right')
    expect(d.openings[doorId]).toBeDefined()
    expect(d.openings[doorId]!.wallId).toBe(divider)
    expect(d.furniture[f]!.x).toBeCloseTo(7, 6)
    expect(d.furniture[f]!.y).toBeCloseTo(1, 6)
    expect(d.furniture[f]!.rotation).toBeCloseTo(Math.PI / 2, 9)
    checkInvariants(d)
  })

  it('T-junction corner sharing: dragging away duplicates only the junction nodes', () => {
    const d = doc()
    square(d) // room A: 0..4
    renameRoom(d, firstRoom(d).id, 'A')
    // corridor wall hanging off A's north-east corner
    addWallSegment(d, vec(4, 4), vec(7, 4))
    const room = roomTouching(d, vec(0, 0))
    dragRoom(d, room.id, vec(0, 3))
    // the stub kept its anchor node at (4,4); the room moved to y∈[3,7]
    expect(wallBetween(d, vec(4, 4), vec(7, 4))).toBeDefined()
    expect(nodeAt(d, vec(0, 3))).toBeDefined()
    expect(nodeAt(d, vec(4, 7))).toBeDefined()
    expect(d.rooms[room.id]?.name).toBe('A')
    expect(roomCount(d)).toBe(1)
    checkInvariants(d)
  })
})

describe('0.8.0 M8: setRoomType + floor suggestion', () => {
  it('sets/clears the type; seeds the suggested floor ONLY when none was chosen', () => {
    const d = doc()
    square(d)
    const room = firstRoom(d)
    setRoomType(d, room.id, 'bathroom')
    expect(room.roomType).toBe('bathroom')
    expect(room.floorMaterialId).toBe('ceramicFloor') // seeded (was absent)
    setRoomType(d, room.id, 'bedroom')
    expect(room.roomType).toBe('bedroom')
    expect(room.floorMaterialId).toBe('ceramicFloor') // NEVER overwritten
    setRoomType(d, room.id, undefined)
    expect('roomType' in room).toBe(false)
    expect(room.floorMaterialId).toBe('ceramicFloor') // clearing keeps the floor
  })

  it('an explicit user floor blocks the suggestion; unknown types seed nothing', () => {
    const d = doc()
    square(d)
    const room = firstRoom(d)
    room.floorMaterialId = 'marble'
    setRoomType(d, room.id, 'kitchen')
    expect(room.floorMaterialId).toBe('marble')
    delete room.floorMaterialId
    delete room.roomType
    setRoomType(d, room.id, 'observatory-2030') // open registry: stored as-is
    expect(room.roomType).toBe('observatory-2030')
    expect('floorMaterialId' in room).toBe(false) // no suggestion for unknown
  })
})
