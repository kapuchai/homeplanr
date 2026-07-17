import { emptyDocument, type LevelDoc, type ProjectDocument } from '../model/types'
import { makeLevelDoc } from '../model/levels'
import { addWallChain, addWallSegment } from '../model/mutations/walls'
import { addOpening } from '../model/mutations/openings'
import { renameRoom } from '../model/mutations/rooms'
import { addFurniture } from '../model/mutations/furniture'
import { CATALOG } from '../catalog'
import { vec } from '../geometry/vec'

/** Standalone single-level working view for mutation tests (v7): a fresh
 * document's ground level. Mutations see exactly what the store seam
 * would hand them; the wrapper aliases the doc, so persistence-flavored
 * tests can build the doc themselves and call makeLevelDoc directly. */
export function testLevelDoc(id = 'p_test', name = 'test'): LevelDoc {
  const d = emptyDocument(id, name, '2026-07-11T00:00:00.000Z')
  return makeLevelDoc(d, d.levels[0]!)
}

/**
 * The M2 fixture apartment — exercises every render path:
 * two adjacent rooms + divider with a door, a window, a T-junction,
 * a forced-bevel sharp corner stub (patch coverage in BOTH renderers),
 * and four furniture items. Used by the dev bootstrap and by tests.
 */
export function buildFixtureDoc(): ProjectDocument {
  const fullDoc = emptyDocument('p_fixture', 'Fixture apartment', '2026-07-11T00:00:00.000Z')
  const doc = makeLevelDoc(fullDoc, fullDoc.levels[0]!)

  // outer shell: 8m × 5m, divider at x=5 (T-junctions top and bottom)
  addWallChain(doc, [vec(0, 0), vec(8, 0), vec(8, 5), vec(0, 5), vec(0, 0)])
  const divider = addWallSegment(doc, vec(5, 0), vec(5, 5))

  // sharp diagonal stub off the north-east corner → miter-limit bevel + patch
  addWallSegment(doc, vec(8, 0), vec(9.6, -0.35))

  // door in the divider, window on the south wall of the big room
  if (divider.wallId) {
    addOpening(doc, { kind: 'door', wallId: divider.wallId, t: 0.45 })
  }
  const southWall = Object.values(doc.walls).find((w) => {
    const na = doc.nodes[w.a]!
    const nb = doc.nodes[w.b]!
    return na.y === 0 && nb.y === 0 && Math.max(na.x, nb.x) <= 5.01
  })
  if (southWall) {
    addOpening(doc, { kind: 'window', wallId: southWall.id, t: 0.4 })
  }

  // name the rooms (bigger = living, smaller = bedroom)
  const rooms = Object.values(doc.rooms)
  if (rooms.length >= 2) {
    const sorted = rooms
      .map((r) => ({ r, walls: r.wallCycle.length }))
      .sort((a, b) => b.walls - a.walls)
    renameRoom(doc, sorted[0]!.r.id, 'Living room')
    renameRoom(doc, sorted[1]!.r.id, 'Bedroom')
  }

  // furniture
  const place = (catalogItemId: string, x: number, y: number, rotation = 0) => {
    const item = CATALOG[catalogItemId]!
    addFurniture(doc, { catalogItemId, x, y, rotation, size: { ...item.dims } })
  }
  place('sofa-3', 2.2, 0.75, 0) // back against the south wall
  place('dining-table', 3.2, 3.2, 0)
  place('dining-chair', 3.2, 2.4, 0)
  place('bed-double', 6.5, 2.2, Math.PI / 2)
  place('wardrobe', 6.4, 4.6, Math.PI)
  place('toilet', 7.7, 0.5, -Math.PI / 2)

  return fullDoc
}

/** The fixture apartment as its ground-level working view — for tests that
 * exercise entity mutations/derived geometry rather than persistence. */
export function buildFixtureLevelDoc(): LevelDoc {
  const doc = buildFixtureDoc()
  return makeLevelDoc(doc, doc.levels[0]!)
}
