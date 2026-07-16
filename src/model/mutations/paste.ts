import type { ProjectDocument, WallFinishId } from '../types'
import { DEFAULTS } from '../types'
import {
  newNodeId,
  newOpeningId,
  newWallId,
  type NodeId,
  type WallId,
} from '../ids'
import type { Vec2 } from '../../geometry/vec'
import { runPipeline } from './pipeline'

/**
 * Graph paste (M9). Payload keys are the SOURCE ids (payload-internal
 * references only) — fresh ids are minted here. The trick that keeps this
 * small: nodes are inserted as-is (newNodeId, never getOrCreateNode) and
 * then ONE commit pipeline run IS the paste semantics — normalizeGraph
 * welds within MERGE_EPS, T/X-splits crossings, dedupes wall pairs;
 * revalidateOpenings serializes overlaps deterministically; reconcileRooms
 * mints rooms for new cycles. Room meta (name/floor) transfers afterwards
 * by wall-fingerprint match — skipped silently when welding changed the
 * topology.
 *
 * Determinism (0.4.0): every minted id goes into the pipeline's `demoted`
 * set, so EXISTING geometry always survives welds/dedups (ids are random
 * nanoids — without demotion the survivor was a coin flip) and pasted
 * openings keep their spot only where it is free (exact-fit-or-drop —
 * never evicting, never relocating). An exact-overlay paste therefore
 * preserves existing wall/room identity (names, floors) and is a no-op.
 */
export interface GraphPayload {
  nodes: { key: string; dx: number; dy: number }[]
  walls: {
    key: string
    aKey: string
    bKey: string
    thickness: number
    height: number
    paintFront?: string
    paintBack?: string
    finish?: WallFinishId
  }[]
  openings: {
    wallKey: string
    kind: 'door' | 'window'
    t: number
    width: number
    height: number
    sillHeight?: number
    hinge?: 'a' | 'b'
    swing?: 'front' | 'back'
  }[]
  roomMeta: { wallKeys: string[]; name?: string; floorMaterialId?: string }[]
}

export function pasteSubgraph(
  doc: ProjectDocument,
  payload: GraphPayload,
  target: Vec2,
): WallId[] {
  const demoted = new Set<string>()
  const nodeIds = new Map<string, NodeId>()
  for (const n of payload.nodes) {
    const id = newNodeId()
    nodeIds.set(n.key, id)
    demoted.add(id)
    doc.nodes[id] = { id, x: target.x + n.dx, y: target.y + n.dy }
  }

  const wallIds = new Map<string, WallId>()
  for (const w of payload.walls) {
    const a = nodeIds.get(w.aKey)
    const b = nodeIds.get(w.bKey)
    if (!a || !b || a === b) continue
    const id = newWallId()
    wallIds.set(w.key, id)
    demoted.add(id)
    doc.walls[id] = {
      id,
      a,
      b,
      thickness: w.thickness,
      height: w.height,
      ...(w.paintFront ? { paintFront: w.paintFront } : {}),
      ...(w.paintBack ? { paintBack: w.paintBack } : {}),
      ...(w.finish && w.finish !== 'paint' ? { finish: w.finish } : {}),
    }
  }

  for (const op of payload.openings) {
    const wallId = wallIds.get(op.wallKey)
    if (!wallId) continue
    const id = newOpeningId()
    demoted.add(id)
    if (op.kind === 'door') {
      doc.openings[id] = {
        id,
        wallId,
        kind: 'door',
        t: op.t,
        width: op.width,
        height: op.height,
        hinge: op.hinge ?? DEFAULTS.door.hinge,
        swing: op.swing ?? 'front',
      }
    } else {
      doc.openings[id] = {
        id,
        wallId,
        kind: 'window',
        t: op.t,
        width: op.width,
        height: op.height,
        sillHeight: op.sillHeight ?? DEFAULTS.window.sillHeight,
      }
    }
  }

  runPipeline(doc, 'commit', { demoted })

  // best-effort room meta transfer: exact fingerprint over the MAPPED walls
  const fingerprint = (ids: readonly WallId[]) => [...ids].sort().join('|')
  for (const meta of payload.roomMeta) {
    const mapped = meta.wallKeys
      .map((k) => wallIds.get(k))
      .filter((id): id is WallId => id !== undefined && !!doc.walls[id])
    if (mapped.length !== meta.wallKeys.length) continue // welding changed topology
    const want = fingerprint(mapped)
    for (const room of Object.values(doc.rooms)) {
      if (fingerprint([...room.wallCycle, ...room.holeCycles.flat()]) === want) {
        if (meta.name) room.name = meta.name
        if (meta.floorMaterialId) room.floorMaterialId = meta.floorMaterialId
        break
      }
    }
  }

  // splits/welds may have consumed some pasted walls — report the survivors
  return [...wallIds.values()].filter((id) => !!doc.walls[id])
}
