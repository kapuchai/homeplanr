import type { ProjectDocument } from '../../model/types'
import type { FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../../model/ids'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'
import { dist, sub } from '../../geometry/vec'
import { distToSegment } from '../../geometry/segment'
import { pointInOBB, pointInPolygonWithHoles } from '../../geometry/polygon'

/**
 * Geometric hit-testing (never DOM-based). Priority order (plan-pinned):
 * openings > furniture (smallest footprint wins among overlaps) > nodes
 * (only those offered by the caller — selection context) > walls > rooms.
 * Manipulation handles are tested by the select tool itself (M3) before
 * calling this. Tolerances are screen px, converted via pxToWorld.
 */
export type EntityRef =
  | { kind: 'opening'; id: OpeningId }
  | { kind: 'furniture'; id: FurnitureId }
  | { kind: 'node'; id: NodeId }
  | { kind: 'wall'; id: WallId }
  | { kind: 'room'; id: RoomId }

export interface HitOptions {
  /** Nodes eligible for hitting (plan: only when self/neighbor selected). */
  nodeCandidates?: ReadonlySet<NodeId>
}

const OPENING_INFLATE_PX = 4
const FURNITURE_INFLATE_PX = 3
const NODE_RADIUS_PX = 8
const WALL_TOLERANCE_PX = 4

export function hitTestAll(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  world: Vec2,
  pxToWorld: number,
  opts: HitOptions = {},
): EntityRef[] {
  const hits: EntityRef[] = []

  // --- openings (they sit on top of walls) ---
  for (const solid of Object.values(derived.wallSolids)) {
    if (!solid.openings.length) continue
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    const { origin, dir } = solid.frame
    const rel = sub(world, origin)
    const u = rel.x * dir.x + rel.y * dir.y
    const v = rel.x * dir.y - rel.y * dir.x
    const inflate = OPENING_INFLATE_PX * pxToWorld
    if (Math.abs(v) > wall.thickness / 2 + inflate) continue
    for (const op of solid.openings) {
      if (u >= op.u0 - inflate && u <= op.u1 + inflate) {
        hits.push({ kind: 'opening', id: op.openingId })
      }
    }
  }

  // --- furniture: smallest footprint first among overlapping hits ---
  const inflate = FURNITURE_INFLATE_PX * pxToWorld
  const furnitureHits = Object.values(doc.furniture)
    .filter((f) =>
      pointInOBB(
        world,
        { x: f.x, y: f.y },
        { w: f.size.w + 2 * inflate, d: f.size.d + 2 * inflate },
        f.rotation,
      ),
    )
    .sort((a, b) => a.size.w * a.size.d - b.size.w * b.size.d || (a.id < b.id ? -1 : 1))
  for (const f of furnitureHits) hits.push({ kind: 'furniture', id: f.id })

  // --- nodes (contextual) ---
  if (opts.nodeCandidates?.size) {
    const r = NODE_RADIUS_PX * pxToWorld
    for (const id of opts.nodeCandidates) {
      const n = doc.nodes[id]
      if (n && dist(world, n) <= r) hits.push({ kind: 'node', id })
    }
  }

  // --- walls ---
  const wallTol = WALL_TOLERANCE_PX * pxToWorld
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    if (distToSegment(world, na, nb) <= w.thickness / 2 + wallTol) {
      hits.push({ kind: 'wall', id: w.id })
    }
  }

  // --- rooms (read-only select) ---
  for (const room of Object.values(derived.rooms)) {
    if (pointInPolygonWithHoles(world, room.polygon, room.holePolygons)) {
      hits.push({ kind: 'room', id: room.roomId })
    }
  }

  return hits
}

export const hitTestTop = (
  doc: ProjectDocument,
  derived: DerivedGeometry,
  world: Vec2,
  pxToWorld: number,
  opts: HitOptions = {},
): EntityRef | null => hitTestAll(doc, derived, world, pxToWorld, opts)[0] ?? null
