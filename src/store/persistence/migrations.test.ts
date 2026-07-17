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
import { addArea } from '../../model/mutations/annotations'
import { addWallSegment } from '../../model/mutations/walls'
import { reconcileRooms } from '../../model/mutations/rooms'
import { vec } from '../../geometry/vec'

const golden = (name: string) =>
  readFileSync(new URL(`../../test/goldens/${name}`, import.meta.url), 'utf8')

const v1Basic = golden('v1-basic.homeplanr')
const v1Full = golden('v1-full.homeplanr')
const v2Basic = golden('v2-basic.homeplanr')
const v2Full = golden('v2-full.homeplanr')
const v3Basic = golden('v3-basic.homeplanr')
const v3Full = golden('v3-full.homeplanr')
const v4Basic = golden('v4-basic.homeplanr')
const v4Full = golden('v4-full.homeplanr')

const deepFreeze = (o: unknown): void => {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
}

describe('schema migrations (v1 goldens)', () => {
  it('EVERY historical golden opens silently: current version, healed=false, zero warnings', () => {
    for (const g of [v1Basic, v1Full, v2Basic, v2Full, v3Basic, v3Full, v4Basic, v4Full]) {
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

  it('migration steps are pure: frozen v1..v4 inputs are untouched, output is current', () => {
    // v3Full and v4Full both carry finish:'brick' — the field-SPLITTING
    // v4→v5 migration must build new wall objects, never mutate frozen input
    for (const g of [v1Full, v2Full, v3Full, v4Full]) {
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
    wall.finishFront = 'brick'
    wall.finishBack = 'microcement-2030' // finish is open too (v5) — survives
    const item = Object.values(doc.furniture)[0]!
    item.mirrored = true
    const r = parseDocument(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    const w = r.doc.walls[wall.id]!
    expect(w.paintFront).toBe('sage')
    expect(w.paintBack).toBe('limewash-2027')
    expect(w.finishFront).toBe('brick')
    expect(w.finishBack).toBe('microcement-2030')
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
    json.walls[wa].finishFront = 5 // non-string junk
    json.walls[wa].paintFront = ''
    json.walls[wb].finishFront = 'paint' // the absent-default normalizes away
    json.walls[wb].finishBack = ''
    const fid = Object.keys(json.furniture)[0]! as FurnitureId
    json.furniture[fid].mirrored = 'yes'
    const r = parseDocument(JSON.stringify(json))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    expect('finishFront' in r.doc.walls[wa]!).toBe(false)
    expect('paintFront' in r.doc.walls[wa]!).toBe(false)
    expect('finishFront' in r.doc.walls[wb]!).toBe(false)
    expect('finishBack' in r.doc.walls[wb]!).toBe(false)
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
    // the single v2-era finish arrives per-side after the v4→v5 split
    expect(painted?.finishFront).toBe('brick')
    expect(painted?.finishBack).toBe('brick')
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

describe('v4: area annotations + roomType / price / notes / materialOverrides', () => {
  it('v3-full opens clean with its frozen annotations intact', () => {
    const r = parseDocument(v3Full)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    const anns = Object.values(r.doc.annotations)
    const dim = anns.find((a) => a.kind === 'dimension')
    expect(dim?.kind === 'dimension' && dim.offset).toBe(0.35)
    const lab = anns.find((a) => a.kind === 'label')
    expect(lab?.kind === 'label' && lab.fontSize).toBe(0.2)
    expect(lab?.kind === 'label' && lab.text).toBe('Golden label')
  })

  it('a v3 recovery blob decodes through the migration chokepoint', () => {
    const json = JSON.stringify({
      v: 1,
      filePath: null,
      docId: 'x',
      savedAt: 1,
      doc: JSON.parse(v3Basic),
    })
    const blob = decodeRecovery(json)
    expect(blob).not.toBeNull()
    expect(blob!.doc.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('area annotations roundtrip; junk vertices drop; degenerate polygons prune', () => {
    const { doc } = parseDocument(v3Basic)
    const id = addArea(doc, [vec(0, 0), vec(2, 0), vec(2, 2), vec(0, 2)])
    expect(id).not.toBeNull()
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    const area = r.doc.annotations[id! as never]!
    expect(area.kind === 'area' && area.points).toHaveLength(4)

    const base = JSON.parse(v3Basic)
    base.schemaVersion = 4
    base.annotations = {
      a_mixed: {
        kind: 'area',
        points: [{ x: 0, y: 0 }, { x: 'a', y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, null],
      },
      a_degenerate: { kind: 'area', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      a_pointless: { kind: 'area' },
      // 3 finite but collinear points: zero area ⇒ culled everywhere ⇒ an
      // invisible unclickable ghost — the validator applies the addArea guard
      a_collinear: {
        kind: 'area',
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      },
    }
    const v = validateParsedObject(base)
    const mixed = v.doc.annotations['a_mixed' as never]!
    expect(mixed.kind === 'area' && mixed.points).toHaveLength(3) // junk vertices dropped
    expect(v.doc.annotations['a_degenerate' as never]).toBeUndefined()
    expect(v.doc.annotations['a_pointless' as never]).toBeUndefined()
    expect(v.doc.annotations['a_collinear' as never]).toBeUndefined()
    expect(v.warnings).toHaveLength(3)
  })

  it('addArea rejects degenerate traces (< 3 points, near-zero area)', () => {
    const { doc } = parseDocument(v3Basic)
    expect(addArea(doc, [vec(0, 0), vec(1, 0)])).toBeNull()
    expect(addArea(doc, [vec(0, 0), vec(1, 0), vec(2, 0)])).toBeNull() // collinear
  })

  it('batched v4 fields roundtrip; junk values normalize silently', () => {
    const { doc } = parseDocument(v3Full)
    const room = Object.values(doc.rooms)[0]!
    room.roomType = 'balcony'
    const item = Object.values(doc.furniture)[0]!
    item.price = 129.99
    item.notes = 'IKEA, 2024'
    item.materialOverrides = { fabric: '#aabbcc', legs: 'oakDark' }
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.rooms[room.id]!.roomType).toBe('balcony')
    const f2 = r.doc.furniture[item.id]!
    expect(f2.price).toBe(129.99)
    expect(f2.notes).toBe('IKEA, 2024')
    expect(f2.materialOverrides).toEqual({ fabric: '#aabbcc', legs: 'oakDark' })

    const base = JSON.parse(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    const roomKey = room.id as string
    const itemKey = item.id as string
    base.rooms[roomKey].roomType = ''
    base.furniture[itemKey].price = 'free'
    base.furniture[itemKey].notes = 42
    base.furniture[itemKey].materialOverrides = { fabric: 7, legs: 'oakDark', '': 'x' }
    const v = validateParsedObject(base)
    expect(v.warnings).toHaveLength(0) // field-level junk is silent
    expect(v.doc.rooms[room.id]!.roomType).toBeUndefined()
    const f3 = v.doc.furniture[item.id]!
    expect(f3.price).toBeUndefined()
    expect(f3.notes).toBeUndefined()
    expect(f3.materialOverrides).toEqual({ legs: 'oakDark' }) // junk ENTRIES drop
  })

  it('roomType survives a room-splitting edit (as durable as name)', () => {
    const { doc } = parseDocument(v3Basic) // one 4×3 room
    const room = Object.values(doc.rooms)[0]!
    room.roomType = 'bedroom'
    room.name = 'Master'
    addWallSegment(doc, vec(2, 0), vec(2, 3)) // split into two 2×3 rooms
    reconcileRooms(doc)
    const rooms = Object.values(doc.rooms)
    expect(rooms).toHaveLength(2)
    // the identity carrier (Jaccard ≥ 0.3) keeps BOTH meta fields together
    const carrier = rooms.find((r) => r.roomType === 'bedroom')
    expect(carrier).toBeDefined()
    expect(carrier!.name).toBe('Master')
  })
})

describe('v5: per-side wall finish (finishFront/finishBack)', () => {
  it('v4-full opens clean with every frozen v4 feature intact', () => {
    const r = parseDocument(v4Full)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    const living = Object.values(r.doc.rooms).find((room) => room.name === 'Living room')
    expect(living?.roomType).toBe('living')
    expect(living?.floorMaterialId).toBe('darkFloor')
    const item = Object.values(r.doc.furniture).find((f) => f.price !== undefined)!
    expect(item.price).toBe(499)
    expect(item.notes).toBe('Golden notes')
    expect(item.materialOverrides).toEqual({ fabric: 'oak', legs: '#334455' })
    expect(Object.values(r.doc.annotations).some((a) => a.kind === 'area')).toBe(true)
  })

  it("the golden's single finish:'brick' arrives split onto BOTH sides, old key gone", () => {
    const raw = JSON.parse(v4Full)
    const brickKey = Object.keys(raw.walls).find((k) => raw.walls[k].finish === 'brick')!
    expect(brickKey).toBeDefined()
    const { doc } = parseDocument(v4Full)
    const w = doc.walls[brickKey as WallId]!
    expect(w.finishFront).toBe('brick')
    expect(w.finishBack).toBe('brick')
    expect('finish' in w).toBe(false)
  })

  it('unknown finish strings migrate preserved (open registry); junk drops silently', () => {
    const raw = JSON.parse(v4Basic)
    const keys = Object.keys(raw.walls)
    raw.walls[keys[0]!].finish = 'weathered-brick-2030' // future patch id
    raw.walls[keys[1]!].finish = 'paint' // absent-default
    raw.walls[keys[2]!].finish = 5 // junk
    raw.walls[keys[3]!].finish = '' // junk
    const r = validateParsedObject(raw)
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    const w0 = r.doc.walls[keys[0]! as WallId]!
    expect(w0.finishFront).toBe('weathered-brick-2030')
    expect(w0.finishBack).toBe('weathered-brick-2030')
    for (const k of keys.slice(1)) {
      expect('finishFront' in r.doc.walls[k as WallId]!).toBe(false)
      expect('finishBack' in r.doc.walls[k as WallId]!).toBe(false)
    }
  })

  it('per-side values roundtrip at v5 — different sides stay different', () => {
    const { doc } = parseDocument(v4Basic)
    const wall = Object.values(doc.walls)[0]!
    wall.finishFront = 'tile'
    wall.finishBack = 'concrete'
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.walls[wall.id]!.finishFront).toBe('tile')
    expect(r.doc.walls[wall.id]!.finishBack).toBe('concrete')
  })

  it('a v4 recovery blob decodes through the migration chokepoint', () => {
    const json = JSON.stringify({
      v: 1,
      filePath: null,
      docId: 'x',
      savedAt: 1,
      doc: JSON.parse(v4Basic),
    })
    const blob = decodeRecovery(json)
    expect(blob).not.toBeNull()
    expect(blob!.doc.schemaVersion).toBe(SCHEMA_VERSION)
  })
})
