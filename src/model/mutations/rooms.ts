import type { LevelDoc, Room } from '../types'
import { newRoomId, type RoomId, type WallId } from '../ids'
import { detectFaces } from '../../geometry/faces'
import { pointInPolygonWithHoles } from '../../geometry/polygon'
import { add, normalize, perp, scale, sub } from '../../geometry/vec'
import { applyWallPaint } from './walls'
import { roomTypeSpec } from '../../catalog/roomTypes'

/**
 * Room reconciliation: keeps room identity (id, name, floorMaterialId,
 * roomType) stable across topology edits by matching detected faces to
 * existing rooms via Jaccard similarity over their wall-ID fingerprints
 * (wallCycle ∪ holeCycles). Greedy best-pair-first, threshold 0.3;
 * deterministic ordering (score desc, face area desc, room id asc).
 *
 * Runs inside topology-changing mutations (pipeline 'commit' mode) so
 * identity is captured by undo snapshots and serialized documents.
 */
export function reconcileRooms(doc: LevelDoc): void {
  const faces = detectFaces(doc.nodes, doc.walls)

  const roomFingerprint = (room: Room): Set<WallId> => {
    const s = new Set<WallId>(room.wallCycle)
    for (const cycle of room.holeCycles) for (const id of cycle) s.add(id)
    return s
  }

  const rooms = Object.values(doc.rooms)
  interface Pair {
    faceIdx: number
    roomId: RoomId
    score: number
    faceArea: number
  }
  const pairs: Pair[] = []
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!
    const fset = new Set<WallId>(face.wallSet)
    for (const h of face.holeCycles) for (const id of h) fset.add(id)
    for (const room of rooms) {
      const rset = roomFingerprint(room)
      let inter = 0
      for (const id of fset) if (rset.has(id)) inter++
      const union = fset.size + rset.size - inter
      const score = union === 0 ? 0 : inter / union
      if (score >= 0.3) {
        pairs.push({ faceIdx: fi, roomId: room.id, score, faceArea: face.areaM2 })
      }
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      b.faceArea - a.faceArea ||
      (a.roomId < b.roomId ? -1 : 1),
  )

  const faceTaken = new Set<number>()
  const roomTaken = new Set<RoomId>()
  const assignment = new Map<number, RoomId>()
  for (const p of pairs) {
    if (faceTaken.has(p.faceIdx) || roomTaken.has(p.roomId)) continue
    faceTaken.add(p.faceIdx)
    roomTaken.add(p.roomId)
    assignment.set(p.faceIdx, p.roomId)
  }

  // Update in place — untouched rooms MUST keep object identity (the
  // derived-geometry layer's per-entity reference stability depends on it;
  // wholesale rebuilding would churn every room every commit).
  const idsEq = (a: readonly WallId[], b: readonly WallId[]) =>
    a.length === b.length && a.every((v, i) => v === b[i])
  const cyclesEq = (a: readonly WallId[][], b: readonly WallId[][]) =>
    a.length === b.length && a.every((v, i) => idsEq(v, b[i]!))

  const seen = new Set<RoomId>()
  faces.forEach((face, fi) => {
    const matched = assignment.get(fi)
    if (matched) {
      seen.add(matched)
      const room = doc.rooms[matched]!
      if (!idsEq(room.wallCycle, face.wallCycle)) room.wallCycle = face.wallCycle
      if (!cyclesEq(room.holeCycles, face.holeCycles)) room.holeCycles = face.holeCycles
    } else {
      const id = newRoomId()
      seen.add(id)
      doc.rooms[id] = { id, wallCycle: face.wallCycle, holeCycles: face.holeCycles }
    }
  })
  for (const id of Object.keys(doc.rooms) as RoomId[]) {
    if (!seen.has(id)) delete doc.rooms[id]
  }
}

export function renameRoom(doc: LevelDoc, id: RoomId, name: string): void {
  const room = doc.rooms[id]
  if (!room) return
  const trimmed = name.trim()
  if (trimmed) room.name = trimmed
  else delete room.name
}

export function setRoomFloorMaterial(
  doc: LevelDoc,
  id: RoomId,
  materialId: string | undefined,
): void {
  const room = doc.rooms[id]
  if (!room) return
  if (materialId) room.floorMaterialId = materialId
  else delete room.floorMaterialId
}

/**
 * Set/clear the room type (0.8.0 — the v4 field gets semantics). Setting a
 * KNOWN type also seeds its suggested floor material, but ONLY when the
 * room has no explicit floorMaterialId — a user's floor choice is never
 * overwritten (and clearing the type never touches the floor).
 */
export function setRoomType(doc: LevelDoc, id: RoomId, roomType: string | undefined): void {
  const room = doc.rooms[id]
  if (!room) return
  if (roomType) {
    if (room.roomType !== roomType) room.roomType = roomType
    const suggested = roomTypeSpec(roomType)?.suggestedFloorId
    if (suggested && room.floorMaterialId === undefined) room.floorMaterialId = suggested
  } else if (room.roomType !== undefined) {
    delete room.roomType
  }
}

/**
 * Paint every wall face that looks into this room (outer cycle + island
 * walls from holeCycles) with one WALL_PAINTS id; undefined/unknown ids
 * reset those faces to default. Doc-only: the room polygon is reconstructed
 * by re-running detectFaces and matching the room's wall-ID fingerprint
 * (same join as store/derived.ts) — mutations cannot read the derived layer.
 * Side probe: wall midpoint ± perp(a→b)·(thickness/2 + 1cm); the +perp probe
 * inside the room paints paintFront (front ≡ +perp, see model/types.ts),
 * the −perp probe paints paintBack, neither skips the wall.
 * One call = one undo entry; no pipeline run (paint never alters topology).
 */
export function paintRoomWalls(
  doc: LevelDoc,
  roomId: RoomId,
  paintId: string | undefined,
): void {
  const room = doc.rooms[roomId]
  if (!room) return
  const fingerprint = (ids: readonly WallId[]) => [...ids].sort().join('|')
  const roomKey = fingerprint([...room.wallCycle, ...room.holeCycles.flat()])
  const face = detectFaces(doc.nodes, doc.walls).find(
    (f) => fingerprint([...f.wallSet, ...f.holeCycles.flat()]) === roomKey,
  )
  if (!face) return
  const wallIds = new Set<WallId>([...room.wallCycle, ...room.holeCycles.flat()])
  for (const id of wallIds) {
    const w = doc.walls[id]
    const na = w && doc.nodes[w.a]
    const nb = w && doc.nodes[w.b]
    if (!w || !na || !nb) continue
    const side = perp(normalize(sub(nb, na)))
    const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 }
    const off = w.thickness / 2 + 0.01
    if (pointInPolygonWithHoles(add(mid, scale(side, off)), face.polygon, face.holePolygons)) {
      applyWallPaint(w, 'paintFront', paintId)
    } else if (
      pointInPolygonWithHoles(add(mid, scale(side, -off)), face.polygon, face.holePolygons)
    ) {
      applyWallPaint(w, 'paintBack', paintId)
    }
  }
}
