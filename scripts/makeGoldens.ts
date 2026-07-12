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
import { addWallChain } from '../src/model/mutations/walls'
import { setRoomFloorMaterial } from '../src/model/mutations/rooms'
import { renameProject, updateSettings } from '../src/model/mutations/project'
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

/** The fixture apartment plus a floor material and cm display units. */
function buildFull(): ProjectDocument {
  const doc = buildFixtureDoc()
  doc.id = 'p_golden_full'
  renameProject(doc, 'Golden full')
  const living = Object.values(doc.rooms).find((r) => r.name === 'Living room')
  assert(living, 'full: fixture doc has no room named "Living room"')
  setRoomFloorMaterial(doc, living.id, 'darkFloor')
  updateSettings(doc, { unitDisplay: 'cm' })

  const openings = Object.values(doc.openings)
  assert(openings.some((o) => o.kind === 'door'), 'full: expected a door')
  assert(openings.some((o) => o.kind === 'window'), 'full: expected a window')
  assert(count(doc.furniture) >= 2, 'full: expected 2+ furniture items')
  assert(
    Object.values(doc.furniture).every((f) => f.catalogItemId),
    'full: catalog ids present',
  )
  assert(living.floorMaterialId === 'darkFloor', 'full: floor material not set')
  assert(doc.settings.unitDisplay === 'cm', 'full: unitDisplay not cm')
  return doc
}

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
