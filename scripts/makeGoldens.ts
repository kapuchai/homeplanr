/**
 * Golden-fixture generator — snapshots the CURRENT SCHEMA_VERSION as
 * .homeplanr files under src/test/goldens/ for migration tests.
 *
 * Goldens are byte-frozen historical fixtures: generated ONCE per schema
 * version, committed, never regenerated (entity ids are random nanoids, so a
 * rerun would silently rewrite history). Regenerating an existing vN file is
 * forbidden — this script refuses to overwrite. Rerun it before EVERY schema
 * bump, while SCHEMA_VERSION is still the outgoing version (see RUNBOOK).
 *
 * Run from the repo root: npx vite-node scripts/makeGoldens.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_VERSION, emptyDocument, type ProjectDocument } from '../src/model/types'
import { addWallChain, updateWall } from '../src/model/mutations/walls'
import { updateOpening } from '../src/model/mutations/openings'
import { setRoomFloorMaterial } from '../src/model/mutations/rooms'
import {
  addFurniture,
  setFurnitureAsset,
  setFurnitureLight,
  transformFurniture,
} from '../src/model/mutations/furniture'
import { addAsset, setPreviewImage } from '../src/model/mutations/assets'
import { attachFurnitureToOpening } from '../src/model/mutations/attachment'
import { addArea, addDimension, addLabel, updateAnnotation } from '../src/model/mutations/annotations'
import { renameProject } from '../src/model/mutations/project'
import { CATALOG } from '../src/catalog'
import { serializeDocument } from '../src/store/persistence/serialize'
import { buildFixtureDoc } from '../src/test/fixtureDoc'
import { vec } from '../src/geometry/vec'

// serializeDocument stamps updatedAt with this, keeping the run date out of
// the bytes; ids are still random, hence the never-regenerate rule above.
const STAMP = '2026-07-12T00:00:00.000Z'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`golden invariant violated: ${msg}`)
}

const count = (rec: Record<string, unknown>) => Object.keys(rec).length

/** Simple closed 4×3m square room, default settings. */
function buildBasic(): ProjectDocument {
  const doc = emptyDocument('p_golden_basic', 'Golden basic', STAMP)
  addWallChain(doc, [vec(0, 0), vec(4, 0), vec(4, 3), vec(0, 3), vec(0, 0)])
  assert(count(doc.nodes) === 4, 'basic: expected 4 nodes')
  assert(count(doc.walls) === 4, 'basic: expected 4 walls')
  assert(count(doc.rooms) === 1, 'basic: expected 1 room')
  assert(count(doc.openings) === 0 && count(doc.furniture) === 0, 'basic: expected no extras')
  return doc
}

/**
 * The fixture apartment plus the full v6 surface worth freezing: everything
 * the v5 golden froze (grouped-registry floor, roomType, per-side paint +
 * per-side DIFFERENT finishes, mirrored furniture, v3/v4 annotations,
 * price/notes/materialOverrides) PLUS the v6 features: an embedded image
 * asset + wall art referencing it (doc.assets / FurnitureInstance.assetId),
 * a curtain attached to a window (attachedOpeningId write-through), opening
 * styles on both kinds (Opening.style — 0.10.0 rode the v6 field), lamp
 * light state (lumen + stored lightOn:false — 0.12.0 rode the v6 fields),
 * and the 0.11.0 custom save preview (previewAssetId + previewCustom,
 * additive on v6).
 * (Each schema bump rewrites this builder to freeze the OUTGOING
 * version's real feature set — see RUNBOOK.)
 */
/** The schema version these builders freeze. Bumping SCHEMA_VERSION without
 * rewriting the builders (RUNBOOK checklist step 1) must fail loudly here —
 * never mint goldens whose shape doesn't match their version. */
const BUILDER_VERSION = 6

function buildFull(): ProjectDocument {
  assert(
    (SCHEMA_VERSION as number) === BUILDER_VERSION,
    `builders freeze v${BUILDER_VERSION} but SCHEMA_VERSION is ${SCHEMA_VERSION} — rewrite them first (RUNBOOK schema checklist)`,
  )
  const doc = buildFixtureDoc()
  doc.id = 'p_golden_full'
  renameProject(doc, 'Golden full')
  const living = Object.values(doc.rooms).find((r) => r.name === 'Living room')
  assert(living, 'full: fixture doc has no room named "Living room"')
  setRoomFloorMaterial(doc, living.id, 'parquetHerringbone')
  living.roomType = 'living'
  const paintedWall = Object.values(doc.walls)[0]
  assert(paintedWall, 'full: fixture doc has no walls')
  updateWall(doc, paintedWall.id, {
    paintFront: 'sage',
    paintBack: 'terracotta',
    finishFront: 'wallpaperStripe',
    finishBack: 'plaster',
  })
  const mirroredItem = Object.values(doc.furniture)[0]
  assert(mirroredItem, 'full: fixture doc has no furniture')
  transformFurniture(doc, mirroredItem.id, { mirrored: true })
  mirroredItem.price = 499
  mirroredItem.notes = 'Golden notes'
  mirroredItem.materialOverrides = { fabric: 'oak', legs: '#334455' }
  const dimId = addDimension(doc, vec(0.5, 0.5), vec(3.5, 0.5), 0.35)
  assert(dimId, 'full: dimension annotation rejected')
  const labelId = addLabel(doc, vec(2, 2.5), 'Golden label')
  assert(labelId, 'full: label annotation rejected')
  updateAnnotation(doc, labelId, { rotation: Math.PI / 6, fontSize: 0.2 })
  const areaId = addArea(doc, [vec(0.6, 0.6), vec(2.4, 0.6), vec(2.4, 1.8), vec(0.6, 1.8)])
  assert(areaId, 'full: area annotation rejected')

  // --- v6 surface ---
  const openings = Object.values(doc.openings)
  const door = openings.find((o) => o.kind === 'door')
  const window = openings.find((o) => o.kind === 'window')
  assert(door && window, 'full: fixture doc lacks a door/window')
  updateOpening(doc, door.id, { style: 'double' })
  updateOpening(doc, window.id, { style: 'arched' })

  const placeExtra = (catalogItemId: string, x: number, y: number, rotation = 0) => {
    const item = CATALOG[catalogItemId]
    assert(item, `full: unknown catalog id ${catalogItemId}`)
    return addFurniture(doc, {
      catalogItemId,
      x,
      y,
      rotation,
      size: { ...item.dims },
      elevation: item.defaultElevation ?? 0,
    })
  }
  const artId = placeExtra('art-portrait', 0.7, 4.85, Math.PI)
  const artAssetId = addAsset(doc, { mime: 'image/jpeg', data: 'Z29sZGVuLWFydA==', w: 24, h: 32 })
  setFurnitureAsset(doc, artId, artAssetId)
  const curtainId = placeExtra('curtain', 2, 0.2)
  attachFurnitureToOpening(doc, curtainId, window.id)
  const lampId = placeExtra('floor-lamp', 0.6, 4.2)
  setFurnitureLight(doc, lampId, { lumen: 1400, lightOn: false })
  setPreviewImage(doc, { mime: 'image/jpeg', data: 'Z29sZGVuLXByZXZpZXc=', w: 16, h: 16 })

  assert(openings.some((o) => o.kind === 'door'), 'full: expected a door')
  assert(openings.some((o) => o.kind === 'window'), 'full: expected a window')
  assert(doc.openings[door.id]!.style === 'double', 'full: door style not frozen')
  assert(doc.openings[window.id]!.style === 'arched', 'full: window style not frozen')
  assert(doc.furniture[artId]!.assetId === artAssetId, 'full: wall-art assetId not frozen')
  assert(doc.assets[artAssetId], 'full: art asset missing from doc.assets')
  assert(
    doc.furniture[curtainId]!.attachedOpeningId === window.id,
    'full: curtain attachment not frozen',
  )
  assert(
    doc.furniture[lampId]!.lumen === 1400 && doc.furniture[lampId]!.lightOn === false,
    'full: lamp lumen/lightOn not frozen',
  )
  assert(
    doc.previewAssetId && doc.previewCustom === true && doc.assets[doc.previewAssetId],
    'full: custom preview not frozen',
  )
  assert(count(doc.furniture) >= 2, 'full: expected 2+ furniture items')
  assert(
    Object.values(doc.furniture).every((f) => f.catalogItemId),
    'full: catalog ids present',
  )
  assert(living.floorMaterialId === 'parquetHerringbone', 'full: floor material not set')
  assert(living.roomType === 'living', 'full: roomType not set')
  assert(doc.walls[paintedWall.id]!.paintFront === 'sage', 'full: paintFront not set')
  assert(
    doc.walls[paintedWall.id]!.finishFront === 'wallpaperStripe' &&
      doc.walls[paintedWall.id]!.finishBack === 'plaster',
    'full: per-side v5 finishes not set',
  )
  assert(doc.furniture[mirroredItem.id]!.mirrored === true, 'full: mirrored not set')
  assert(doc.furniture[mirroredItem.id]!.price === 499, 'full: price not frozen')
  assert(doc.furniture[mirroredItem.id]!.notes === 'Golden notes', 'full: notes not frozen')
  assert(
    doc.furniture[mirroredItem.id]!.materialOverrides?.fabric === 'oak',
    'full: materialOverrides not frozen',
  )
  const dim = doc.annotations[dimId]
  assert(dim?.kind === 'dimension' && dim.offset === 0.35, 'full: dimension offset not frozen')
  const label = doc.annotations[labelId]
  assert(
    label?.kind === 'label' && label.rotation !== undefined && label.fontSize === 0.2,
    'full: label rotation/fontSize not frozen',
  )
  const areaAnn = doc.annotations[areaId]
  assert(areaAnn?.kind === 'area' && areaAnn.points.length === 4, 'full: area not frozen')
  return doc
}

// Guard BEFORE any build or write: after a bump (SCHEMA_VERSION ahead of
// BUILDER_VERSION) this script is intentionally version-rotted — rewriting
// the builders to the new outgoing surface is step 1 of the next bump.
assert(
  (SCHEMA_VERSION as number) === BUILDER_VERSION,
  `builders freeze v${BUILDER_VERSION} but SCHEMA_VERSION is ${SCHEMA_VERSION} — rewrite them first (RUNBOOK schema checklist)`,
)

const outDir = fileURLToPath(new URL('../src/test/goldens/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const targets: [string, ProjectDocument][] = [
  [`v${SCHEMA_VERSION}-basic.homeplanr`, buildBasic()],
  [`v${SCHEMA_VERSION}-full.homeplanr`, buildFull()],
]

for (const [name, doc] of targets) {
  const path = join(outDir, name)
  if (existsSync(path)) {
    console.error(`REFUSING to overwrite existing golden ${name} — goldens are byte-frozen`)
    process.exit(1)
  }
  const json = serializeDocument(doc, STAMP)
  writeFileSync(path, json)
  console.log(
    `${name}: ${json.length} bytes — nodes ${count(doc.nodes)}, walls ${count(doc.walls)},` +
      ` openings ${count(doc.openings)}, rooms ${count(doc.rooms)}, furniture ${count(doc.furniture)}`,
  )
}
