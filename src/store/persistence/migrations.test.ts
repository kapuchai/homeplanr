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
const v2Basic = golden('v2-basic.homeplanr')
const v2Full = golden('v2-full.homeplanr')

const deepFreeze = (o: unknown): void => {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
}

describe('schema migrations (v1 goldens)', () => {
  it('EVERY historical golden opens silently: current version, healed=false, zero warnings', () => {
    for (const g of [v1Basic, v1Full, v2Basic, v2Full]) {
      const r = parseDocument(g)
      expect(r.doc.schemaVersion).toBe(SCHEMA_VERSION)
      expect(r.healed).toBe(false)
      expect(r.warnings).toHaveLength(0)
    }
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

  it('migration steps are pure: frozen v1/v2 inputs are untouched, output is current', () => {
    for (const g of [v1Full, v2Full]) {
      const raw = JSON.parse(g)
      const snapshot = JSON.stringify(raw)
      deepFreeze(raw)
      const { doc } = validateParsedObject(raw)
      expect(JSON.stringify(raw)).toBe(snapshot)
      expect(doc.schemaVersion).toBe(SCHEMA_VERSION)
    }
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
    expect(blob!.doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(Object.keys(blob!.doc.walls)).toHaveLength(4)
  })

  it(`schemaVersion ${SCHEMA_VERSION + 1} refuses with ForwardVersionError`, () => {
    const raw = JSON.parse(v1Basic)
    raw.schemaVersion = SCHEMA_VERSION + 1
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

describe('v3: snapEnabled leaves the document; annotations arrive', () => {
  it('a v2 doc with snapEnabled opens clean — the field is gone, nothing healed', () => {
    const raw = JSON.parse(v2Full)
    expect(raw.settings.snapEnabled).toBe(false) // frozen into the golden
    const r = validateParsedObject(raw)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(Object.keys(r.doc.settings)).not.toContain('snapEnabled')
    expect(r.doc.annotations).toEqual({})
  })

  it('v2 feature fields survive the v2→v3 migration (paint, finish, mirror, floor)', () => {
    const { doc } = parseDocument(v2Full)
    const painted = Object.values(doc.walls).find((w) => w.paintFront)
    expect(painted?.paintFront).toBe('sage')
    expect(painted?.paintBack).toBe('terracotta')
    expect(painted?.finish).toBe('brick')
    expect(Object.values(doc.furniture).some((f) => f.mirrored)).toBe(true)
    expect(Object.values(doc.rooms).some((r) => r.floorMaterialId === 'darkFloor')).toBe(true)
  })

  it('annotations roundtrip: dimension + label, clean and unhealed', () => {
    const { doc } = parseDocument(v2Basic)
    doc.annotations['a_dim1' as never] = {
      id: 'a_dim1' as never,
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      offset: 0.5,
    }
    doc.annotations['a_lab1' as never] = {
      id: 'a_lab1' as never,
      kind: 'label',
      x: 2,
      y: 1.5,
      text: 'Kitchen nook',
      rotation: Math.PI / 6,
      fontSize: 0.2,
    }
    const r = parseDocument(serializeDocument(doc, '2026-07-13T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    const dim = r.doc.annotations['a_dim1' as never]!
    expect(dim.kind).toBe('dimension')
    expect(dim.kind === 'dimension' && dim.b.x).toBe(4)
    expect(dim.kind === 'dimension' && dim.offset).toBe(0.5)
    const lab = r.doc.annotations['a_lab1' as never]!
    expect(lab.kind === 'label' && lab.text).toBe('Kitchen nook')
    expect(lab.kind === 'label' && lab.fontSize).toBe(0.2)
  })

  it('invalid annotation FIELDS normalize silently; broken ENTITIES prune with a warning', () => {
    const base = JSON.parse(v2Basic)
    base.schemaVersion = 3
    base.annotations = {
      a_ok: { kind: 'label', x: 1, y: 1, text: 'ok', rotation: 'sideways', fontSize: 99 },
      a_far: { kind: 'dimension', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, offset: 999 },
      a_tiny: { kind: 'dimension', a: { x: 0, y: 0 }, b: { x: 0.001, y: 0 }, offset: 0 },
      a_blank: { kind: 'label', x: 0, y: 0, text: '   ' },
      a_junk: { kind: 'sticker', x: 0, y: 0 },
    }
    const r = validateParsedObject(base)
    const ok = r.doc.annotations['a_ok' as never]!
    expect('rotation' in ok).toBe(false) // invalid → field absent, silent
    expect(ok.kind === 'label' && ok.fontSize).toBe(1) // clamped into [0.05, 1]
    const far = r.doc.annotations['a_far' as never]!
    expect(far.kind === 'dimension' && far.offset).toBe(20) // clamped
    expect(r.doc.annotations['a_tiny' as never]).toBeUndefined()
    expect(r.doc.annotations['a_blank' as never]).toBeUndefined()
    expect(r.doc.annotations['a_junk' as never]).toBeUndefined()
    expect(r.warnings).toHaveLength(3) // one per pruned entity
  })

  it('valid annotations round a save/open trip without warnings or healing', () => {
    const { doc } = parseDocument(v2Basic)
    doc.annotations['a_x' as never] = {
      id: 'a_x' as never,
      kind: 'label',
      x: 0,
      y: 0,
      text: 'hi',
    }
    const r = parseDocument(serializeDocument(doc, '2026-07-13T00:00:00.000Z'))
    expect(r.healed).toBe(false)
  })
})
