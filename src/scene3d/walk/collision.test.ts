import { describe, expect, it } from 'vitest'
import { DEFAULTS, emptyDocument, type ProjectDocument } from '../../model/types'
import { addWallChain, addWallSegment } from '../../model/mutations/walls'
import { addOpening } from '../../model/mutations/openings'
import { addFurniture } from '../../model/mutations/furniture'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { dist, vec, type Vec2 } from '../../geometry/vec'
import { centroid, pointInPolygon } from '../../geometry/polygon'
import {
  BODY_BAND_HI,
  BODY_BAND_LO,
  EYE_BAND_HI,
  EYE_BAND_LO,
  EYE_HEIGHT,
  MAX_SUBSTEP,
  PLAYER_RADIUS,
  buildCollisionSet,
  contact,
  getCollisionSet,
  resolveMove,
  validateTeleport,
  type CollisionSet,
  type Contact,
} from './collision'

const doc = () => emptyDocument('p_walk', 'walk', '2026-07-12T00:00:00.000Z')

/** Half of the default wall thickness — face offset from the centerline. */
const HALF_T = DEFAULTS.wallThickness / 2
const R = PLAYER_RADIUS

const setup = (build: (d: ProjectDocument) => void) => {
  resetDerivedForTests()
  const d = doc()
  build(d)
  const derived = getDerived(d)
  return { d, derived, set: buildCollisionSet(d, derived) }
}

/** Exhaustive deepest contact (no AABB gate — cross-checks the culled path). */
const deepest = (set: CollisionSet, p: Vec2, r = R): Contact | null => {
  let best: Contact | null = null
  for (const o of set.obstacles) {
    const c = contact(p, o, r)
    if (c && (!best || c.depth > best.depth)) best = c
  }
  return best
}

describe('collision core (12 pinned cases)', () => {
  it('(1) empty doc: resolveMove is pure advection, validateTeleport is identity', () => {
    const { set } = setup(() => {})
    expect(set.obstacles).toHaveLength(0)
    const out = resolveMove(set, vec(3.7, -2.1), vec(0.33, 0.77))
    expect(out.x).toBeCloseTo(4.03, 9)
    expect(out.y).toBeCloseTo(-1.33, 9)
    const tp = validateTeleport(set, vec(1.5, 2.5))
    expect(tp).not.toBeNull()
    expect(tp!.x).toBe(1.5)
    expect(tp!.y).toBe(2.5)
  })

  it('(2) corridor slide: diagonal into a long wall keeps tangential progress, ends ≥ r off the face', () => {
    const { set } = setup((d) => {
      addWallSegment(d, vec(0, 0), vec(10, 0))
    })
    const out = resolveMove(set, vec(2, 1), vec(2, -2))
    expect(out.x).toBeCloseTo(4, 6) // pushes are face-normal only — x untouched
    expect(out.y - HALF_T).toBeGreaterThanOrEqual(R - 1e-6)
    expect(out.y).toBeLessThan(HALF_T + R + 0.01)
  })

  it('(3) doorway: crosses a 0.15-thick wall through the 0.9m door at its center', () => {
    const { set, derived } = setup((d) => {
      const w = addWallSegment(d, vec(0, 0), vec(4, 0))
      addOpening(d, { kind: 'door', wallId: w.wallId!, t: 0.5 })
    })
    const solid = Object.values(derived.wallSolids)[0]!
    const door = solid.openings.find((o) => o.kind === 'door')!
    const mid = (door.u0 + door.u1) / 2 // frame is (0,0)→(1,0), so u ≡ x
    const out = resolveMove(set, vec(mid, 0.6), vec(0, -1.2))
    expect(out.x).toBeCloseTo(mid, 9)
    expect(out.y).toBeCloseTo(-0.6, 9)
  })

  it('(4) doorway edges: passable center span is [u0+r, u1−r] (pins width − 2r)', () => {
    const { set, derived } = setup((d) => {
      const w = addWallSegment(d, vec(0, 0), vec(4, 0))
      addOpening(d, { kind: 'door', wallId: w.wallId!, t: 0.5 })
    })
    const door = Object.values(derived.wallSolids)[0]!.openings[0]!
    // Static Minkowski pin at the wall mid-plane, both jambs.
    expect(deepest(set, vec(door.u0 + R - 0.01, 0))).not.toBeNull()
    expect(deepest(set, vec(door.u0 + R + 0.01, 0))).toBeNull()
    expect(deepest(set, vec(door.u1 - R + 0.01, 0))).not.toBeNull()
    expect(deepest(set, vec(door.u1 - R - 0.01, 0))).toBeNull()
    // Entering at u0 + r − ε cannot cross at that x: the rounded jamb keeps
    // the disc center out of the forbidden span (it deflects into the
    // legal channel or stops — either way x ≥ u0 + r whenever inside the
    // wall band).
    let pos = vec(door.u0 + R - 0.05, 0.5)
    for (let i = 0; i < 24; i++) {
      pos = resolveMove(set, pos, vec(0, -0.05))
      if (Math.abs(pos.y) <= HALF_T + 1e-9) {
        expect(pos.x).toBeGreaterThanOrEqual(door.u0 + R - 1e-3)
      }
    }
    expect(pos.x).toBeGreaterThanOrEqual(door.u0 + R - 1e-3)
    // Entering at u0 + r + ε passes straight through, untouched.
    const out = resolveMove(set, vec(door.u0 + R + 0.01, 0.5), vec(0, -1))
    expect(out.x).toBeCloseTo(door.u0 + R + 0.01, 9)
    expect(out.y).toBeCloseTo(-0.5, 9)
  })

  it('(5) window: crossing blocked (default sill 0.9 window is a full obstacle)', () => {
    const { set, derived } = setup((d) => {
      const w = addWallSegment(d, vec(0, 0), vec(4, 0))
      addOpening(d, { kind: 'window', wallId: w.wallId!, t: 0.5 })
    })
    const solid = Object.values(derived.wallSolids)[0]!
    expect(solid.openings[0]!.kind).toBe('window') // realized, on the path
    const out = resolveMove(set, vec(2, 0.6), vec(0, -1.2))
    expect(out.x).toBeCloseTo(2, 9)
    expect(out.y).toBeGreaterThanOrEqual(HALF_T + R - 1e-6) // never crossed
  })

  it('(6) T-junction: patch wedge blocks; inside-corner slide never penetrates', () => {
    const { set, derived, d } = setup((dd) => {
      addWallSegment(dd, vec(-3, 0), vec(3, 0))
      addWallSegment(dd, vec(0, 0), vec(0, 3))
    })
    const tNode = Object.values(d.nodes).find((n) => Math.hypot(n.x, n.y) < 1e-6)!
    const patch = derived.patchSolidByNode[tNode.id]
    expect(patch).toBeDefined()
    const probe = centroid(patch!.polygon)
    const poly = set.obstacles.find((o) => o.kind === 'poly' && pointInPolygon(probe, o.ring))
    expect(poly).toBeDefined()
    expect(contact(probe, poly!, R)!.depth).toBeGreaterThanOrEqual(R)
    // slide diagonally into the x>0, y>0 inside corner; sample every substep
    let pos = vec(1.0, 0.9)
    for (let i = 0; i < 30; i++) {
      pos = resolveMove(set, pos, vec(-0.06, -0.02))
      expect(deepest(set, pos)?.depth ?? 0).toBeLessThanOrEqual(1e-3)
    }
    expect(pos.x).toBeCloseTo(HALF_T + R, 2) // wedged against the stem face
    expect(pos.y).toBeCloseTo(HALF_T + R, 2) // and the through-wall face
  })

  it('(7) X-junction: no tunneling through the center at MAX_SUBSTEP-scale deltas', () => {
    const { set } = setup((d) => {
      addWallSegment(d, vec(-2, 0), vec(2, 0))
      addWallSegment(d, vec(0, -2), vec(0, 2))
    })
    const step = MAX_SUBSTEP / Math.SQRT2
    let pos = vec(0.5, 0.5)
    for (let i = 0; i < 25; i++) {
      pos = resolveMove(set, pos, vec(-step, -step))
      expect(deepest(set, pos)?.depth ?? 0).toBeLessThanOrEqual(1e-3)
    }
    expect(pos.x).toBeGreaterThanOrEqual(HALF_T + R - 1e-3)
    expect(pos.y).toBeGreaterThanOrEqual(HALF_T + R - 1e-3)
    // one large delta (substepped internally) wedges the same way
    const big = resolveMove(set, vec(0.5, 0.5), vec(-1.5, -1.5))
    expect(big.x).toBeGreaterThanOrEqual(HALF_T + R - 1e-3)
    expect(big.y).toBeGreaterThanOrEqual(HALF_T + R - 1e-3)
  })

  it('(8) anti-tunnel: 1.0m delta straight at a 0.15m wall stops on the near side', () => {
    expect(MAX_SUBSTEP).toBeLessThan(PLAYER_RADIUS) // the invariant substepping relies on
    const { set } = setup((d) => {
      addWallSegment(d, vec(0, 0), vec(4, 0))
    })
    const out = resolveMove(set, vec(2, 0.5), vec(0, -1))
    expect(out.x).toBeCloseTo(2, 9)
    expect(out.y).toBeGreaterThanOrEqual(HALF_T + R - 1e-6)
    expect(out.y).toBeLessThanOrEqual(0.5)
  })

  it('(9) L-corner outer miter: the wedge is solid (outline-span rects, no notch)', () => {
    const { set } = setup((d) => {
      addWallChain(d, [vec(3, 0), vec(0, 0), vec(0, 3)])
    })
    // outer miter corner reaches (−t/2, −t/2); a probe inside the wedge must
    // be INSIDE a rect (depth ≥ r), not merely grazing a corner from outside
    const hit = deepest(set, vec(-0.05, -0.05))
    expect(hit).not.toBeNull()
    expect(hit!.depth).toBeGreaterThanOrEqual(R)
    // diagonally beyond the corner the field is clear at disc radius
    expect(deepest(set, vec(-0.4, -0.4))).toBeNull()
  })

  it('(10) teleport nudge: point 0.1m inside a face returns a clear point ≤ 0.5m away', () => {
    const { set } = setup((d) => {
      addWallSegment(d, vec(0, 0), vec(4, 0))
    })
    const p = vec(2, HALF_T - 0.1)
    const q = validateTeleport(set, p)
    expect(q).not.toBeNull()
    expect(dist(q!, p)).toBeLessThanOrEqual(0.5)
    expect(deepest(set, q!)).toBeNull()
  })

  it('(11) teleport reject: point deep inside a thick junction cluster → null', () => {
    // 1m-thick X-junction: any clear point needs ≥ 0.75m lateral clearance
    // from BOTH centerlines — impossible within maxNudge 0.5 of the node.
    const { set } = setup((d) => {
      addWallSegment(d, vec(-2, 0), vec(2, 0), { thickness: 1 })
      addWallSegment(d, vec(0, -2), vec(0, 2), { thickness: 1 })
    })
    expect(validateTeleport(set, vec(0, 0))).toBeNull()
  })

  it('(F1) furniture bands: rug passes under, overhead shelf passes, table AND head-height cabinet block (constants pinned)', () => {
    expect(BODY_BAND_LO).toBe(0.3)
    expect(BODY_BAND_HI).toBe(1.2)
    expect(EYE_BAND_LO).toBe(EYE_HEIGHT - 0.2)
    expect(EYE_BAND_HI).toBe(EYE_HEIGHT + 0.2)
    const { set } = setup((d) => {
      addFurniture(d, { catalogItemId: 'rug', x: 0, y: 0, size: { w: 2, d: 1.4, h: 0.02 } })
      // the stock wall-cabinet: 1.45–2.15m contains the 1.6m eye — must
      // block, or the walk camera clips through its interior
      addFurniture(d, {
        catalogItemId: 'wall-cabinet',
        x: 5,
        y: 0,
        size: { w: 0.8, d: 0.35, h: 0.7 },
        elevation: 1.45,
      })
      addFurniture(d, { catalogItemId: 'table', x: 10, y: 0, size: { w: 1.6, d: 0.9, h: 0.75 } })
      // genuinely overhead (≥ EYE_BAND_HI): walk under freely
      addFurniture(d, {
        catalogItemId: 'high-shelf',
        x: 15,
        y: 0,
        size: { w: 1, d: 0.3, h: 0.4 },
        elevation: 1.9,
      })
    })
    expect(set.obstacles).toHaveLength(2) // table + head-height cabinet
    expect(deepest(set, vec(0, 0))).toBeNull() // rug underfoot
    expect(deepest(set, vec(5, 0))).not.toBeNull() // cabinet at head height
    expect(deepest(set, vec(10, 0))).not.toBeNull() // table blocks
    expect(deepest(set, vec(15, 0))).toBeNull() // overhead shelf
  })

  it('(F1b) catalog passable items (curtains, blinds) never block; art/mirrors do', () => {
    const { set } = setup((d) => {
      // full-height fabric spans BOTH bands — passable wins over geometry
      addFurniture(d, { catalogItemId: 'curtain', x: 0, y: 0, size: { w: 1.6, d: 0.2, h: 2.4 } })
      addFurniture(d, {
        catalogItemId: 'blinds',
        x: 5,
        y: 0,
        size: { w: 1.3, d: 0.2, h: 1.4 },
        elevation: 0.85,
      })
      // same wall-hugging shape WITHOUT the flag: blocks via the eye band
      addFurniture(d, {
        catalogItemId: 'art-portrait',
        x: 10,
        y: 0,
        size: { w: 0.5, d: 0.2, h: 0.7 },
        elevation: 1.15,
      })
      addFurniture(d, {
        catalogItemId: 'mirror-full',
        x: 15,
        y: 0,
        size: { w: 0.5, d: 0.2, h: 1.8 },
      })
    })
    expect(set.obstacles).toHaveLength(2) // art + mirror only
    expect(deepest(set, vec(0, 0))).toBeNull() // walk through curtains
    expect(deepest(set, vec(5, 0))).toBeNull() // and blinds
    expect(deepest(set, vec(10, 0))).not.toBeNull() // art blocks (eye band)
    expect(deepest(set, vec(15, 0))).not.toBeNull() // floor mirror blocks
  })

  it('(F2) band edges are exclusive: h=0.3 on the floor and a 1.2–1.35m sliver both pass', () => {
    const { set } = setup((d) => {
      addFurniture(d, { catalogItemId: 'low', x: 0, y: 0, size: { w: 1, d: 1, h: 0.3 } })
      // between the bands: above the body band, below the eye band
      addFurniture(d, {
        catalogItemId: 'sliver',
        x: 5,
        y: 0,
        size: { w: 1, d: 1, h: 0.15 },
        elevation: 1.2,
      })
      // exactly at the eye-band ceiling
      addFurniture(d, {
        catalogItemId: 'at-ceiling',
        x: 10,
        y: 0,
        size: { w: 1, d: 1, h: 0.5 },
        elevation: EYE_BAND_HI,
      })
    })
    expect(set.obstacles).toHaveLength(0)
  })

  it('(F3) rotated sofa: oriented footprint is exact; slide along the face keeps tangential progress', () => {
    const rot = Math.PI / 4
    const { set } = setup((d) => {
      addFurniture(d, {
        catalogItemId: 'sofa',
        x: 0,
        y: 0,
        rotation: rot,
        size: { w: 2, d: 0.9, h: 0.8 },
      })
    })
    const nx = -Math.sin(rot) // face normal = perp of the rotated axis
    const ny = Math.cos(rot)
    const tx = Math.cos(rot)
    const ty = Math.sin(rot)
    // Minkowski pin on the long face: hv = d/2 = 0.45
    expect(deepest(set, vec(nx * (0.45 + R + 0.02), ny * (0.45 + R + 0.02)))).toBeNull()
    expect(deepest(set, vec(nx * (0.45 + R - 0.02), ny * (0.45 + R - 0.02)))).not.toBeNull()
    // diagonal push into the face: normal motion stops at the face, the
    // tangential component passes through in full (face-normal pushes only)
    const start = vec(nx * (0.45 + R + 0.3), ny * (0.45 + R + 0.3))
    const out = resolveMove(set, start, vec(-nx + tx * 0.5, -ny + ty * 0.5))
    expect(deepest(set, out)?.depth ?? 0).toBeLessThanOrEqual(1e-3)
    const tangential = out.x * tx + out.y * ty
    expect(tangential).toBeCloseTo(start.x * tx + start.y * ty + 0.5, 2)
    expect(out.x * nx + out.y * ny).toBeGreaterThanOrEqual(0.45 + R - 1e-3)
  })

  it('(F4) teleport vs furniture: edge point nudges out ≤ 0.5m, deep center rejects', () => {
    const { set } = setup((d) => {
      addFurniture(d, { catalogItemId: 'wardrobe', x: 0, y: 0, size: { w: 1.2, d: 0.65, h: 2 } })
      addFurniture(d, { catalogItemId: 'block', x: 10, y: 0, size: { w: 2, d: 2, h: 1 } })
    })
    const p = vec(0.1, 0.1) // just inside the wardrobe → 0.475m push clears it
    const q = validateTeleport(set, p)
    expect(q).not.toBeNull()
    expect(dist(q!, p)).toBeLessThanOrEqual(0.5)
    expect(deepest(set, q!)).toBeNull()
    expect(validateTeleport(set, vec(10, 0))).toBeNull() // 1.25m push needed
  })

  it('(12) getCollisionSet caches by document identity', () => {
    resetDerivedForTests()
    const d1 = doc()
    addWallSegment(d1, vec(0, 0), vec(4, 0))
    const s1 = getCollisionSet(d1, getDerived(d1))
    expect(getCollisionSet(d1, getDerived(d1))).toBe(s1)
    // a mutation lands on a NEW document object (immer flow) → fresh set
    const d2 = structuredClone(d1)
    addWallSegment(d2, vec(0, 3), vec(4, 3))
    const s2 = getCollisionSet(d2, getDerived(d2))
    expect(s2).not.toBe(s1)
    expect(s2.obstacles.length).toBeGreaterThan(s1.obstacles.length)
  })
})
