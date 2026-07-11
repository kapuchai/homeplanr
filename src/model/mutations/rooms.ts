import type { ProjectDocument, Room } from '../types'
import { newRoomId, type RoomId, type WallId } from '../ids'
import { detectFaces } from '../../geometry/faces'

/**
 * Room reconciliation: keeps room identity (id, name, floorMaterialId)
 * stable across topology edits by matching detected faces to existing rooms
 * via Jaccard similarity over their wall-ID fingerprints
 * (wallCycle ∪ holeCycles). Greedy best-pair-first, threshold 0.3;
 * deterministic ordering (score desc, face area desc, room id asc).
 *
 * Runs inside topology-changing mutations (pipeline 'commit' mode) so
 * identity is captured by undo snapshots and serialized documents.
 */
export function reconcileRooms(doc: ProjectDocument): void {
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

  const nextRooms: Record<RoomId, Room> = {}
  faces.forEach((face, fi) => {
    const matched = assignment.get(fi)
    if (matched) {
      const prev = doc.rooms[matched]!
      nextRooms[matched] = {
        id: matched,
        wallCycle: face.wallCycle,
        holeCycles: face.holeCycles,
        ...(prev.name !== undefined ? { name: prev.name } : {}),
        ...(prev.floorMaterialId !== undefined
          ? { floorMaterialId: prev.floorMaterialId }
          : {}),
      }
    } else {
      const id = newRoomId()
      nextRooms[id] = { id, wallCycle: face.wallCycle, holeCycles: face.holeCycles }
    }
  })

  // replace wholesale (unmatched rooms die here)
  doc.rooms = nextRooms
}

export function renameRoom(doc: ProjectDocument, id: RoomId, name: string): void {
  const room = doc.rooms[id]
  if (!room) return
  const trimmed = name.trim()
  if (trimmed) room.name = trimmed
  else delete room.name
}

export function setRoomFloorMaterial(
  doc: ProjectDocument,
  id: RoomId,
  materialId: string | undefined,
): void {
  const room = doc.rooms[id]
  if (!room) return
  if (materialId) room.floorMaterialId = materialId
  else delete room.floorMaterialId
}
