/**
 * Bundled template-plan generator (M6, 0.4.0) — builds the starter plans
 * through the pure mutation API and serializes them into
 * src/assets/templates/*.homeplanr (Vite ?raw imports bundle them).
 *
 * Unlike goldens these are NOT byte-frozen: rerun freely (ids are random
 * nanoids, so bytes churn — content is what matters), and REGENERATE at
 * every schema bump so bundled templates always parse at the current
 * version with healed=false (see the RUNBOOK schema checklist).
 *
 * Run from the repo root: npx vite-node scripts/makeTemplates.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyDocument, type ProjectDocument } from '../src/model/types'
import { addWallChain } from '../src/model/mutations/walls'
import { addOpening } from '../src/model/mutations/openings'
import { renameRoom, setRoomFloorMaterial } from '../src/model/mutations/rooms'
import { addFurniture } from '../src/model/mutations/furniture'
import { addDimension } from '../src/model/mutations/annotations'
import { serializeDocument, parseDocument } from '../src/store/persistence/serialize'
import { getDerived, resetDerivedForTests } from '../src/store/derived'
import { CATALOG } from '../src/catalog'
import { vec, type Vec2 } from '../src/geometry/vec'

const STAMP = '2026-07-16T00:00:00.000Z'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`template invariant violated: ${msg}`)
}

/** Wall whose endpoints match (a, b) in either order, 1mm tolerance. */
function wallAt(doc: ProjectDocument, a: Vec2, b: Vec2) {
  const at = (n: { x: number; y: number }, p: Vec2) =>
    Math.abs(n.x - p.x) < 1e-3 && Math.abs(n.y - p.y) < 1e-3
  const hit = Object.values(doc.walls).find((w) => {
    const na = doc.nodes[w.a]!
    const nb = doc.nodes[w.b]!
    return (at(na, a) && at(nb, b)) || (at(na, b) && at(nb, a))
  })
  assert(hit, `no wall between (${a.x},${a.y}) and (${b.x},${b.y})`)
  return hit
}

/** Rooms sorted by derived area, largest first. */
function roomsByArea(doc: ProjectDocument) {
  resetDerivedForTests()
  const derived = getDerived(doc)
  return Object.values(doc.rooms)
    .map((r) => ({ r, area: derived.rooms[r.id]?.areaM2 ?? 0 }))
    .sort((x, y) => y.area - x.area)
}

function place(doc: ProjectDocument, catalogItemId: string, x: number, y: number, rotation = 0) {
  const item = CATALOG[catalogItemId]
  assert(item, `unknown catalog item ${catalogItemId}`)
  addFurniture(doc, {
    catalogItemId,
    x,
    y,
    rotation,
    size: { ...item.dims },
    elevation: item.defaultElevation ?? 0,
  })
}

// Wall-back rotations (items' back = +y local): north wall (y=min) → π,
// south → 0, east (x=max) → −π/2, west (x=min) → +π/2.

/** Studio ~25 m²: single room + bathroom corner, kitchen row, sleeping nook. */
function buildStudio(): ProjectDocument {
  const doc = emptyDocument('p_template_studio', 'Studio 25 m²', STAMP)
  addWallChain(doc, [vec(0, 0), vec(5.6, 0), vec(5.6, 4.6), vec(0, 4.6), vec(0, 0)])
  addWallChain(doc, [vec(3.8, 0), vec(3.8, 1.9), vec(5.6, 1.9)]) // bathroom corner

  const [main, bath] = roomsByArea(doc)
  assert(main && bath && Object.keys(doc.rooms).length === 2, 'studio: expected 2 rooms')
  renameRoom(doc, main.r.id, 'Studio')
  renameRoom(doc, bath.r.id, 'Bathroom')
  setRoomFloorMaterial(doc, main.r.id, 'woodFloor')
  setRoomFloorMaterial(doc, bath.r.id, 'ceramicFloor')

  // entry (south), bathroom door, windows north + east
  addOpening(doc, { kind: 'door', wallId: wallAt(doc, vec(5.6, 4.6), vec(0, 4.6)).id, t: 0.8 })
  addOpening(doc, {
    kind: 'door',
    wallId: wallAt(doc, vec(3.8, 0), vec(3.8, 1.9)).id,
    t: 0.55, // swings out into the studio — a leaf into a 1.8m bath hits everything
  })
  addOpening(doc, { kind: 'window', wallId: wallAt(doc, vec(0, 0), vec(3.8, 0)).id, t: 0.4 })
  addOpening(doc, {
    kind: 'window',
    wallId: wallAt(doc, vec(5.6, 1.9), vec(5.6, 4.6)).id,
    t: 0.5,
  })

  // sleeping nook, lounge middle, kitchen along the east wall (sink under
  // the window), dining between lounge and kitchen
  place(doc, 'bed-double', 1.05, 1.25, Math.PI)
  place(doc, 'nightstand', 2.15, 0.4, Math.PI)
  place(doc, 'wardrobe', 0.45, 3.05, Math.PI / 2)
  place(doc, 'sofa-2', 2.45, 3.15, Math.PI)
  place(doc, 'coffee-table', 2.45, 2.35, 0)
  place(doc, 'fridge', 5.15, 2.45, -Math.PI / 2)
  place(doc, 'kitchen-sink', 5.15, 3.3, -Math.PI / 2)
  place(doc, 'stove', 5.15, 4.05, -Math.PI / 2)
  place(doc, 'dining-table-round', 4.05, 3.3, 0)
  place(doc, 'dining-chair', 4.05, 2.6, Math.PI)
  place(doc, 'dining-chair', 4.05, 4.0, 0)
  // bathroom
  place(doc, 'toilet', 5.2, 0.45, -Math.PI / 2)
  place(doc, 'washbasin', 4.35, 0.35, Math.PI)
  place(doc, 'shower', 5.1, 1.4, 0)

  // exterior width dimension above the north wall
  addDimension(doc, vec(0, -0.4), vec(5.6, -0.4))
  return doc
}

/** 1-bedroom ~45 m²: L-shaped living/kitchen, bedroom, bathroom. */
function buildOneBedroom(): ProjectDocument {
  const doc = emptyDocument('p_template_1br', '1-bedroom 45 m²', STAMP)
  addWallChain(doc, [vec(0, 0), vec(7.8, 0), vec(7.8, 5.8), vec(0, 5.8), vec(0, 0)])
  addWallChain(doc, [vec(4.9, 0), vec(4.9, 3.4), vec(7.8, 3.4)]) // bedroom
  addWallChain(doc, [vec(5.9, 3.4), vec(5.9, 5.8)]) // bathroom

  const rooms = roomsByArea(doc)
  assert(rooms.length === 3, `1br: expected 3 rooms, got ${rooms.length}`)
  const [living, bedroom, bathroom] = rooms
  renameRoom(doc, living!.r.id, 'Living room')
  renameRoom(doc, bedroom!.r.id, 'Bedroom')
  renameRoom(doc, bathroom!.r.id, 'Bathroom')
  setRoomFloorMaterial(doc, living!.r.id, 'woodFloor')
  setRoomFloorMaterial(doc, bedroom!.r.id, 'carpetFloor')
  setRoomFloorMaterial(doc, bathroom!.r.id, 'tileGray')

  // entry (south, living side), bedroom + bathroom doors, three windows
  addOpening(doc, { kind: 'door', wallId: wallAt(doc, vec(5.9, 5.8), vec(0, 5.8)).id, t: 0.85 })
  addOpening(doc, {
    kind: 'door',
    wallId: wallAt(doc, vec(4.9, 0), vec(4.9, 3.4)).id,
    t: 0.85, // past the bed's foot — a lower t sweeps the leaf over the bed
    swing: 'back',
  })
  addOpening(doc, { kind: 'door', wallId: wallAt(doc, vec(5.9, 3.4), vec(5.9, 5.8)).id, t: 0.45 })
  addOpening(doc, { kind: 'window', wallId: wallAt(doc, vec(0, 0), vec(4.9, 0)).id, t: 0.45 })
  addOpening(doc, { kind: 'window', wallId: wallAt(doc, vec(4.9, 0), vec(7.8, 0)).id, t: 0.5 })
  addOpening(doc, { kind: 'window', wallId: wallAt(doc, vec(0, 5.8), vec(0, 0)).id, t: 0.5 })

  // living: kitchen row along the north wall, sofa on the west wall facing
  // the TV on the bedroom partition, dining between (rug FIRST — plan z-order
  // is insertion order, the rug must draw under the seating)
  place(doc, 'rug', 2.0, 3.3, 0)
  place(doc, 'kitchen-counter', 0.7, 0.35, Math.PI)
  place(doc, 'kitchen-sink', 1.65, 0.35, Math.PI)
  place(doc, 'stove', 2.45, 0.35, Math.PI)
  place(doc, 'fridge', 3.3, 0.4, Math.PI)
  place(doc, 'kitchen-island', 1.9, 1.6, 0)
  place(doc, 'sofa-3', 0.56, 3.3, Math.PI / 2)
  place(doc, 'coffee-table', 2.05, 3.3, Math.PI / 2)
  place(doc, 'tv-wall', 4.72, 2.6, -Math.PI / 2)
  place(doc, 'dining-table', 3.7, 2.0, Math.PI / 2)
  place(doc, 'dining-chair', 3.1, 2.0, Math.PI / 2)
  place(doc, 'dining-chair', 4.3, 2.0, -Math.PI / 2)
  place(doc, 'dining-chair', 3.7, 1.1, Math.PI)
  place(doc, 'dining-chair', 3.7, 2.9, 0)
  place(doc, 'plant', 0.42, 4.55, 0)
  // bedroom
  place(doc, 'bed-double', 6.35, 1.25, Math.PI)
  place(doc, 'nightstand', 5.2, 0.4, Math.PI)
  place(doc, 'nightstand', 7.45, 0.4, Math.PI)
  place(doc, 'wardrobe', 7.4, 2.7, -Math.PI / 2)
  // bathroom
  place(doc, 'bathtub', 7.35, 4.35, -Math.PI / 2)
  place(doc, 'toilet', 6.35, 5.35, 0)
  place(doc, 'washbasin', 6.4, 3.75, Math.PI)
  place(doc, 'washing-machine', 6.3, 4.55, Math.PI / 2)

  addDimension(doc, vec(0, -0.4), vec(7.8, -0.4))
  return doc
}

const outDir = fileURLToPath(new URL('../src/assets/templates/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const targets: [string, ProjectDocument][] = [
  ['studio-25.homeplanr', buildStudio()],
  ['one-bedroom-45.homeplanr', buildOneBedroom()],
]

for (const [name, doc] of targets) {
  const json = serializeDocument(doc, STAMP)
  // templates must open pristine at the current schema version
  const { warnings, healed } = parseDocument(json)
  assert(!healed && warnings.length === 0, `${name} does not round-trip clean`)
  writeFileSync(join(outDir, name), json)
  console.log(
    `${name}: ${json.length} bytes — walls ${Object.keys(doc.walls).length},` +
      ` openings ${Object.keys(doc.openings).length}, rooms ${Object.keys(doc.rooms).length},` +
      ` furniture ${Object.keys(doc.furniture).length}`,
  )
}
