import type { ProjectDocument } from '../types'
import {
  newNodeId,
  newWallId,
  type FurnitureId,
  type NodeId,
  type OpeningId,
  type RoomId,
  type WallId,
} from '../ids'
import type { Vec2 } from '../../geometry/vec'
import { add, dist, rotate, sub } from '../../geometry/vec'
import { MERGE_EPS } from '../../geometry/constants'
import { detectFaces } from '../../geometry/faces'
import { pointInPolygon } from '../../geometry/polygon'
import { runPipeline, type MutationMode } from './pipeline'

/**
 * Room rig (0.8.0): a room manipulated as a rigid unit — its walls, the
 * openings they host, the furniture standing inside, and any island rooms
 * nested in its holes. The rig is the gesture-side handle for room
 * move/rotate; the COMMIT pipeline with the rig ids demoted is the weld
 * engine (exactly the paste semantics — stationary geometry wins every
 * tie, see pipeline.ts PipelineOpts).
 *
 * Tear rule (spec'd 2026-07-17, user-confirmed): a wall shared as a MUTUAL
 * OUTER boundary (in the dragged room's wallCycle AND another non-nested
 * room's wallCycle) is torn — the stationary neighbor keeps the original
 * wall WITH its openings; the dragged room gets a bare duplicate.
 * Container/island sharing (wall in one room's holeCycles and the island's
 * wallCycle) is NEVER torn: islands ride with their container, and a
 * dragged island takes its walls wholesale (the container's hole
 * regenerates via reconcileRooms at commit).
 */
export interface RoomRig {
  roomId: RoomId
  wallIds: WallId[]
  nodeIds: NodeId[]
  openingIds: OpeningId[]
  furnitureIds: FurnitureId[]
  /** Island rooms riding along untorn (their identities move with the rig). */
  nestedRoomIds: RoomId[]
}

export interface RoomRigInfo {
  rig: RoomRig
  /** Outer boundary polygon at collection time — freeze for gesture math. */
  polygon: Vec2[]
  /** Rotation pivot (area centroid; may lie outside for L-shapes). */
  centroid: Vec2
  /** Guaranteed-interior point — pivot fallback when centroid is outside. */
  labelAnchor: Vec2
}

/** Frozen gesture-start positions; transforms are always FROM these. */
export interface RigStarts {
  nodes: Map<NodeId, Vec2>
  furniture: Map<FurnitureId, { x: number; y: number; rotation: number }>
}

export interface RigTransform {
  delta: Vec2
  /** Radians about `center`; 0 for pure translation. */
  angleRad: number
  center: Vec2
}

/**
 * Collect the rig for a room. Doc-only (mutations cannot read the derived
 * layer): the room's polygon is reconstructed by re-running detectFaces and
 * matching the wall-ID fingerprint — the same join as paintRoomWalls and
 * store/derived.ts. Returns null when the room or its face is missing
 * (stale id / mid-edit transient): the gesture must not arm.
 *
 * Furniture rides iff its CENTER is inside the OUTER polygon — holes are
 * deliberately NOT excluded: island walls and their contents ride too, so
 * everything inside the outer boundary belongs to the rig.
 */
export function collectRoomRig(doc: ProjectDocument, roomId: RoomId): RoomRigInfo | null {
  const room = doc.rooms[roomId]
  if (!room) return null

  const fingerprint = (ids: readonly WallId[]) => [...ids].sort().join('|')
  const roomKey = fingerprint([...room.wallCycle, ...room.holeCycles.flat()])
  const face = detectFaces(doc.nodes, doc.walls).find(
    (f) => fingerprint([...f.wallSet, ...f.holeCycles.flat()]) === roomKey,
  )
  if (!face) return null

  // wall set: the room's own fingerprint plus nested island rooms',
  // transitively (islands may hold deeper islands in their own holes)
  const wallIds = new Set<WallId>([...room.wallCycle, ...room.holeCycles.flat()])
  const nestedRoomIds: RoomId[] = []
  const others = Object.values(doc.rooms).filter((r) => r.id !== roomId)
  for (let grew = true; grew; ) {
    grew = false
    for (const r of others) {
      if (nestedRoomIds.includes(r.id)) continue
      if (r.wallCycle.length > 0 && r.wallCycle.every((w) => wallIds.has(w))) {
        nestedRoomIds.push(r.id)
        for (const w of [...r.wallCycle, ...r.holeCycles.flat()]) {
          if (!wallIds.has(w)) {
            wallIds.add(w)
            grew = true
          }
        }
      }
    }
  }

  const nodeIds = new Set<NodeId>()
  for (const id of wallIds) {
    const w = doc.walls[id]
    if (!w) continue
    nodeIds.add(w.a)
    nodeIds.add(w.b)
  }

  const openingIds: OpeningId[] = []
  for (const op of Object.values(doc.openings)) {
    if (wallIds.has(op.wallId)) openingIds.push(op.id)
  }

  const furnitureIds: FurnitureId[] = []
  for (const f of Object.values(doc.furniture)) {
    if (pointInPolygon({ x: f.x, y: f.y }, face.polygon)) furnitureIds.push(f.id)
  }

  return {
    rig: {
      roomId,
      wallIds: [...wallIds],
      nodeIds: [...nodeIds],
      openingIds,
      furnitureIds,
      nestedRoomIds,
    },
    polygon: face.polygon.map((p) => ({ x: p.x, y: p.y })),
    centroid: { ...face.centroid },
    labelAnchor: { ...face.labelAnchor },
  }
}

/**
 * Tear the rig free of stationary geometry — RAW doc edits, NO pipeline run
 * (a normalize pass at zero displacement would instantly weld the coincident
 * duplicates back). Runs inside the gesture transaction so abort restores
 * everything, including the fingerprint swap.
 *
 * 1. Every mutual-outer-boundary wall is replaced IN THE RIG by a bare
 *    duplicate (same endpoints/thickness/height/paint/finish, NO openings —
 *    the neighbor keeps the physical wall and its doors); the duplicate's
 *    openings are pruned from rig bookkeeping.
 * 2. Every rig node that also anchors a non-rig wall is duplicated and the
 *    rig's walls re-pointed to the duplicate. Order matters: after step 1
 *    the original shared wall is non-rig, which forces both its endpoints
 *    to be duplicated here.
 * 3. The stored room's fingerprint swaps torn ids in place — this preserves
 *    room identity through commit reconcile AND keeps the derived
 *    face↔room join exact mid-drag (the room keeps rendering while it
 *    moves).
 *
 * Returns a NEW rig (the input is not mutated). No shared geometry → the
 * input rig is returned unchanged.
 */
export function tearRoomRig(doc: ProjectDocument, rig: RoomRig): RoomRig {
  const room = doc.rooms[rig.roomId]
  if (!room) return rig

  const rigRoomIds = new Set<RoomId>([rig.roomId, ...rig.nestedRoomIds])
  const foreignOuter = new Set<WallId>()
  for (const r of Object.values(doc.rooms)) {
    if (rigRoomIds.has(r.id)) continue
    for (const w of r.wallCycle) foreignOuter.add(w)
  }

  // step 1: duplicate mutual outer-boundary walls
  const wallMap = new Map<WallId, WallId>()
  const ownOuter = new Set<WallId>(room.wallCycle)
  for (const id of rig.wallIds) {
    if (!ownOuter.has(id) || !foreignOuter.has(id)) continue
    const w = doc.walls[id]
    if (!w) continue
    const dup = newWallId()
    doc.walls[dup] = {
      id: dup,
      a: w.a,
      b: w.b,
      thickness: w.thickness,
      height: w.height,
      ...(w.paintFront ? { paintFront: w.paintFront } : {}),
      ...(w.paintBack ? { paintBack: w.paintBack } : {}),
      ...(w.finishFront ? { finishFront: w.finishFront } : {}),
      ...(w.finishBack ? { finishBack: w.finishBack } : {}),
    }
    wallMap.set(id, dup)
  }

  const wallIds = rig.wallIds.map((id) => wallMap.get(id) ?? id)
  const rigWallSet = new Set<WallId>(wallIds)
  const tornOriginals = new Set<WallId>(wallMap.keys())
  const openingIds = rig.openingIds.filter((id) => {
    const op = doc.openings[id]
    return !!op && !tornOriginals.has(op.wallId)
  })

  // step 2: duplicate nodes shared with non-rig walls
  const rigNodeSet = new Set<NodeId>()
  for (const id of wallIds) {
    const w = doc.walls[id]
    if (!w) continue
    rigNodeSet.add(w.a)
    rigNodeSet.add(w.b)
  }
  const sharedNodes = new Set<NodeId>()
  for (const w of Object.values(doc.walls)) {
    if (rigWallSet.has(w.id)) continue
    if (rigNodeSet.has(w.a)) sharedNodes.add(w.a)
    if (rigNodeSet.has(w.b)) sharedNodes.add(w.b)
  }
  const nodeMap = new Map<NodeId, NodeId>()
  for (const id of sharedNodes) {
    const n = doc.nodes[id]
    if (!n) continue
    const dup = newNodeId()
    doc.nodes[dup] = { id: dup, x: n.x, y: n.y }
    nodeMap.set(id, dup)
  }
  if (nodeMap.size) {
    for (const id of rigWallSet) {
      const w = doc.walls[id]
      if (!w) continue
      const a = nodeMap.get(w.a)
      const b = nodeMap.get(w.b)
      if (a) w.a = a
      if (b) w.b = b
    }
  }
  const nodeIds = [...rigNodeSet].map((id) => nodeMap.get(id) ?? id)

  // step 3: swap torn wall ids in the stored fingerprint
  if (wallMap.size) {
    const swap = (ids: readonly WallId[]) => ids.map((id) => wallMap.get(id) ?? id)
    if (room.wallCycle.some((id) => wallMap.has(id))) room.wallCycle = swap(room.wallCycle)
    if (room.holeCycles.some((c) => c.some((id) => wallMap.has(id)))) {
      room.holeCycles = room.holeCycles.map(swap)
    }
  }

  return { ...rig, wallIds, nodeIds, openingIds }
}

/** Snapshot rig start positions; every transform frame recomputes FROM these. */
export function captureRigStarts(doc: ProjectDocument, rig: RoomRig): RigStarts {
  const nodes = new Map<NodeId, Vec2>()
  for (const id of rig.nodeIds) {
    const n = doc.nodes[id]
    if (n) nodes.set(id, { x: n.x, y: n.y })
  }
  const furniture = new Map<FurnitureId, { x: number; y: number; rotation: number }>()
  for (const id of rig.furnitureIds) {
    const f = doc.furniture[id]
    if (f) furniture.set(id, { x: f.x, y: f.y, rotation: f.rotation })
  }
  return { nodes, furniture }
}

const applyXform = (p: Vec2, t: RigTransform): Vec2 => {
  const q = t.angleRad === 0 ? p : add(rotate(sub(p, t.center), t.angleRad), t.center)
  return add(q, t.delta)
}

/**
 * Rigid-transform the rig from its FROZEN starts (never incremental — no
 * per-frame drift): nodes and furniture centers rotate about `center` then
 * translate; furniture composes `angleRad` into its own rotation. Openings
 * ride their walls' `t` untouched (a rigid transform preserves wall length,
 * so the live re-clamp can never delete).
 *
 * 'live' runs the non-destructive pipeline only. 'commit' demotes every rig
 * id so stationary geometry wins all welds (paste semantics), and applies
 * the sub-threshold guard: when every rig node would land < MERGE_EPS from
 * its start, the exact start positions are committed instead — otherwise
 * node welds recapture the shared corners while free corners keep the
 * offset, and the room lands SHEARED.
 */
export function transformRigRigid(
  doc: ProjectDocument,
  rig: RoomRig,
  starts: RigStarts,
  xform: RigTransform,
  opts: { mode?: MutationMode } = {},
): void {
  const mode = opts.mode ?? 'commit'
  let t = xform
  if (mode === 'commit') {
    let maxDisp = 0
    for (const p of starts.nodes.values()) {
      maxDisp = Math.max(maxDisp, dist(p, applyXform(p, t)))
    }
    if (maxDisp < MERGE_EPS) t = { delta: { x: 0, y: 0 }, angleRad: 0, center: t.center }
  }

  for (const [id, p] of starts.nodes) {
    const n = doc.nodes[id]
    if (!n) continue
    const q = applyXform(p, t)
    if (n.x !== q.x) n.x = q.x
    if (n.y !== q.y) n.y = q.y
  }
  for (const [id, s] of starts.furniture) {
    const f = doc.furniture[id]
    if (!f) continue
    const q = applyXform({ x: s.x, y: s.y }, t)
    const rot = s.rotation + t.angleRad
    if (f.x !== q.x) f.x = q.x
    if (f.y !== q.y) f.y = q.y
    if (f.rotation !== rot) f.rotation = rot
  }

  if (mode === 'commit') {
    const demoted = new Set<string>([...rig.nodeIds, ...rig.wallIds, ...rig.openingIds])
    runPipeline(doc, 'commit', { demoted })
  } else {
    runPipeline(doc, 'live')
  }
}
