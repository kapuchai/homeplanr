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
import { SCHEMA_VERSION, type ProjectDocument } from '../../model/types'
import { makeLevelDoc } from '../../model/levels'
import type { FurnitureId, WallId } from '../../model/ids'
import { addArea } from '../../model/mutations/annotations'
import { addWallSegment } from '../../model/mutations/walls'
import { reconcileRooms } from '../../model/mutations/rooms'
import { vec } from '../../geometry/vec'

/** Ground level of a CURRENT-version (v7) parsed document — entity maps
 * live in levels[0]; raw pre-v7 fixture JSON keeps its flat maps. */
const lv = (d: ProjectDocument) => d.levels[0]!
const lvDoc = (d: ProjectDocument) => makeLevelDoc(d, lv(d))

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
const v5Basic = golden('v5-basic.homeplanr')
const v5Full = golden('v5-full.homeplanr')
const v6Basic = golden('v6-basic.homeplanr')
const v6Full = golden('v6-full.homeplanr')

const deepFreeze = (o: unknown): void => {
  if (typeof o === 'object' && o !== null) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
}

describe('schema migrations (v1 goldens)', () => {
  it('EVERY historical golden opens silently: current version, healed=false, zero warnings', () => {
    for (const g of [
      v1Basic,
      v1Full,
      v2Basic,
      v2Full,
      v3Basic,
      v3Full,
      v4Basic,
      v4Full,
      v5Basic,
      v5Full,
      v6Basic,
      v6Full,
    ]) {
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
    expect(Object.keys(lv(doc).walls)).toHaveLength(Object.keys(raw.walls).length)
    expect(Object.keys(lv(doc).openings)).toHaveLength(Object.keys(raw.openings).length)
    expect(Object.keys(lv(doc).rooms)).toHaveLength(Object.keys(raw.rooms).length)
    expect(Object.keys(lv(doc).furniture)).toHaveLength(Object.keys(raw.furniture).length)
    const living = Object.values(lv(doc).rooms).find((r) => r.name === 'Living room')
    expect(living?.floorMaterialId).toBe('darkFloor')
    expect(Object.keys(doc.settings)).not.toContain('unitDisplay')
  })

  it('migration steps are pure: frozen v1..v5 inputs are untouched, output is current', () => {
    // v3Full and v4Full both carry finish:'brick' — the field-SPLITTING
    // v4→v5 migration must build new wall objects, never mutate frozen input;
    // v6Full crosses the STRUCTURAL v6→v7 levels wrap the same way
    for (const g of [v1Full, v2Full, v3Full, v4Full, v5Full, v6Full]) {
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
    expect(Object.keys(lv(blob!.doc).walls)).toHaveLength(4)
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
    const wall = Object.values(lv(doc).walls)[0]!
    wall.paintFront = 'sage'
    wall.paintBack = 'limewash-2027' // not in WALL_PAINTS — must survive anyway
    wall.finishFront = 'brick'
    wall.finishBack = 'microcement-2030' // finish is open too (v5) — survives
    const item = Object.values(lv(doc).furniture)[0]!
    item.mirrored = true
    const r = parseDocument(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    const w = lv(r.doc).walls[wall.id]!
    expect(w.paintFront).toBe('sage')
    expect(w.paintBack).toBe('limewash-2027')
    expect(w.finishFront).toBe('brick')
    expect(w.finishBack).toBe('microcement-2030')
    expect(lv(r.doc).furniture[item.id]!.mirrored).toBe(true)
  })

  it('keeps flat furniture flat: 0.02m height survives the validator clamp', () => {
    const { doc } = parseDocument(v1Full)
    const item = Object.values(lv(doc).furniture)[0]!
    item.size = { ...item.size, h: 0.02 }
    const r = parseDocument(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    expect(lv(r.doc).furniture[item.id]!.size.h).toBeCloseTo(0.02, 9)
  })

  it('normalizes invalid values to absent, silently', () => {
    const { doc } = parseDocument(v1Full)
    const json = JSON.parse(serializeDocument(doc, '2026-07-12T00:00:00.000Z'))
    const wallIds = Object.keys(json.levels[0].walls) as WallId[]
    const [wa, wb] = [wallIds[0]!, wallIds[1]!]
    json.levels[0].walls[wa].finishFront = 5 // non-string junk
    json.levels[0].walls[wa].paintFront = ''
    json.levels[0].walls[wb].finishFront = 'paint' // the absent-default normalizes away
    json.levels[0].walls[wb].finishBack = ''
    const fid = Object.keys(json.levels[0].furniture)[0]! as FurnitureId
    json.levels[0].furniture[fid].mirrored = 'yes'
    const r = parseDocument(JSON.stringify(json))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    expect('finishFront' in lv(r.doc).walls[wa]!).toBe(false)
    expect('paintFront' in lv(r.doc).walls[wa]!).toBe(false)
    expect('finishFront' in lv(r.doc).walls[wb]!).toBe(false)
    expect('finishBack' in lv(r.doc).walls[wb]!).toBe(false)
    expect('mirrored' in lv(r.doc).furniture[fid]!).toBe(false)
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
    expect(lv(r.doc).annotations).toEqual({})
  })

  it('v2 feature fields survive the v2→v3 migration (paint, finish, mirror, floor)', () => {
    const { doc } = parseDocument(v2Full)
    const painted = Object.values(lv(doc).walls).find((w) => w.paintFront)
    expect(painted?.paintFront).toBe('sage')
    expect(painted?.paintBack).toBe('terracotta')
    // the single v2-era finish arrives per-side after the v4→v5 split
    expect(painted?.finishFront).toBe('brick')
    expect(painted?.finishBack).toBe('brick')
    expect(Object.values(lv(doc).furniture).some((f) => f.mirrored)).toBe(true)
    expect(Object.values(lv(doc).rooms).some((r) => r.floorMaterialId === 'darkFloor')).toBe(true)
  })

  it('annotations roundtrip: dimension + label, clean and unhealed', () => {
    const { doc } = parseDocument(v2Basic)
    lv(doc).annotations['a_dim1' as never] = {
      id: 'a_dim1' as never,
      kind: 'dimension',
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      offset: 0.5,
    }
    lv(doc).annotations['a_lab1' as never] = {
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
    const dim = lv(r.doc).annotations['a_dim1' as never]!
    expect(dim.kind).toBe('dimension')
    expect(dim.kind === 'dimension' && dim.b.x).toBe(4)
    expect(dim.kind === 'dimension' && dim.offset).toBe(0.5)
    const lab = lv(r.doc).annotations['a_lab1' as never]!
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
    const ok = lv(r.doc).annotations['a_ok' as never]!
    expect('rotation' in ok).toBe(false) // invalid → field absent, silent
    expect(ok.kind === 'label' && ok.fontSize).toBe(1) // clamped into [0.05, 1]
    const far = lv(r.doc).annotations['a_far' as never]!
    expect(far.kind === 'dimension' && far.offset).toBe(20) // clamped
    expect(lv(r.doc).annotations['a_tiny' as never]).toBeUndefined()
    expect(lv(r.doc).annotations['a_blank' as never]).toBeUndefined()
    expect(lv(r.doc).annotations['a_junk' as never]).toBeUndefined()
    expect(r.warnings).toHaveLength(3) // one per pruned entity
  })

  it('valid annotations round a save/open trip without warnings or healing', () => {
    const { doc } = parseDocument(v2Basic)
    lv(doc).annotations['a_x' as never] = {
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
    const anns = Object.values(lv(r.doc).annotations)
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
    const id = addArea(lvDoc(doc), [vec(0, 0), vec(2, 0), vec(2, 2), vec(0, 2)])
    expect(id).not.toBeNull()
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    const area = lv(r.doc).annotations[id! as never]!
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
    const mixed = lv(v.doc).annotations['a_mixed' as never]!
    expect(mixed.kind === 'area' && mixed.points).toHaveLength(3) // junk vertices dropped
    expect(lv(v.doc).annotations['a_degenerate' as never]).toBeUndefined()
    expect(lv(v.doc).annotations['a_pointless' as never]).toBeUndefined()
    expect(lv(v.doc).annotations['a_collinear' as never]).toBeUndefined()
    expect(v.warnings).toHaveLength(3)
  })

  it('addArea rejects degenerate traces (< 3 points, near-zero area)', () => {
    const { doc } = parseDocument(v3Basic)
    expect(addArea(lvDoc(doc), [vec(0, 0), vec(1, 0)])).toBeNull()
    expect(addArea(lvDoc(doc), [vec(0, 0), vec(1, 0), vec(2, 0)])).toBeNull() // collinear
  })

  it('batched v4 fields roundtrip; junk values normalize silently', () => {
    const { doc } = parseDocument(v3Full)
    const room = Object.values(lv(doc).rooms)[0]!
    room.roomType = 'balcony'
    const item = Object.values(lv(doc).furniture)[0]!
    item.price = 129.99
    item.notes = 'IKEA, 2024'
    item.materialOverrides = { fabric: '#aabbcc', legs: 'oakDark' }
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(lv(r.doc).rooms[room.id]!.roomType).toBe('balcony')
    const f2 = lv(r.doc).furniture[item.id]!
    expect(f2.price).toBe(129.99)
    expect(f2.notes).toBe('IKEA, 2024')
    expect(f2.materialOverrides).toEqual({ fabric: '#aabbcc', legs: 'oakDark' })

    const base = JSON.parse(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    const roomKey = room.id as string
    const itemKey = item.id as string
    base.levels[0].rooms[roomKey].roomType = ''
    base.levels[0].furniture[itemKey].price = 'free'
    base.levels[0].furniture[itemKey].notes = 42
    base.levels[0].furniture[itemKey].materialOverrides = { fabric: 7, legs: 'oakDark', '': 'x' }
    const v = validateParsedObject(base)
    expect(v.warnings).toHaveLength(0) // field-level junk is silent
    expect(lv(v.doc).rooms[room.id]!.roomType).toBeUndefined()
    const f3 = lv(v.doc).furniture[item.id]!
    expect(f3.price).toBeUndefined()
    expect(f3.notes).toBeUndefined()
    expect(f3.materialOverrides).toEqual({ legs: 'oakDark' }) // junk ENTRIES drop
  })

  it('roomType survives a room-splitting edit (as durable as name)', () => {
    const { doc } = parseDocument(v3Basic) // one 4×3 room
    const room = Object.values(lv(doc).rooms)[0]!
    room.roomType = 'bedroom'
    room.name = 'Master'
    addWallSegment(lvDoc(doc), vec(2, 0), vec(2, 3)) // split into two 2×3 rooms
    reconcileRooms(lvDoc(doc))
    const rooms = Object.values(lv(doc).rooms)
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
    const living = Object.values(lv(r.doc).rooms).find((room) => room.name === 'Living room')
    expect(living?.roomType).toBe('living')
    expect(living?.floorMaterialId).toBe('darkFloor')
    const item = Object.values(lv(r.doc).furniture).find((f) => f.price !== undefined)!
    expect(item.price).toBe(499)
    expect(item.notes).toBe('Golden notes')
    expect(item.materialOverrides).toEqual({ fabric: 'oak', legs: '#334455' })
    expect(Object.values(lv(r.doc).annotations).some((a) => a.kind === 'area')).toBe(true)
  })

  it("the golden's single finish:'brick' arrives split onto BOTH sides, old key gone", () => {
    const raw = JSON.parse(v4Full)
    const brickKey = Object.keys(raw.walls).find((k) => raw.walls[k].finish === 'brick')!
    expect(brickKey).toBeDefined()
    const { doc } = parseDocument(v4Full)
    const w = lv(doc).walls[brickKey as WallId]!
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
    const w0 = lv(r.doc).walls[keys[0]! as WallId]!
    expect(w0.finishFront).toBe('weathered-brick-2030')
    expect(w0.finishBack).toBe('weathered-brick-2030')
    for (const k of keys.slice(1)) {
      expect('finishFront' in lv(r.doc).walls[k as WallId]!).toBe(false)
      expect('finishBack' in lv(r.doc).walls[k as WallId]!).toBe(false)
    }
  })

  it('per-side values roundtrip at v5 — different sides stay different', () => {
    const { doc } = parseDocument(v4Basic)
    const wall = Object.values(lv(doc).walls)[0]!
    wall.finishFront = 'tile'
    wall.finishBack = 'concrete'
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(lv(r.doc).walls[wall.id]!.finishFront).toBe('tile')
    expect(lv(r.doc).walls[wall.id]!.finishBack).toBe('concrete')
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

describe('v6: embedded image assets + batched style/lumen/lightOn', () => {
  it('v5-full opens clean with every frozen v5 feature intact', () => {
    const r = parseDocument(v5Full)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    const living = Object.values(lv(r.doc).rooms).find((room) => room.name === 'Living room')
    expect(living?.roomType).toBe('living')
    expect(living?.floorMaterialId).toBe('parquetHerringbone')
    const sided = Object.values(lv(r.doc).walls).find((w) => w.finishFront)!
    expect(sided.finishFront).toBe('wallpaperStripe')
    expect(sided.finishBack).toBe('plaster') // different sides stay different
    const item = Object.values(lv(r.doc).furniture).find((f) => f.price !== undefined)!
    expect(item.price).toBe(499)
    expect(item.materialOverrides).toEqual({ fabric: 'oak', legs: '#334455' })
  })

  it('a v5 doc (no assets key) migrates to an empty assets map', () => {
    const { doc } = parseDocument(v5Basic)
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(doc.assets).toEqual({})
  })

  it('assets + assetId roundtrip a save/open trip, clean and unhealed', () => {
    const { doc } = parseDocument(v5Full)
    doc.assets['i_art1' as never] = {
      id: 'i_art1' as never,
      mime: 'image/jpeg',
      data: 'aGVsbG8=',
      w: 640,
      h: 480,
    }
    const item = Object.values(lv(doc).furniture)[0]!
    item.assetId = 'i_art1' as never
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.assets['i_art1' as never]).toEqual({
      id: 'i_art1',
      mime: 'image/jpeg',
      data: 'aGVsbG8=',
      w: 640,
      h: 480,
    })
    expect(lv(r.doc).furniture[item.id]!.assetId).toBe('i_art1')
  })

  it('junk asset ENTRIES drop silently (no warning, healed=false)', () => {
    const base = JSON.parse(v5Basic)
    base.schemaVersion = 6
    base.assets = {
      i_ok: { mime: 'image/webp', data: 'AA==', w: 10, h: 10 },
      i_noMime: { mime: '', data: 'AA==', w: 10, h: 10 },
      i_noData: { mime: 'image/png', data: '', w: 10, h: 10 },
      i_badDims: { mime: 'image/png', data: 'AA==', w: 0, h: -3 },
      i_junk: 'not an object',
    }
    const r = validateParsedObject(base)
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    expect(Object.keys(r.doc.assets)).toEqual(['i_ok'])
  })

  it('dangling assetId is KEPT (placeholder renders); a dangling attachment detaches at load', () => {
    const { doc } = parseDocument(v5Full)
    const item = Object.values(lv(doc).furniture)[0]!
    item.assetId = 'i_gone' as never
    item.attachedOpeningId = 'o_gone' as never
    const before = { x: item.x, y: item.y }
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false)
    // a stripped-recovery blob must not lose the image REFERENCE
    expect(lv(r.doc).furniture[item.id]!.assetId).toBe('i_gone')
    // the load-time reconcile IS the commit-time detach for a gone window:
    // the field resolves away, the item stands at its stored transform
    expect(lv(r.doc).furniture[item.id]!.attachedOpeningId).toBeUndefined()
    expect(lv(r.doc).furniture[item.id]!.x).toBe(before.x)
    expect(lv(r.doc).furniture[item.id]!.y).toBe(before.y)
  })

  it('previewAssetId/previewCustom (0.11.0 additive) roundtrip; junk drops; dangling kept', () => {
    const { doc } = parseDocument(v5Full)
    doc.assets['i_prev' as never] = {
      id: 'i_prev' as never,
      mime: 'image/jpeg',
      data: 'cHJldg==',
      w: 512,
      h: 512,
    }
    doc.previewAssetId = 'i_prev' as never
    doc.previewCustom = true
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.previewAssetId).toBe('i_prev')
    expect(r.doc.previewCustom).toBe(true)
    expect(r.doc.assets['i_prev' as never]).toBeDefined()

    // junk values → both fields absent, silent
    const base = JSON.parse(v5Basic)
    base.schemaVersion = 6
    base.previewAssetId = 42
    base.previewCustom = 'yes'
    const j = validateParsedObject(base)
    expect(j.warnings).toHaveLength(0)
    expect(j.healed).toBe(false)
    expect(j.doc.previewAssetId).toBeUndefined()
    expect(j.doc.previewCustom).toBeUndefined()

    // dangling preview id KEPT (the auto path self-corrects at next save)
    const d2 = parseDocument(v5Full).doc
    d2.previewAssetId = 'i_gone' as never
    const r2 = parseDocument(serializeDocument(d2, '2026-07-17T00:00:00.000Z'))
    expect(r2.healed).toBe(false)
    expect(r2.doc.previewAssetId).toBe('i_gone')
  })

  it('batched v6 fields roundtrip; junk values normalize silently', () => {
    const { doc } = parseDocument(v5Full)
    const opening = Object.values(lv(doc).openings)[0]!
    opening.style = 'sliding' // 0.10.0 vocabulary — open registry today
    const item = Object.values(lv(doc).furniture)[0]!
    item.lumen = 800
    item.lightOn = false // both boolean values must survive, not just true
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(lv(r.doc).openings[opening.id]!.style).toBe('sliding')
    expect(lv(r.doc).furniture[item.id]!.lumen).toBe(800)
    expect(lv(r.doc).furniture[item.id]!.lightOn).toBe(false)

    const base = JSON.parse(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    const oKey = opening.id as string
    const fKey = item.id as string
    base.levels[0].openings[oKey].style = ''
    base.levels[0].furniture[fKey].lumen = -5
    base.levels[0].furniture[fKey].lightOn = 'on'
    base.levels[0].furniture[fKey].assetId = 42
    const v = validateParsedObject(base)
    expect(v.warnings).toHaveLength(0)
    expect('style' in lv(v.doc).openings[opening.id]!).toBe(false)
    const f = lv(v.doc).furniture[item.id]!
    expect(f.lumen).toBeUndefined()
    expect(f.lightOn).toBeUndefined()
    expect(f.assetId).toBeUndefined()
  })

  it('load-time self-heal re-syncs attached furniture SILENTLY (review fix)', () => {
    const { doc } = parseDocument(v5Full)
    const win = Object.values(lv(doc).openings).find((o) => o.kind === 'window')!
    // a curtain whose stored transform drifted (hand-edit / pre-clamp file)
    lv(doc).furniture['f_curt1' as never] = {
      id: 'f_curt1' as never,
      catalogItemId: 'curtain',
      x: 0,
      y: 0,
      rotation: 0,
      size: { w: 1.5, d: 0.2, h: 2.4 },
      elevation: 0,
      attachedOpeningId: win.id,
    }
    const r = parseDocument(serializeDocument(doc, '2026-07-17T00:00:00.000Z'))
    expect(r.warnings).toHaveLength(0)
    expect(r.healed).toBe(false) // furniture sync is silent, like a migration
    const curt = lv(r.doc).furniture['f_curt1' as never]!
    expect(curt.attachedOpeningId).toBe(win.id)
    // snapped onto the window's wall, no longer at the drifted origin
    expect(Math.hypot(curt.x, curt.y)).toBeGreaterThan(0.01)
    expect(curt.size.w).toBeCloseTo(win.width + 0.3)
  })

  it('a v5 recovery blob decodes through the migration chokepoint', () => {
    const json = JSON.stringify({
      v: 1,
      filePath: null,
      docId: 'x',
      savedAt: 1,
      doc: JSON.parse(v5Basic),
    })
    const blob = decodeRecovery(json)
    expect(blob).not.toBeNull()
    expect(blob!.doc.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('v7: storeys — the structural levels wrap (+ notes, floorElevation)', () => {
  it('v6-full opens clean with every frozen v6 feature intact', () => {
    const r = parseDocument(v6Full)
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.levels).toHaveLength(1)
    const L = lv(r.doc)
    const door = Object.values(L.openings).find((o) => o.kind === 'door' && o.style)!
    expect(door.style).toBe('double')
    const win = Object.values(L.openings).find((o) => o.kind === 'window' && o.style)!
    expect(win.style).toBe('arched')
    const art = Object.values(L.furniture).find((f) => f.assetId)!
    expect(r.doc.assets[art.assetId!]).toBeDefined()
    const curtain = Object.values(L.furniture).find((f) => f.attachedOpeningId)!
    expect(curtain.attachedOpeningId).toBe(win.id)
    const lamp = Object.values(L.furniture).find((f) => f.lumen !== undefined)!
    expect(lamp.lumen).toBe(1400)
    expect(lamp.lightOn).toBe(false)
    expect(r.doc.previewCustom).toBe(true)
    expect(r.doc.previewAssetId).toBeDefined()
    expect(r.doc.assets[r.doc.previewAssetId!]).toBeDefined()
  })

  it('the v6→v7 wrap moves the six maps into levels[0], counts preserved, flat keys gone', () => {
    const raw = JSON.parse(v6Full)
    const { doc, warnings, healed } = parseDocument(v6Full)
    expect(warnings).toHaveLength(0)
    expect(healed).toBe(false)
    expect(doc.levels).toHaveLength(1)
    const L = lv(doc)
    expect(Object.keys(L.walls)).toHaveLength(Object.keys(raw.walls).length)
    expect(Object.keys(L.openings)).toHaveLength(Object.keys(raw.openings).length)
    expect(Object.keys(L.rooms)).toHaveLength(Object.keys(raw.rooms).length)
    expect(Object.keys(L.furniture)).toHaveLength(Object.keys(raw.furniture).length)
    expect(Object.keys(L.annotations)).toHaveLength(Object.keys(raw.annotations).length)
    expect(Object.keys(doc.assets)).toHaveLength(Object.keys(raw.assets).length)
    for (const key of ['nodes', 'walls', 'openings', 'rooms', 'furniture', 'annotations']) {
      expect(key in doc).toBe(false)
    }
  })

  it('a v6 recovery blob decodes through the migration chokepoint', () => {
    const json = JSON.stringify({
      v: 1,
      filePath: null,
      docId: 'x',
      savedAt: 1,
      doc: JSON.parse(v6Basic),
    })
    const blob = decodeRecovery(json)
    expect(blob).not.toBeNull()
    expect(blob!.doc.schemaVersion).toBe(SCHEMA_VERSION)
    expect(blob!.doc.levels).toHaveLength(1)
    expect(Object.keys(lv(blob!.doc).walls)).toHaveLength(4)
  })

  it('a two-storey document roundtrips: per-level maps, name, elevation override', () => {
    const { doc } = parseDocument(v6Basic)
    doc.levels.push({
      id: 'l_second' as never,
      name: 'Floor 2',
      elevation: 3.1,
      nodes: {},
      walls: {},
      openings: {},
      rooms: {},
      furniture: {},
      annotations: {},
    })
    const up = makeLevelDoc(doc, doc.levels[1]!)
    addWallSegment(up, vec(0, 0), vec(4, 0))
    const r = parseDocument(serializeDocument(doc, '2026-07-18T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.levels).toHaveLength(2)
    expect(r.doc.levels[1]!.name).toBe('Floor 2')
    expect(r.doc.levels[1]!.elevation).toBe(3.1)
    expect(Object.keys(r.doc.levels[0]!.walls)).toHaveLength(4)
    expect(Object.keys(r.doc.levels[1]!.walls)).toHaveLength(1)
    // ground level: name/elevation stay absent (files stay clean)
    expect('name' in r.doc.levels[0]!).toBe(false)
    expect('elevation' in r.doc.levels[0]!).toBe(false)
  })

  it('per-level referential integrity: an opening pointing at another level\'s wall prunes', () => {
    const base = JSON.parse(serializeDocument(parseDocument(v6Basic).doc, '2026-07-18T00:00:00.000Z'))
    const groundWallId = Object.keys(base.levels[0].walls)[0]!
    base.levels.push({
      id: 'l_up',
      nodes: {},
      walls: {},
      openings: {
        o_cross: { kind: 'door', wallId: groundWallId, t: 0.5, width: 0.9, height: 2 },
      },
      rooms: {},
      furniture: {},
      annotations: {},
    })
    const r = validateParsedObject(base)
    expect(r.warnings.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(r.doc.levels[1]!.openings)).toHaveLength(0)
    expect(Object.keys(r.doc.levels[0]!.openings)).toHaveLength(0) // basic has none
  })

  it('a level-less v7 envelope mints one empty level (warned, healed)', () => {
    const base = JSON.parse(serializeDocument(parseDocument(v6Basic).doc, '2026-07-18T00:00:00.000Z'))
    base.levels = []
    const r = validateParsedObject(base)
    expect(r.doc.levels).toHaveLength(1)
    expect(r.warnings.length).toBeGreaterThanOrEqual(1)
    expect(r.healed).toBe(true)
  })

  it('junk level entries prune with a warning; duplicate level ids re-mint silently', () => {
    const base = JSON.parse(serializeDocument(parseDocument(v6Basic).doc, '2026-07-18T00:00:00.000Z'))
    const keep = base.levels[0]
    base.levels = [keep, 'not a level', { ...keep }]
    const r = validateParsedObject(base)
    expect(r.doc.levels).toHaveLength(2) // junk entry pruned, twin kept
    expect(r.warnings.some((w: string) => w.includes('level'))).toBe(true)
    expect(r.doc.levels[0]!.id).not.toBe(r.doc.levels[1]!.id) // dupe id re-minted
    expect(Object.keys(r.doc.levels[1]!.walls)).toHaveLength(4)
  })

  it('notes roundtrip; junk notes normalize silently', () => {
    const { doc } = parseDocument(v6Basic)
    doc.notes = 'Remember to check the loft headroom.'
    const r = parseDocument(serializeDocument(doc, '2026-07-18T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(r.doc.notes).toBe('Remember to check the loft headroom.')

    const base = JSON.parse(serializeDocument(doc, '2026-07-18T00:00:00.000Z'))
    base.notes = 42
    const v = validateParsedObject(base)
    expect(v.warnings).toHaveLength(0)
    expect(v.doc.notes).toBeUndefined()
  })

  it('floorElevation roundtrips capped; zero/junk stays absent', () => {
    const { doc } = parseDocument(v6Basic)
    const room = Object.values(lv(doc).rooms)[0]!
    room.floorElevation = 0.45
    const r = parseDocument(serializeDocument(doc, '2026-07-18T00:00:00.000Z'))
    expect(r.healed).toBe(false)
    expect(r.warnings).toHaveLength(0)
    expect(Object.values(lv(r.doc).rooms)[0]!.floorElevation).toBe(0.45)

    const base = JSON.parse(serializeDocument(doc, '2026-07-18T00:00:00.000Z'))
    const key = Object.keys(base.levels[0].rooms)[0]!
    base.levels[0].rooms[key].floorElevation = 99
    let v = validateParsedObject(base)
    expect(Object.values(lv(v.doc).rooms)[0]!.floorElevation).toBe(2) // capped
    base.levels[0].rooms[key].floorElevation = 0
    v = validateParsedObject(base)
    expect('floorElevation' in Object.values(lv(v.doc).rooms)[0]!).toBe(false)
    base.levels[0].rooms[key].floorElevation = 'high'
    v = validateParsedObject(base)
    expect('floorElevation' in Object.values(lv(v.doc).rooms)[0]!).toBe(false)
  })

  it('level elevation junk drops; extreme values clamp into [-100, 1000]', () => {
    const base = JSON.parse(serializeDocument(parseDocument(v6Basic).doc, '2026-07-18T00:00:00.000Z'))
    base.levels[0].elevation = 'penthouse'
    let r = validateParsedObject(base)
    expect('elevation' in r.doc.levels[0]!).toBe(false)
    base.levels[0].elevation = 99999
    r = validateParsedObject(base)
    expect(r.doc.levels[0]!.elevation).toBe(1000)
  })
})
