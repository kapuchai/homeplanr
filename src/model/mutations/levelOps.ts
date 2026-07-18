import type { Annotation, Level, Opening, ProjectDocument, Room } from '../types'
import { emptyLevel } from '../types'
import {
  newAnnotationId,
  newFurnitureId,
  newLevelId,
  newNodeId,
  newOpeningId,
  newRoomId,
  newWallId,
  type LevelId,
  type NodeId,
  type OpeningId,
  type WallId,
} from '../ids'

/**
 * Storey operations (v7) — DOC-scoped mutations (they touch the levels
 * array itself, which no LevelDoc view can reach). All undoable through
 * the docStore's mutateDoc seam. Level ORDER is the stacking order;
 * elevations derive from it (model/levels.ts), so reordering floors
 * re-stacks the building with no coordinate rewrites.
 */

/** Append an empty level on top of the building; returns its id. */
export function addLevel(doc: ProjectDocument): LevelId {
  const level = emptyLevel()
  doc.levels.push(level)
  return level.id
}

/**
 * Deep-copy a level directly ABOVE its source with fresh ids for every
 * entity and every internal reference remapped (walls→nodes,
 * openings→walls, rooms→wall cycles, furniture→openings). The fastest way
 * to start floor N+1 from floor N's outline. `assetId` is deliberately
 * NOT re-minted — embedded images are doc-shared content and the GC
 * oracle counts references across all levels. A source-dangling
 * attachedOpeningId is dropped (the clone must not point into another
 * floor).
 */
export function duplicateLevel(doc: ProjectDocument, id: LevelId): LevelId | null {
  const idx = doc.levels.findIndex((l) => l.id === id)
  if (idx < 0) return null
  const src = doc.levels[idx]!

  const nodeIds = new Map<NodeId, NodeId>()
  const wallIds = new Map<WallId, WallId>()
  const openingIds = new Map<OpeningId, OpeningId>()

  const level: Level = {
    ...emptyLevel(newLevelId()),
    ...(src.name !== undefined ? { name: src.name } : {}),
    ...(src.elevation !== undefined ? { elevation: src.elevation } : {}),
  }
  for (const n of Object.values(src.nodes)) {
    const nid = newNodeId()
    nodeIds.set(n.id, nid)
    level.nodes[nid] = { ...n, id: nid }
  }
  for (const w of Object.values(src.walls)) {
    const wid = newWallId()
    wallIds.set(w.id, wid)
    level.walls[wid] = { ...w, id: wid, a: nodeIds.get(w.a)!, b: nodeIds.get(w.b)! }
  }
  for (const op of Object.values(src.openings)) {
    const oid = newOpeningId()
    const wid = wallIds.get(op.wallId)
    if (!wid) continue // dangling in the source — the clone drops it
    openingIds.set(op.id, oid)
    level.openings[oid] = { ...op, id: oid, wallId: wid } as Opening
  }
  for (const r of Object.values(src.rooms)) {
    const rid = newRoomId()
    const room: Room = {
      ...r,
      id: rid,
      wallCycle: r.wallCycle.map((w) => wallIds.get(w)).filter((w): w is WallId => !!w),
      holeCycles: r.holeCycles.map((cycle) =>
        cycle.map((w) => wallIds.get(w)).filter((w): w is WallId => !!w),
      ),
    }
    level.rooms[rid] = room
  }
  for (const f of Object.values(src.furniture)) {
    const fid = newFurnitureId()
    const clone = { ...f, id: fid, size: { ...f.size } }
    if (f.materialOverrides) clone.materialOverrides = { ...f.materialOverrides }
    if (f.attachedOpeningId) {
      const mapped = openingIds.get(f.attachedOpeningId)
      if (mapped) clone.attachedOpeningId = mapped
      else delete (clone as { attachedOpeningId?: OpeningId }).attachedOpeningId
    }
    level.furniture[fid] = clone
  }
  for (const a of Object.values(src.annotations)) {
    const aid = newAnnotationId()
    const clone = { ...a, id: aid } as Annotation
    if (clone.kind === 'area') clone.points = clone.points.map((p) => ({ ...p }))
    if (clone.kind === 'dimension') {
      clone.a = { ...clone.a }
      clone.b = { ...clone.b }
    }
    level.annotations[aid] = clone
  }

  doc.levels.splice(idx + 1, 0, level)
  return level.id
}

/** Trimmed rename; empty clears back to the numbered chrome fallback. */
export function renameLevel(doc: ProjectDocument, id: LevelId, name: string): void {
  const level = doc.levels.find((l) => l.id === id)
  if (!level) return
  const trimmed = name.trim()
  if (trimmed) level.name = trimmed
  else delete level.name
}

/** Swap a level one slot up/down the stack; no-op at the ends. */
export function moveLevel(doc: ProjectDocument, id: LevelId, delta: 1 | -1): boolean {
  const idx = doc.levels.findIndex((l) => l.id === id)
  const to = idx + delta
  if (idx < 0 || to < 0 || to >= doc.levels.length) return false
  const [level] = doc.levels.splice(idx, 1)
  doc.levels.splice(to, 0, level!)
  return true
}

/** Remove a storey. The LAST level is never deletable — a document is
 * never level-less (validator invariant). */
export function deleteLevel(doc: ProjectDocument, id: LevelId): boolean {
  if (doc.levels.length <= 1) return false
  const idx = doc.levels.findIndex((l) => l.id === id)
  if (idx < 0) return false
  doc.levels.splice(idx, 1)
  return true
}
