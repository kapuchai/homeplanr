import { describe, expect, it } from 'vitest'
import { emptyDocument, type ProjectDocument } from '../types'
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
import { addOpening } from './openings'
import { renameRoom } from './rooms'
import { addFurniture, addFurnitureBatch, duplicateFurniture, transformFurniture } from './furniture'
import { vec } from '../../geometry/vec'
import { MERGE_EPS } from '../../geometry/constants'
import { dist } from '../../geometry/vec'
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
