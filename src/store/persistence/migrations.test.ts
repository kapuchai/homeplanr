/// <reference types="node" />
// (tsconfig.app.json only auto-includes vite/client types; this node-env test
// reads goldens from disk, deliberately outside the vite module graph.)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  ForwardVersionError,
  InvalidDocumentError,
  parseDocument,
  serializeDocument,
  validateParsedObject,
} from './serialize'
import { decodeRecovery } from './recovery'
import { SCHEMA_VERSION } from '../../model/types'
import type { FurnitureId, WallId } from '../../model/ids'

const golden = (name: string) =>
  readFileSync(new URL(`../../test/goldens/${name}`, import.meta.url), 'utf8')

const v1Basic = golden('v1-basic.homeplanr')
const v1Full = golden('v1-full.homeplanr')

const deepFreeze = (o: unknown): void => {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
}

describe('schema migrations (v1 goldens)', () => {
  it('v1-basic opens silently: schemaVersion 2, healed=false, zero warnings', () => {
    const r = parseDocument(v1Basic)
    expect(r.doc.schemaVersion).toBe(2)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
  })

  it('v1-full opens with all entities and metadata intact, unitDisplay gone', () => {
    const raw = JSON.parse(v1Full)
    const { doc, warnings, healed } = parseDocument(v1Full)
    expect(warnings).toHaveLength(0)
    expect(healed).toBe(false)
    expect(Object.keys(doc.walls)).toHaveLength(Object.keys(raw.walls).length)
    expect(Object.keys(doc.openings)).toHaveLength(Object.keys(raw.openings).length)
    expect(Object.keys(doc.rooms)).toHaveLength(Object.keys(raw.rooms).length)
    expect(Object.keys(doc.furniture)).toHaveLength(Object.keys(raw.furniture).length)
    const living = Object.values(doc.rooms).find((r) => r.name === 'Living room')
    expect(living?.floorMaterialId).toBe('darkFloor')
    expect(Object.keys(doc.settings)).not.toContain('unitDisplay')
  })

  it('migration steps are pure: frozen v1 input is untouched, output is v2', () => {
    const raw = JSON.parse(v1Full)
    const snapshot = JSON.stringify(raw)
    deepFreeze(raw)
    const { doc } = validateParsedObject(raw)
    expect(JSON.stringify(raw)).toBe(snapshot)
    expect(doc.schemaVersion).toBe(2)
  })

  it('v1 recovery blob decodes through the migration chokepoint', () => {
    const json = JSON.stringify({
      v: 1,
      filePath: null,
      docId: 'x',
      savedAt: 1,
      doc: JSON.parse(v1Basic),
    })
    const blob = decodeRecovery(json)
    expect(blob).not.toBeNull()
    expect(blob!.doc.schemaVersion).toBe(2)
    expect(Object.keys(blob!.doc.walls)).toHaveLength(4)
  })

  it('schemaVersion 3 refuses with ForwardVersionError', () => {
    const raw = JSON.parse(v1Basic)
    raw.schemaVersion = 3
    expect(() => validateParsedObject(raw)).toThrow(ForwardVersionError)
  })

  it('unreachable versions refuse with InvalidDocumentError (no migration path)', () => {
    const raw = JSON.parse(v1Basic)
    raw.schemaVersion = 0
    expect(() => validateParsedObject(raw)).toThrow(InvalidDocumentError)
  })

  it('junk spread onto a v1 envelope parses or throws only document errors', () => {
    fc.assert(
      fc.property(fc.object(), (junk) => {
        try {
          const r = validateParsedObject({ ...junk, schemaVersion: 1 })
          expect(r.doc.schemaVersion).toBe(SCHEMA_VERSION)
        } catch (e) {
          if (!(e instanceof InvalidDocumentError) && !(e instanceof ForwardVersionError)) {
            throw e
          }
        }
      }),
    )
  })
})

describe('v2 fields (wall paint/finish, furniture mirror)', () => {
  it('roundtrips valid values, preserving unknown paint ids', () => {
    const { doc } = parseDocument(v1Full)
    const wall = Object.values(doc.walls)[0]!
    wall.paintFront = 'sage'
    wall.paintBack = 'limewash-2027' // not in WALL_PAINTS — must survive anyway
    wall.finish = 'brick'
    const item = Object.values(doc.furniture)[0]!
    item.mirrored = true
    const r = parseDocument(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    const w = r.doc.walls[wall.id]!
    expect(w.paintFront).toBe('sage')
    expect(w.paintBack).toBe('limewash-2027')
    expect(w.finish).toBe('brick')
    expect(r.doc.furniture[item.id]!.mirrored).toBe(true)
  })

  it('keeps flat furniture flat: 0.02m height survives the validator clamp', () => {
    const { doc } = parseDocument(v1Full)
    const item = Object.values(doc.furniture)[0]!
    item.size = { ...item.size, h: 0.02 }
    const r = parseDocument(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    expect(r.doc.furniture[item.id]!.size.h).toBeCloseTo(0.02, 9)
  })

  it('normalizes invalid values to absent, silently', () => {
    const { doc } = parseDocument(v1Full)
    const json = JSON.parse(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    const wallIds = Object.keys(json.walls) as WallId[]
    const [wa, wb] = [wallIds[0]!, wallIds[1]!]
    json.walls[wa].finish = 'x'
    json.walls[wa].paintFront = ''
    json.walls[wb].finish = 'paint'
    const fid = Object.keys(json.furniture)[0]! as FurnitureId
    json.furniture[fid].mirrored = 'yes'
    const r = parseDocument(JSON.stringify(json))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    expect('finish' in r.doc.walls[wa]!).toBe(false)
    expect('paintFront' in r.doc.walls[wa]!).toBe(false)
    expect('finish' in r.doc.walls[wb]!).toBe(false)
    expect('mirrored' in r.doc.furniture[fid]!).toBe(false)
  })
})
