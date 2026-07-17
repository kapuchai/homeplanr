import type { ProjectDocument, Room } from '../model/types'
import type { FurnitureId, RoomId, WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import type { AddFurnitureParams } from '../model/mutations/furniture'
import type { GraphPayload } from '../model/mutations/paste'
import type { DerivedGeometry } from '../store/derived'
import { pointInPolygonWithHoles } from '../geometry/polygon'

/**
 * Clipboard — module-level BY DESIGN: no OS-clipboard plugin or permissions
 * needed, and the payload survives New/Open (it is neither doc nor ui
 * state). Two halves around one shared anchor (the centroid of everything
 * copied): furniture items, and (M9) a wall-graph payload — selected walls
 * with their endpoint nodes and hosted openings, plus whole rooms (their
 * cycles, contained furniture, and name/floor meta).
 */
interface ClipboardItem {
  catalogItemId: string
  name?: string
  dx: number
  dy: number
  rotation: number
  size: { w: number; d: number; h: number }
  elevation: number
  mirrored?: boolean
  // v4 per-item meta rides copies too — a whitelist that forgets a field
  // silently strips it on paste
  price?: number
  notes?: string
  materialOverrides?: Record<string, string>
}

export interface ClipboardPayload {
  anchor: Vec2
  items: ClipboardItem[]
  graph: GraphPayload | null
}

let payload: ClipboardPayload | null = null

/** Build a payload for `ids` without touching the module clipboard. */
export function buildPayload(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  ids: readonly string[],
): ClipboardPayload | null {
  const wallIds = new Set<WallId>()
  const furnIds = new Set<FurnitureId>()
  const rooms: Room[] = []

  for (const id of ids) {
    if (doc.walls[id as WallId]) wallIds.add(id as WallId)
    if (doc.furniture[id as FurnitureId]) furnIds.add(id as FurnitureId)
    const room = doc.rooms[id as RoomId]
    if (room) {
      rooms.push(room)
      for (const w of [...room.wallCycle, ...room.holeCycles.flat()]) wallIds.add(w)
    }
  }
  // room copies bring their contents along
  for (const room of rooms) {
    const dr = derived.rooms[room.id]
    if (!dr) continue
    for (const f of Object.values(doc.furniture)) {
      if (pointInPolygonWithHoles({ x: f.x, y: f.y }, dr.polygon, dr.holePolygons)) {
        furnIds.add(f.id)
      }
    }
  }

  const walls = [...wallIds].map((id) => doc.walls[id]!).filter(Boolean)
  const items = [...furnIds].map((id) => doc.furniture[id]!).filter(Boolean)
  if (!walls.length && !items.length) return null

  const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]))
  const nodes = [...nodeIds].map((id) => doc.nodes[id]!).filter(Boolean)

  // shared anchor: centroid of all copied points
  const pts: Vec2[] = [...nodes, ...items.map((f) => ({ x: f.x, y: f.y }))]
  const anchor: Vec2 = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  }

  const graph: GraphPayload | null = walls.length
    ? {
        nodes: nodes.map((n) => ({ key: n.id, dx: n.x - anchor.x, dy: n.y - anchor.y })),
        walls: walls.map((w) => ({
          key: w.id,
          aKey: w.a,
          bKey: w.b,
          thickness: w.thickness,
          height: w.height,
          ...(w.paintFront ? { paintFront: w.paintFront } : {}),
          ...(w.paintBack ? { paintBack: w.paintBack } : {}),
          ...(w.finishFront ? { finishFront: w.finishFront } : {}),
          ...(w.finishBack ? { finishBack: w.finishBack } : {}),
        })),
        openings: Object.values(doc.openings)
          .filter((op) => wallIds.has(op.wallId))
          .map((op) => ({
            wallKey: op.wallId,
            kind: op.kind,
            t: op.t,
            width: op.width,
            height: op.height,
            ...(op.kind === 'window' ? { sillHeight: op.sillHeight } : {}),
            ...(op.kind === 'door' ? { hinge: op.hinge, swing: op.swing } : {}),
          })),
        roomMeta: rooms
          .filter((r) => r.name || r.floorMaterialId || r.roomType)
          .map((r) => ({
            wallKeys: [...r.wallCycle, ...r.holeCycles.flat()],
            ...(r.name ? { name: r.name } : {}),
            ...(r.floorMaterialId ? { floorMaterialId: r.floorMaterialId } : {}),
            ...(r.roomType ? { roomType: r.roomType } : {}),
          })),
      }
    : null

  return {
    anchor,
    items: items.map((f) => ({
      catalogItemId: f.catalogItemId,
      ...(f.name ? { name: f.name } : {}),
      dx: f.x - anchor.x,
      dy: f.y - anchor.y,
      rotation: f.rotation,
      size: { ...f.size },
      elevation: f.elevation,
      ...(f.mirrored ? { mirrored: true } : {}),
      ...(f.price !== undefined ? { price: f.price } : {}),
      ...(f.notes ? { notes: f.notes } : {}),
      ...(f.materialOverrides ? { materialOverrides: { ...f.materialOverrides } } : {}),
    })),
    graph,
  }
}

/** Copy `ids` (walls/rooms/furniture). Nothing copyable ⇒ false, untouched. */
export function copyToClipboard(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  ids: readonly string[],
): boolean {
  const built = buildPayload(doc, derived, ids)
  if (!built) return false
  payload = built
  return true
}

export const hasClipboard = (): boolean => payload !== null

export const clipboardGraph = (): GraphPayload | null => payload?.graph ?? null

/** Where a paste lands: the cursor, else the copy anchor nudged by 0.25m. */
export function pasteTarget(
  pointerWorld: Vec2 | null,
  fallbackAnchor: Vec2 = payload?.anchor ?? { x: 0, y: 0 },
): Vec2 {
  return pointerWorld ?? { x: fallbackAnchor.x + 0.25, y: fallbackAnchor.y + 0.25 }
}

/** Materialize the furniture half around `target` for addFurnitureBatch. */
export function buildPasteParams(target: Vec2): AddFurnitureParams[] {
  return payload ? materializeItems(payload, target) : []
}

/** Furniture params for an EXPLICIT payload (duplicate-room path). */
export function materializeItems(p: ClipboardPayload, target: Vec2): AddFurnitureParams[] {
  return p.items.map((it) => ({
    catalogItemId: it.catalogItemId,
    x: target.x + it.dx,
    y: target.y + it.dy,
    rotation: it.rotation,
    size: { ...it.size },
    elevation: it.elevation,
    ...(it.name ? { name: it.name } : {}),
    ...(it.mirrored ? { mirrored: true } : {}),
    ...(it.price !== undefined ? { price: it.price } : {}),
    ...(it.notes ? { notes: it.notes } : {}),
    ...(it.materialOverrides ? { materialOverrides: { ...it.materialOverrides } } : {}),
  }))
}

/** Test hook: module state must not leak across cases. */
export function clearClipboardForTests(): void {
  payload = null
}
