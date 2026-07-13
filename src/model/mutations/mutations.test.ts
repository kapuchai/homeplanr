import { describe, expect, it } from 'vitest'
import { emptyDocument, type ProjectDocument, type WallFinishId } from '../types'
import type { NodeId, OpeningId, WallId } from '../ids'
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
import { paintRoomWalls, renameRoom } from './rooms'
import { addDimension, addLabel, updateAnnotation } from './annotations'
import {
  addFurniture,
  addFurnitureBatch,
  duplicateFurniture,
  resizeFurniture,
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
    updateWall(d, r.wallId!, { paintFront: 'sage', paintBack: 'charcoal', finish: 'brick' })
    expect(w().paintFront).toBe('sage')
    expect(w().paintBack).toBe('charcoal')
    expect(w().finish).toBe('brick')
    updateWall(d, r.wallId!, { paintFront: 'not-a-paint' }) // invalid → delete
    expect('paintFront' in w()).toBe(false)
    expect(w().paintBack).toBe('charcoal') // untouched key stays
    updateWall(d, r.wallId!, { paintBack: undefined }) // explicit reset → delete
    expect('paintBack' in w()).toBe(false)
    updateWall(d, r.wallId!, { finish: 'stucco' as WallFinishId }) // invalid → delete
    expect('finish' in w()).toBe(false)
    updateWall(d, r.wallId!, { finish: 'tile' })
    updateWall(d, r.wallId!, { finish: 'paint' }) // 'paint' = default → delete
    expect('finish' in w()).toBe(false)
  })

  it('a no-op paint/finish patch keeps document identity under immer', () => {
    const base = produce(doc(), (draft) => {
      const r = addWallSegment(draft, vec(0, 0), vec(4, 0))
      updateWall(draft, r.wallId!, { paintFront: 'sage', finish: 'brick' })
    })
    const wallId = Object.keys(base.walls)[0]! as WallId
    const next = produce(base, (draft) =>
      updateWall(draft, wallId, { paintFront: 'sage', paintBack: 'nope', finish: 'brick' }),
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
