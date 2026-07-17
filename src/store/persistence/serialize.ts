import {
  DEFAULTS,
  SCHEMA_VERSION,
  defaultSettings,
  emptyLevel,
  type Level,
  type Opening,
  type ProjectDocument,
} from '../../model/types'
import { makeLevelDoc } from '../../model/levels'
import {
  asAnnotationId,
  asAssetId,
  asFurnitureId,
  asLevelId,
  asNodeId,
  asOpeningId,
  asRoomId,
  asWallId,
  newLevelId,
  newProjectId,
  type WallId,
} from '../../model/ids'
import { normalizeGraph } from '../../model/mutations/walls'
import { revalidateOpenings } from '../../model/mutations/openings'
import { reconcileRooms } from '../../model/mutations/rooms'
import { reconcileAttachedFurniture } from '../../model/mutations/attachment'
import { MIN_AREA_M2 } from '../../model/mutations/annotations'
import { area as polygonArea } from '../../geometry/polygon'

/**
 * Document (de)serialization — the .homeplanr file format is the JSON of
 * ProjectDocument, pretty-printed for diffability.
 *
 * Outcome enumeration (plan §persistence/serialize):
 * - invalid JSON / wrong root shape → InvalidDocumentError
 * - schemaVersion > current        → ForwardVersionError
 * - well-formed but damaged        → entities PRUNED with warnings, then the
 *   graph self-heals (normalize + revalidate + reconcile); `healed` reports
 *   whether anything changed — callers mark the doc dirty when it did.
 *
 * Mutations never touch updatedAt; serializeDocument stamps it on emit.
 */
export class InvalidDocumentError extends Error {}
export class ForwardVersionError extends Error {}

export function serializeDocument(doc: ProjectDocument, nowIso?: string): string {
  const stamped: ProjectDocument = {
    ...doc,
    updatedAt: nowIso ?? new Date().toISOString(),
  }
  return JSON.stringify(stamped, null, 2)
}

export interface ParseResult {
  doc: ProjectDocument
  warnings: string[]
  /** True when pruning or self-healing changed the document. */
  healed: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

/**
 * Migration registry: MIGRATIONS[N] upgrades a raw schema-N object to N+1.
 * Rules:
 * - pure: never mutate the input object (copy what you change);
 * - total: never throw on junk — the whitelist below prunes afterwards;
 * - NEVER push warnings: a version upgrade must not read as "repaired",
 *   `healed` must stay false for a clean older file.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: unitDisplay leaves the document — unit display is an app-level
  // preference, not document data.
  1: (raw) => {
    const settings = isObj(raw.settings) ? { ...raw.settings } : raw.settings
    if (isObj(settings)) delete settings.unitDisplay
    return { ...raw, settings, schemaVersion: 2 }
  },
  // v2 → v3: snapEnabled leaves the document (app-level preference — the
  // exact unitDisplay precedent; doc-level snap made every toggle an undo
  // entry and dirtied the file); annotations arrive (the validator defaults
  // the missing record — a migration must not invent entities).
  2: (raw) => {
    const settings = isObj(raw.settings) ? { ...raw.settings } : raw.settings
    if (isObj(settings)) delete settings.snapEnabled
    return { ...raw, settings, schemaVersion: 3 }
  },
  // v3 → v4: purely additive (the 'area' annotation kind + optional
  // roomType / price / notes / materialOverrides fields, all handled by the
  // validator) — identity bump, no data moves.
  3: (raw) => ({ ...raw, schemaVersion: 4 }),
  // v4 → v5: the both-faces `finish` splits into finishFront/finishBack
  // (paint parity). The first field-SPLITTING migration: new wall objects
  // only (inputs may be frozen — purity is load-bearing). Any non-empty
  // string except 'paint' (the absent-default) copies to BOTH sides —
  // unknown ids are preserved, consistent with the now-open registry;
  // junk (numbers/objects/'') just drops the field.
  4: (raw) => {
    if (!isObj(raw.walls)) return { ...raw, schemaVersion: 5 }
    const walls: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(raw.walls)) {
      if (!isObj(v)) {
        walls[key] = v // junk entries pass through; the validator prunes
        continue
      }
      const { finish, ...rest } = v
      walls[key] =
        isStr(finish) && finish && finish !== 'paint'
          ? { ...rest, finishFront: finish, finishBack: finish }
          : rest
    }
    return { ...raw, walls, schemaVersion: 5 }
  },
  // v5 → v6: purely additive (the top-level assets map + optional
  // assetId / attachedOpeningId / lumen / lightOn on furniture and
  // Opening.style, all handled by the validator) — identity bump, no data
  // moves. The batched style/lumen/lightOn fields ship ahead of their UIs
  // (0.10.0 / 0.12.0) like the v4 batch did.
  5: (raw) => ({ ...raw, schemaVersion: 6 }),
  // v6 → v7: the STRUCTURAL storeys wrap — the six entity maps move into
  // levels[0] (every pre-0.13.0 document is a one-level building). Assets
  // stay top-level (shared across levels); settings/preview/dates
  // untouched. Map references are copied, never mutated (purity); junk
  // map values ride along for the validator to judge, exactly as before.
  6: (raw) => {
    const { nodes, walls, openings, rooms, furniture, annotations, ...rest } = raw
    return {
      ...rest,
      levels: [{ id: newLevelId(), nodes, walls, openings, rooms, furniture, annotations }],
      schemaVersion: 7,
    }
  },
}

export function parseDocument(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new InvalidDocumentError('File is not valid JSON')
  }
  return validateParsedObject(raw)
}

/** Validate + heal an already-parsed candidate document object. */
export function validateParsedObject(raw: unknown): ParseResult {
  if (!isObj(raw)) throw new InvalidDocumentError('Not a homeplanr document')
  const version = raw.schemaVersion
  if (!isFiniteNum(version)) {
    throw new InvalidDocumentError('Missing schemaVersion — not a homeplanr document')
  }
  if (version > SCHEMA_VERSION) {
    throw new ForwardVersionError(
      `This file was created by a newer version of homeplanr (schema ${version})`,
    )
  }
  let obj = raw
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) throw new InvalidDocumentError(`No migration path from schema ${v}`)
    obj = step(obj)
  }

  const warnings: string[] = []
  const doc: ProjectDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: isStr(obj.id) && obj.id ? obj.id : newProjectId(),
    name: isStr(obj.name) && obj.name.trim() ? obj.name : 'Untitled',
    createdAt: isStr(obj.createdAt) ? obj.createdAt : new Date().toISOString(),
    updatedAt: isStr(obj.updatedAt) ? obj.updatedAt : new Date().toISOString(),
    // save preview (0.11.0, additive on v6): dangling ids KEPT like
    // furniture art; junk drops silently (no warning, healed stays false)
    ...(isStr(obj.previewAssetId) && obj.previewAssetId
      ? { previewAssetId: asAssetId(obj.previewAssetId) }
      : {}),
    ...(obj.previewCustom === true ? { previewCustom: true as const } : {}),
    // project notes (additive on v7): junk drops silently
    ...(isStr(obj.notes) && obj.notes ? { notes: obj.notes } : {}),
    settings: defaultSettings(),
    levels: [],
    assets: {},
  }

  // settings: merge known keys with bounds
  if (isObj(obj.settings)) {
    const s = obj.settings
    if (isFiniteNum(s.gridSize)) doc.settings.gridSize = Math.min(1, Math.max(0.01, s.gridSize))
    if (isFiniteNum(s.defaultWallThickness)) {
      doc.settings.defaultWallThickness = Math.min(0.6, Math.max(0.03, s.defaultWallThickness))
    }
    if (isFiniteNum(s.defaultWallHeight)) {
      doc.settings.defaultWallHeight = Math.min(6, Math.max(0.3, s.defaultWallHeight))
    }
  }

  // levels (v7): junk entries prune with a warning; an empty result mints
  // one empty level (a document is never level-less). Duplicate/absent
  // level ids re-mint silently (field-level rule).
  const seenLevelIds = new Set<string>()
  if (Array.isArray(obj.levels)) {
    for (const [i, rawLevel] of (obj.levels as unknown[]).entries()) {
      if (!isObj(rawLevel)) {
        warnings.push(`Removed invalid level ${i}`)
        continue
      }
      const rawId = isStr(rawLevel.id) && rawLevel.id ? rawLevel.id : null
      const level = emptyLevel(rawId && !seenLevelIds.has(rawId) ? asLevelId(rawId) : newLevelId())
      seenLevelIds.add(level.id)
      if (isStr(rawLevel.name) && rawLevel.name.trim()) level.name = rawLevel.name
      if (isFiniteNum(rawLevel.elevation)) {
        level.elevation = Math.min(1000, Math.max(-100, rawLevel.elevation))
      }
      validateLevelRecords(rawLevel, level, warnings)
      doc.levels.push(level)
    }
  }
  if (!doc.levels.length) {
    warnings.push('Restored missing level')
    doc.levels.push(emptyLevel())
  }

  // assets — validated below at doc level (shared across levels)
  validateAssets(obj, doc)

  // --- self-heal: normalize + clamp + reconcile PER LEVEL, then detect
  // drift (assets stay OUT of the hash, like furniture/annotations —
  // their presence must never read as graph drift) ---
  const graphOf = (d: ProjectDocument) =>
    JSON.stringify(d.levels.map((l) => [l.nodes, l.walls, l.openings, l.rooms]))
  const before = graphOf(doc)
  for (const level of doc.levels) {
    const view = makeLevelDoc(doc, level)
    normalizeGraph(view)
    revalidateOpenings(view)
    reconcileRooms(view)
    // attached furniture follows any load-time window clamps (v6) — same
    // mandatory post-opening step as the runtime pipeline. Furniture is
    // outside the heal hash, so this deterministic sync stays SILENT (old
    // files keep opening clean), like a migration.
    reconcileAttachedFurniture(view)
  }
  const after = graphOf(doc)

  return { doc, warnings, healed: warnings.length > 0 || before !== after }
}

/** Per-level record whitelist (v7) — the pre-levels per-record validators,
 * scoped to one level's maps. Referential checks (walls need nodes,
 * openings/rooms need walls) are LEVEL-LOCAL by construction. */
function validateLevelRecords(
  raw: Record<string, unknown>,
  level: Level,
  warnings: string[],
): void {
  // nodes
  if (isObj(raw.nodes)) {
    for (const [key, v] of Object.entries(raw.nodes)) {
      if (isObj(v) && isFiniteNum(v.x) && isFiniteNum(v.y)) {
        const id = asNodeId(key)
        level.nodes[id] = { id, x: v.x, y: v.y }
      } else {
        warnings.push(`Removed invalid node ${key}`)
      }
    }
  }

  // walls (need both endpoints)
  if (isObj(raw.walls)) {
    for (const [key, v] of Object.entries(raw.walls)) {
      if (
        isObj(v) &&
        isStr(v.a) &&
        isStr(v.b) &&
        level.nodes[asNodeId(v.a)] &&
        level.nodes[asNodeId(v.b)] &&
        v.a !== v.b
      ) {
        const id = asWallId(key)
        level.walls[id] = {
          id,
          a: asNodeId(v.a),
          b: asNodeId(v.b),
          thickness: isFiniteNum(v.thickness)
            ? Math.min(0.6, Math.max(0.03, v.thickness))
            : DEFAULTS.wallThickness,
          height: isFiniteNum(v.height)
            ? Math.min(6, Math.max(0.3, v.height))
            : DEFAULTS.wallHeight,
          // paint AND finish ids are open registries: unknown ids are
          // preserved and the renderer falls back, so patch-release
          // additions roundtrip. ('paint' as a finish value is the
          // absent-default — normalized to absent.)
          ...(isStr(v.paintFront) && v.paintFront ? { paintFront: v.paintFront } : {}),
          ...(isStr(v.paintBack) && v.paintBack ? { paintBack: v.paintBack } : {}),
          ...(isStr(v.finishFront) && v.finishFront && v.finishFront !== 'paint'
            ? { finishFront: v.finishFront }
            : {}),
          ...(isStr(v.finishBack) && v.finishBack && v.finishBack !== 'paint'
            ? { finishBack: v.finishBack }
            : {}),
        }
      } else {
        warnings.push(`Removed invalid wall ${key}`)
      }
    }
  }

  // openings (need a live wall + sane params)
  if (isObj(raw.openings)) {
    for (const [key, v] of Object.entries(raw.openings)) {
      const ok =
        isObj(v) &&
        isStr(v.wallId) &&
        level.walls[asWallId(v.wallId)] &&
        isFiniteNum(v.t) &&
        v.t > 0 &&
        v.t < 1 &&
        isFiniteNum(v.width) &&
        v.width > 0 &&
        isFiniteNum(v.height) &&
        v.height > 0 &&
        (v.kind === 'door' || v.kind === 'window')
      if (!ok) {
        warnings.push(`Removed invalid opening ${key}`)
        continue
      }
      const id = asOpeningId(key)
      const base = {
        id,
        wallId: asWallId(v.wallId as string),
        t: v.t as number,
        width: v.width as number,
        height: v.height as number,
        // v6, open registry: any non-empty string (renderers fall back to
        // the standard style for unknown ids)
        ...(isStr(v.style) && v.style ? { style: v.style } : {}),
      }
      if (v.kind === 'door') {
        level.openings[id] = {
          ...base,
          kind: 'door',
          hinge: v.hinge === 'b' ? 'b' : 'a',
          swing: v.swing === 'back' ? 'back' : 'front',
        } satisfies Opening
      } else {
        level.openings[id] = {
          ...base,
          kind: 'window',
          sillHeight: isFiniteNum(v.sillHeight) ? Math.max(0, v.sillHeight) : DEFAULTS.window.sillHeight,
        } satisfies Opening
      }
    }
  }

  // rooms (identity carriers — invalid wall refs pruned, reconcile rebuilds)
  if (isObj(raw.rooms)) {
    for (const [key, v] of Object.entries(raw.rooms)) {
      if (!isObj(v) || !Array.isArray(v.wallCycle)) {
        warnings.push(`Removed invalid room ${key}`)
        continue
      }
      const cycle = (v.wallCycle as unknown[])
        .filter((w): w is string => isStr(w) && !!level.walls[asWallId(w)])
        .map(asWallId)
      if (!cycle.length) {
        warnings.push(`Removed room ${key} (no surviving walls)`)
        continue
      }
      const holeCycles: WallId[][] = Array.isArray(v.holeCycles)
        ? (v.holeCycles as unknown[]).map((h) =>
            Array.isArray(h)
              ? (h as unknown[])
                  .filter((w): w is string => isStr(w) && !!level.walls[asWallId(w)])
                  .map(asWallId)
              : [],
          )
        : []
      const id = asRoomId(key)
      level.rooms[id] = {
        id,
        wallCycle: cycle,
        holeCycles,
        ...(isStr(v.name) && v.name ? { name: v.name } : {}),
        ...(isStr(v.floorMaterialId) && v.floorMaterialId
          ? { floorMaterialId: v.floorMaterialId }
          : {}),
        // v4, open registry: any non-empty string (render-side fallback)
        ...(isStr(v.roomType) && v.roomType ? { roomType: v.roomType } : {}),
        // v7: per-room floor slab lift (podium/loft) — only positive values
        // stored, capped at 2 m; junk/zero silently absent
        ...(isFiniteNum(v.floorElevation) && v.floorElevation > 0
          ? { floorElevation: Math.min(2, v.floorElevation) }
          : {}),
      }
    }
  }

  // furniture
  if (isObj(raw.furniture)) {
    for (const [key, v] of Object.entries(raw.furniture)) {
      const size = isObj(v) ? v.size : null
      const ok =
        isObj(v) &&
        isStr(v.catalogItemId) &&
        isFiniteNum(v.x) &&
        isFiniteNum(v.y) &&
        isFiniteNum(v.rotation) &&
        isObj(size) &&
        isFiniteNum(size.w) &&
        isFiniteNum(size.d) &&
        isFiniteNum(size.h)
      if (!ok) {
        warnings.push(`Removed invalid furniture ${key}`)
        continue
      }
      const id = asFurnitureId(key)
      const sz = size as { w: number; d: number; h: number }
      // w/d floor 0.1; h floor 0.01 — flat items (rug) are legitimately thin
      const clamp = (n: number, min: number) => Math.min(5, Math.max(min, n))
      level.furniture[id] = {
        id,
        catalogItemId: v.catalogItemId as string,
        x: v.x as number,
        y: v.y as number,
        rotation: v.rotation as number,
        size: { w: clamp(sz.w, 0.1), d: clamp(sz.d, 0.1), h: clamp(sz.h, 0.01) },
        elevation: isFiniteNum(v.elevation) ? Math.min(3, Math.max(0, v.elevation)) : 0,
        ...(isStr(v.name) && v.name ? { name: v.name } : {}),
        ...(v.mirrored === true ? { mirrored: true } : {}),
        // v4 additions — invalid values silently absent (field-level rule)
        ...(isFiniteNum(v.price) && v.price >= 0 ? { price: v.price } : {}),
        ...(isStr(v.notes) && v.notes ? { notes: v.notes } : {}),
        ...(() => {
          // open registry: slot → material id/hex, both non-empty strings;
          // junk ENTRIES drop silently, an empty result drops the field
          if (!isObj(v.materialOverrides)) return {}
          const entries = Object.entries(v.materialOverrides).filter(
            ([slot, val]) => slot && isStr(val) && val,
          ) as [string, string][]
          return entries.length ? { materialOverrides: Object.fromEntries(entries) } : {}
        })(),
        // v6 additions — same field-level rule. Dangling asset/opening refs
        // are deliberately KEPT (render placeholder / commit-time detach):
        // a stripped-recovery or forward-compatible file must not lose them.
        ...(isStr(v.assetId) && v.assetId ? { assetId: asAssetId(v.assetId) } : {}),
        ...(isStr(v.attachedOpeningId) && v.attachedOpeningId
          ? { attachedOpeningId: asOpeningId(v.attachedOpeningId) }
          : {}),
        ...(isFiniteNum(v.lumen) && v.lumen > 0 ? { lumen: v.lumen } : {}),
        ...(typeof v.lightOn === 'boolean' ? { lightOn: v.lightOn } : {}),
      }
    }
  }

  // annotations (v3) — free plan artifacts: never graph-healed (excluded
  // from the self-heal hash below, like furniture), whole-entity invalid →
  // prune with a warning, invalid optional FIELDS → silently absent
  if (isObj(raw.annotations)) {
    for (const [key, v] of Object.entries(raw.annotations)) {
      if (isObj(v) && v.kind === 'dimension') {
        const a = v.a
        const b = v.b
        const ok =
          isObj(a) &&
          isObj(b) &&
          isFiniteNum(a.x) &&
          isFiniteNum(a.y) &&
          isFiniteNum(b.x) &&
          isFiniteNum(b.y) &&
          Math.hypot(b.x - a.x, b.y - a.y) >= DEFAULTS.minWallLength
        if (!ok) {
          warnings.push(`Removed invalid annotation ${key}`)
          continue
        }
        const id = asAnnotationId(key)
        const m = DEFAULTS.maxDimensionOffset
        level.annotations[id] = {
          id,
          kind: 'dimension',
          a: { x: a.x as number, y: a.y as number },
          b: { x: b.x as number, y: b.y as number },
          offset: isFiniteNum(v.offset) ? Math.min(m, Math.max(-m, v.offset)) : 0,
        }
      } else if (isObj(v) && v.kind === 'label') {
        if (!(isFiniteNum(v.x) && isFiniteNum(v.y) && isStr(v.text) && v.text.trim())) {
          warnings.push(`Removed invalid annotation ${key}`)
          continue
        }
        const id = asAnnotationId(key)
        level.annotations[id] = {
          id,
          kind: 'label',
          x: v.x,
          y: v.y,
          text: v.text,
          ...(isFiniteNum(v.rotation) ? { rotation: v.rotation } : {}),
          ...(isFiniteNum(v.fontSize)
            ? { fontSize: Math.min(1, Math.max(0.05, v.fontSize)) }
            : {}),
        }
      } else if (isObj(v) && v.kind === 'area') {
        // v4: junk vertices drop; the polygon survives iff ≥ 3 remain AND it
        // isn't degenerate (the addArea guard — a collinear polygon would be
        // culled everywhere, an invisible unclickable ghost)
        const points = Array.isArray(v.points)
          ? (v.points as unknown[])
              .filter((p): p is { x: number; y: number } =>
                isObj(p) && isFiniteNum(p.x) && isFiniteNum(p.y),
              )
              .map((p) => ({ x: p.x, y: p.y }))
          : []
        if (points.length < 3 || polygonArea(points) < MIN_AREA_M2) {
          warnings.push(`Removed invalid annotation ${key}`)
          continue
        }
        const id = asAnnotationId(key)
        level.annotations[id] = { id, kind: 'area', points }
      } else {
        warnings.push(`Removed invalid annotation ${key}`)
      }
    }
  }

}

/** Doc-level assets whitelist (v6; the map is SHARED across levels in v7).
 * Inert leaf data like furniture/annotations, but junk entries drop
 * SILENTLY (field-level rule, no warning): they only arrive from
 * hand-edited files, and a warning would flip `healed` on open. Payload
 * size is unbounded here by design — caps are ingest-time. */
function validateAssets(obj: Record<string, unknown>, doc: ProjectDocument): void {
  if (isObj(obj.assets)) {
    for (const [key, v] of Object.entries(obj.assets)) {
      if (
        isObj(v) &&
        isStr(v.mime) &&
        v.mime &&
        isStr(v.data) &&
        v.data &&
        isFiniteNum(v.w) &&
        v.w > 0 &&
        isFiniteNum(v.h) &&
        v.h > 0
      ) {
        const id = asAssetId(key)
        doc.assets[id] = { id, mime: v.mime, data: v.data, w: v.w, h: v.h }
      }
    }
  }
}
