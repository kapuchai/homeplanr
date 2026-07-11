import {
  DEFAULTS,
  SCHEMA_VERSION,
  defaultSettings,
  type Opening,
  type ProjectDocument,
} from '../../model/types'
import {
  asFurnitureId,
  asNodeId,
  asOpeningId,
  asRoomId,
  asWallId,
  newProjectId,
  type WallId,
} from '../../model/ids'
import { normalizeGraph } from '../../model/mutations/walls'
import { revalidateOpenings } from '../../model/mutations/openings'
import { reconcileRooms } from '../../model/mutations/rooms'

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
  // migrations registry: schemaVersion → upgrader (none yet for v1)
  // for (let v = version; v < SCHEMA_VERSION; v++) raw = MIGRATIONS[v](raw)

  const warnings: string[] = []
  const doc: ProjectDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: isStr(raw.id) && raw.id ? raw.id : newProjectId(),
    name: isStr(raw.name) && raw.name.trim() ? raw.name : 'Untitled',
    createdAt: isStr(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
    updatedAt: isStr(raw.updatedAt) ? raw.updatedAt : new Date().toISOString(),
    settings: defaultSettings(),
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    furniture: {},
  }

  // settings: merge known keys with bounds
  if (isObj(raw.settings)) {
    const s = raw.settings
    if (isFiniteNum(s.gridSize)) doc.settings.gridSize = Math.min(1, Math.max(0.01, s.gridSize))
    if (typeof s.snapEnabled === 'boolean') doc.settings.snapEnabled = s.snapEnabled
    if (s.unitDisplay === 'm' || s.unitDisplay === 'cm') doc.settings.unitDisplay = s.unitDisplay
    if (isFiniteNum(s.defaultWallThickness)) {
      doc.settings.defaultWallThickness = Math.min(0.6, Math.max(0.03, s.defaultWallThickness))
    }
    if (isFiniteNum(s.defaultWallHeight)) {
      doc.settings.defaultWallHeight = Math.min(6, Math.max(0.3, s.defaultWallHeight))
    }
  }

  // nodes
  if (isObj(raw.nodes)) {
    for (const [key, v] of Object.entries(raw.nodes)) {
      if (isObj(v) && isFiniteNum(v.x) && isFiniteNum(v.y)) {
        const id = asNodeId(key)
        doc.nodes[id] = { id, x: v.x, y: v.y }
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
        doc.nodes[asNodeId(v.a)] &&
        doc.nodes[asNodeId(v.b)] &&
        v.a !== v.b
      ) {
        const id = asWallId(key)
        doc.walls[id] = {
          id,
          a: asNodeId(v.a),
          b: asNodeId(v.b),
          thickness: isFiniteNum(v.thickness)
            ? Math.min(0.6, Math.max(0.03, v.thickness))
            : DEFAULTS.wallThickness,
          height: isFiniteNum(v.height)
            ? Math.min(6, Math.max(0.3, v.height))
            : DEFAULTS.wallHeight,
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
        doc.walls[asWallId(v.wallId)] &&
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
      }
      if (v.kind === 'door') {
        doc.openings[id] = {
          ...base,
          kind: 'door',
          hinge: v.hinge === 'b' ? 'b' : 'a',
          swing: v.swing === 'back' ? 'back' : 'front',
        } satisfies Opening
      } else {
        doc.openings[id] = {
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
        .filter((w): w is string => isStr(w) && !!doc.walls[asWallId(w)])
        .map(asWallId)
      if (!cycle.length) {
        warnings.push(`Removed room ${key} (no surviving walls)`)
        continue
      }
      const holeCycles: WallId[][] = Array.isArray(v.holeCycles)
        ? (v.holeCycles as unknown[]).map((h) =>
            Array.isArray(h)
              ? (h as unknown[])
                  .filter((w): w is string => isStr(w) && !!doc.walls[asWallId(w)])
                  .map(asWallId)
              : [],
          )
        : []
      const id = asRoomId(key)
      doc.rooms[id] = {
        id,
        wallCycle: cycle,
        holeCycles,
        ...(isStr(v.name) && v.name ? { name: v.name } : {}),
        ...(isStr(v.floorMaterialId) && v.floorMaterialId
          ? { floorMaterialId: v.floorMaterialId }
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
      const clamp = (n: number) => Math.min(5, Math.max(0.1, n))
      doc.furniture[id] = {
        id,
        catalogItemId: v.catalogItemId as string,
        x: v.x as number,
        y: v.y as number,
        rotation: v.rotation as number,
        size: { w: clamp(sz.w), d: clamp(sz.d), h: clamp(sz.h) },
        elevation: isFiniteNum(v.elevation) ? Math.min(3, Math.max(0, v.elevation)) : 0,
        ...(isStr(v.name) && v.name ? { name: v.name } : {}),
      }
    }
  }

  // --- self-heal: normalize + clamp + reconcile, then detect drift ---
  const before = JSON.stringify([doc.nodes, doc.walls, doc.openings, doc.rooms])
  normalizeGraph(doc)
  revalidateOpenings(doc)
  reconcileRooms(doc)
  const after = JSON.stringify([doc.nodes, doc.walls, doc.openings, doc.rooms])

  return { doc, warnings, healed: warnings.length > 0 || before !== after }
}
