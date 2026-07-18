import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../model/types'
import { makeLevelDoc, SLAB_THICKNESS } from '../../model/levels'
import { addLevel } from '../../model/mutations/levelOps'
import { addWallChain } from '../../model/mutations/walls'
import { addFurniture } from '../../model/mutations/furniture'
import { buildStairTransitions } from './stairTransitions'
import { pointInPolygon } from '../../geometry/polygon'
import { vec } from '../../geometry/vec'

const twoStorey = () => {
  const doc = emptyDocument('p_trans', 'transitions', '2026-07-18T00:00:00.000Z')
  const ground = makeLevelDoc(doc, doc.levels[0]!)
  addWallChain(ground, [vec(0, 0), vec(6, 0), vec(6, 5), vec(0, 5), vec(0, 0)])
  addFurniture(ground, {
    catalogItemId: 'stair-straight',
    x: 3,
    y: 2.5,
    size: { w: 0.9, d: 2.8, h: 2.8 },
  })
  addLevel(doc)
  return doc
}

describe('buildStairTransitions', () => {
  it('offers an ascend zone in front of the stair and lands past the top', () => {
    const doc = twoStorey()
    const fromGround = buildStairTransitions(doc, doc.levels[0]!.id)
    expect(fromGround).toHaveLength(1)
    const up = fromGround[0]!
    expect(up.targetLevelId).toBe(doc.levels[1]!.id)
    // ground walls are 2.5 m; stacking = wall height + slab
    expect(up.targetElevation).toBeCloseTo(2.5 + SLAB_THICKNESS)
    // the zone sits in FRONT of the bottom tread (−y side of the stair)
    expect(pointInPolygon({ x: 3, y: 2.5 - 1.4 - 0.2 }, up.zone)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 2.5 }, up.zone)).toBe(false)
    // arrival lands PAST the stairwell's top edge on the upper storey
    expect(up.arrival.y).toBeGreaterThan(2.5 + 1.4)
  })

  it('offers a descend zone over the stairwell top from the upper storey', () => {
    const doc = twoStorey()
    const fromUpper = buildStairTransitions(doc, doc.levels[1]!.id)
    expect(fromUpper).toHaveLength(1)
    const down = fromUpper[0]!
    expect(down.targetLevelId).toBe(doc.levels[0]!.id)
    expect(down.targetElevation).toBe(0)
    // the zone is the stair footprint's TOP strip (the hole edge)
    expect(pointInPolygon({ x: 3, y: 2.5 + 1.2 }, down.zone)).toBe(true)
    // arrival = in front of the bottom tread, inside the ascend twin zone
    expect(down.arrival.y).toBeLessThan(2.5 - 1.4)
  })

  it('a single-storey document offers no transitions', () => {
    const doc = emptyDocument('p_single', 'single', '2026-07-18T00:00:00.000Z')
    const ground = makeLevelDoc(doc, doc.levels[0]!)
    addFurniture(ground, {
      catalogItemId: 'stair-straight',
      x: 1,
      y: 1,
      size: { w: 0.9, d: 2.8, h: 2.8 },
    })
    expect(buildStairTransitions(doc, doc.levels[0]!.id)).toHaveLength(0)
  })
})
