import type { ProjectDocument, Room } from '../model/types'
import type { NodeId, RoomId, WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import { computeWallOutlines, type WallOutlines } from '../geometry/wallOutline'
import { buildPatchSolids, buildWallSolid, type PatchSolid, type WallSolid } from '../geometry/wallSolids'
import { detectFaces, type DetectedFace } from '../geometry/faces'
import type { Opening, Wall } from '../model/types'

/**
 * Derived geometry with PER-ENTITY REFERENCE STABILITY (plan §Architecture —
 * v1 scope, not an escape hatch).
 *
 * getDerived(doc) is memoized on document identity (WeakMap). When computing
 * for a new doc it structurally compares each entity's input signature
 * against the previous derivation and REUSES the previous output objects
 * when unchanged. Renderer memos key on these objects:
 *   <WallMesh> ← derived.wallSolids[id]   (object identity = cache key)
 * A node drag therefore invalidates only incident walls and their junction
 * partners; every other wall/room keeps reference identity.
 *
 * Wall signature: the wall object, both endpoint node objects, its openings
 * (objects, sorted), and for each incident wall at either endpoint: that
 * wall object + its FAR node object (its direction affects our miters).
 */
export interface DerivedRoom {
  roomId: RoomId
  room: Room
  polygon: Vec2[]
  holePolygons: Vec2[][]
  areaM2: number
  centroid: Vec2
  labelAnchor: Vec2
  floor: DetectedFace['floor']
}

export interface DerivedGeometry {
  outlines: WallOutlines
  wallSolids: Record<WallId, WallSolid>
  patchSolids: PatchSolid[]
  patchSolidByNode: Record<NodeId, PatchSolid>
  rooms: Record<RoomId, DerivedRoom>
  /** Faces that matched no room this frame (mid-live-drag transients). */
  orphanFaces: DetectedFace[]
}

type Sig = unknown[]

interface PrevState {
  sigs: Map<WallId, Sig>
  patchSigs: Map<NodeId, Sig>
  roomSigs: Map<RoomId, Sig>
  derived: DerivedGeometry
}

const cache = new WeakMap<ProjectDocument, DerivedGeometry>()
let prev: PrevState | null = null

const sigEqual = (a: Sig | undefined, b: Sig): boolean =>
  !!a && a.length === b.length && a.every((v, i) => v === b[i])

export function getDerived(doc: ProjectDocument): DerivedGeometry {
  const hit = cache.get(doc)
  if (hit) return hit

  const outlines = computeWallOutlines(doc.nodes, doc.walls)

  // --- group openings + incidence once ---
  const openingsByWall = new Map<WallId, Opening[]>()
  for (const op of Object.values(doc.openings)) {
    ;(openingsByWall.get(op.wallId) ?? openingsByWall.set(op.wallId, []).get(op.wallId)!).push(op)
  }
  for (const list of openingsByWall.values()) {
    list.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
  }
  const incident = new Map<NodeId, Wall[]>()
  for (const w of Object.values(doc.walls)) {
    ;(incident.get(w.a) ?? incident.set(w.a, []).get(w.a)!).push(w)
    ;(incident.get(w.b) ?? incident.set(w.b, []).get(w.b)!).push(w)
  }
  for (const list of incident.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : 1))
  }

  const wallSig = (w: Wall): Sig => {
    const sig: Sig = [w, doc.nodes[w.a], doc.nodes[w.b]]
    for (const op of openingsByWall.get(w.id) ?? []) sig.push(op)
    for (const end of [w.a, w.b]) {
      for (const other of incident.get(end) ?? []) {
        if (other.id === w.id) continue
        sig.push(other, doc.nodes[other.a === end ? other.b : other.a])
      }
    }
    return sig
  }

  // --- wall solids with reference reuse ---
  const wallSolids: Record<WallId, WallSolid> = {}
  const wallPolygons: WallOutlines['wallPolygons'] = {}
  const sigs = new Map<WallId, Sig>()
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    const poly = outlines.wallPolygons[w.id]
    const core = outlines.wallCores[w.id]
    if (!na || !nb || !poly || !core) continue
    const sig = wallSig(w)
    sigs.set(w.id, sig)
    if (prev && sigEqual(prev.sigs.get(w.id), sig)) {
      const prevSolid = prev.derived.wallSolids[w.id]
      const prevPoly = prev.derived.outlines.wallPolygons[w.id]
      if (prevSolid && prevPoly) {
        wallSolids[w.id] = prevSolid
        wallPolygons[w.id] = prevPoly
        continue
      }
    }
    wallSolids[w.id] = buildWallSolid(w, na, nb, openingsByWall.get(w.id) ?? [], poly, core)
    wallPolygons[w.id] = poly
  }

  // --- patch solids with reference reuse (sig: incident walls + all their nodes) ---
  const patchSigs = new Map<NodeId, Sig>()
  const freshPatches = buildPatchSolids(doc.nodes, doc.walls, outlines.nodePatches)
  const patchSolidByNode: Record<NodeId, PatchSolid> = {}
  const nodePatches: WallOutlines['nodePatches'] = {}
  for (const p of freshPatches) {
    const sig: Sig = [doc.nodes[p.nodeId]]
    for (const w of incident.get(p.nodeId) ?? []) {
      sig.push(w, doc.nodes[w.a], doc.nodes[w.b])
    }
    patchSigs.set(p.nodeId, sig)
    const prevPatch = prev?.derived.patchSolidByNode[p.nodeId]
    if (prevPatch && sigEqual(prev!.patchSigs.get(p.nodeId), sig)) {
      patchSolidByNode[p.nodeId] = prevPatch
      nodePatches[p.nodeId] = prev!.derived.outlines.nodePatches[p.nodeId] ?? p.polygon
    } else {
      patchSolidByNode[p.nodeId] = p
      nodePatches[p.nodeId] = p.polygon
    }
  }
  const patchSolids = Object.values(patchSolidByNode)

  // --- rooms: join detected faces to doc.rooms by fingerprint ---
  const faces = detectFaces(doc.nodes, doc.walls)
  const roomSigs = new Map<RoomId, Sig>()
  const rooms: Record<RoomId, DerivedRoom> = {}
  const orphanFaces: DetectedFace[] = []
  const roomByFingerprint = new Map<string, Room>()
  for (const room of Object.values(doc.rooms)) {
    const ids = [...room.wallCycle, ...room.holeCycles.flat()].sort()
    roomByFingerprint.set(ids.join('|'), room)
  }
  for (const face of faces) {
    const ids = [...face.wallSet, ...face.holeCycles.flat()].sort()
    const room = roomByFingerprint.get(ids.join('|'))
    if (!room) {
      orphanFaces.push(face) // mid-drag transient; reconcile will resolve
      continue
    }
    const sig: Sig = [room]
    for (const wid of ids) {
      const w = doc.walls[wid as WallId]
      if (w) sig.push(w, doc.nodes[w.a], doc.nodes[w.b])
    }
    roomSigs.set(room.id, sig)
    const prevRoom = prev?.derived.rooms[room.id]
    if (prevRoom && sigEqual(prev!.roomSigs.get(room.id), sig)) {
      rooms[room.id] = prevRoom
    } else {
      rooms[room.id] = {
        roomId: room.id,
        room,
        polygon: face.polygon,
        holePolygons: face.holePolygons,
        areaM2: face.areaM2,
        centroid: face.centroid,
        labelAnchor: face.labelAnchor,
        floor: face.floor,
      }
    }
  }

  const derived: DerivedGeometry = {
    outlines: { wallPolygons, nodePatches, wallCores: outlines.wallCores },
    wallSolids,
    patchSolids,
    patchSolidByNode,
    rooms,
    orphanFaces,
  }
  cache.set(doc, derived)
  prev = { sigs, patchSigs, roomSigs, derived }
  return derived
}

/** Test hook: drop cross-doc stability state (NOT the per-doc WeakMap). */
export function resetDerivedForTests(): void {
  prev = null
}
