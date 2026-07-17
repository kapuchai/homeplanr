import { describe, expect, it } from 'vitest'
import { emptyDocument, type Window } from '../types'
import type { OpeningId } from '../ids'
import { addWallSegment, deleteEntities, splitWall } from './walls'
import { addOpening, updateOpening } from './openings'
import { addFurniture, resizeFurniture, transformFurniture } from './furniture'
import {
  ATTACH_OVERHANG,
  attachFurnitureToOpening,
  findWindowNear,
  reconcileAttachedFurniture,
  windowAttachTransform,
} from './attachment'
import { vec } from '../../geometry/vec'

const STAMP = '2026-07-17T00:00:00.000Z'

/** Horizontal wall (0,0)→(4,0), thickness 0.15, one window at t=0.5 w=1.2. */
function setup() {
  const doc = emptyDocument('p_attach', 'Attach test', STAMP)
  const { wallId } = addWallSegment(doc, vec(0, 0), vec(4, 0))
  const openingId = addOpening(doc, {
    kind: 'window',
    wallId: wallId!,
    t: 0.5,
    width: 1.2,
    height: 1.2,
    sillHeight: 0.9,
  })!
  const curtainId = addFurniture(doc, {
    catalogItemId: 'curtain',
    x: 2,
    y: 0.5, // front (+perp for a→b = +y here… sign checked in tests)
    size: { w: 1.6, d: 0.2, h: 2.4 },
  })
  return { doc, wallId: wallId!, openingId, curtainId }
}

describe('windowAttachTransform', () => {
  it('centers on the window, offsets by half thickness + half depth, on the ref side', () => {
    const { doc, openingId } = setup()
    const op = doc.openings[openingId] as Window
    const below = windowAttachTransform(doc, op, vec(2, 1), 0.2)!
    expect(below.x).toBeCloseTo(2)
    expect(below.y).toBeCloseTo(0.15 / 2 + 0.1) // +perp side is +y for a→b = +x
    expect(below.width).toBeCloseTo(1.2 + 2 * ATTACH_OVERHANG)
    const above = windowAttachTransform(doc, op, vec(2, -1), 0.2)!
    expect(above.y).toBeCloseTo(-(0.15 / 2 + 0.1))
    // rotation points the item's back (+y local) AT the wall on both sides
    // (±π are the same angle — atan2 signs the zero)
    expect(Math.abs(below.rotation)).toBeCloseTo(Math.PI, 5) // back toward −y
    expect(Math.abs(above.rotation)).toBeCloseTo(0, 5) // back toward +y
  })
})

describe('attach + reconcile lifecycle', () => {
  it('attach syncs the stored transform immediately', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    const f = doc.furniture[curtainId]!
    expect(f.attachedOpeningId).toBe(openingId)
    expect(f.x).toBeCloseTo(2)
    expect(f.y).toBeCloseTo(0.175)
    expect(f.size.w).toBeCloseTo(1.5)
  })

  it('refuses doors and missing targets', () => {
    const { doc, wallId, curtainId } = setup()
    const doorId = addOpening(doc, {
      kind: 'door',
      wallId,
      t: 0.2,
      width: 0.9,
      height: 2,
      hinge: 'a',
      swing: 'front',
    })!
    attachFurnitureToOpening(doc, curtainId, doorId)
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBeUndefined()
    attachFurnitureToOpening(doc, curtainId, 'o_missing' as OpeningId)
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBeUndefined()
  })

  it('follows a window moved along its wall (pipeline runs inside updateOpening)', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    updateOpening(doc, openingId, { t: 0.25 })
    expect(doc.furniture[curtainId]!.x).toBeCloseTo(1)
    expect(doc.furniture[curtainId]!.y).toBeCloseTo(0.175) // same side
  })

  it('follows across a wall split (opening re-hosted, id stable)', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    splitWall(doc, doc.openings[openingId]!.wallId, 0.25) // window at t=0.5 lands on the b-side
    expect(doc.openings[openingId]).toBeDefined()
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId)
    expect(doc.furniture[curtainId]!.x).toBeCloseTo(2) // world position unchanged
  })

  it('detaches when the window is deleted, keeping the last transform', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    deleteEntities(doc, [openingId])
    const f = doc.furniture[curtainId]!
    expect(f.attachedOpeningId).toBeUndefined()
    expect(f.x).toBeCloseTo(2) // stands where it last stood
    expect(f.y).toBeCloseTo(0.175)
  })

  it('reconcile is a no-op write (field-identical) when nothing moved', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    const before = JSON.stringify(doc.furniture[curtainId])
    reconcileAttachedFurniture(doc)
    expect(JSON.stringify(doc.furniture[curtainId])).toBe(before)
  })
})

describe('manual edits detach', () => {
  it('transformFurniture x/y/rotation detach; elevation/mirror keep', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId)
    transformFurniture(doc, curtainId, { elevation: 0.1 })
    transformFurniture(doc, curtainId, { mirrored: true })
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId)
    transformFurniture(doc, curtainId, { x: 3 })
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBeUndefined()
  })

  it('resize w detaches; d/h keep', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId)
    resizeFurniture(doc, curtainId, { h: 2.2, d: 0.25 })
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId)
    resizeFurniture(doc, curtainId, { w: 2 })
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBeUndefined()
  })

  it('a DEPTH edit re-syncs the center in the same mutation (review fix)', () => {
    const { doc, openingId, curtainId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    expect(doc.furniture[curtainId]!.y).toBeCloseTo(0.075 + 0.1) // t/2 + d/2
    resizeFurniture(doc, curtainId, { d: 0.5 })
    // still attached, and the center moved out so the back stays flush
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId)
    expect(doc.furniture[curtainId]!.y).toBeCloseTo(0.075 + 0.25)
  })
})

describe('live-mode transients never detach (review fix)', () => {
  it('degenerate host geometry: live keeps the attachment, commit detaches', () => {
    const { doc, openingId, curtainId, wallId } = setup()
    attachFurnitureToOpening(doc, curtainId, openingId, vec(2, 1))
    const before = { ...doc.furniture[curtainId]! }
    // collapse the wall for a frame (node snapped onto its other endpoint)
    const wall = doc.walls[wallId]!
    const a = doc.nodes[wall.a]!
    const saved = { x: a.x, y: a.y }
    const b = doc.nodes[wall.b]!
    a.x = b.x
    a.y = b.y
    reconcileAttachedFurniture(doc, 'live')
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId) // survived
    expect(doc.furniture[curtainId]!.x).toBe(before.x) // transform untouched
    // revert the overshoot — the commit re-sync lands normally
    a.x = saved.x
    a.y = saved.y
    reconcileAttachedFurniture(doc, 'commit')
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBe(openingId)
    // a commit WITH degenerate geometry does detach
    a.x = b.x
    a.y = b.y
    reconcileAttachedFurniture(doc, 'commit')
    expect(doc.furniture[curtainId]!.attachedOpeningId).toBeUndefined()
  })
})

describe('findWindowNear', () => {
  it('picks the nearest window within the radius; ignores doors', () => {
    const { doc, wallId, openingId } = setup()
    addOpening(doc, {
      kind: 'door',
      wallId,
      t: 0.15,
      width: 0.9,
      height: 2,
      hinge: 'a',
      swing: 'front',
    })
    expect(findWindowNear(doc, vec(2, 0.3), 0.5)?.id).toBe(openingId)
    expect(findWindowNear(doc, vec(0.6, 0.3), 0.5)).toBeNull() // door there, not window
    expect(findWindowNear(doc, vec(2, 2), 0.5)).toBeNull() // too far
  })
})
