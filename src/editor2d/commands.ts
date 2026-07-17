import type { ToolContext } from './tools/toolTypes'
import type { Vec2 } from '../geometry/vec'
import { beginTx, commitTx, isTxActive } from '../store/transactions'
import {
  buildPayload,
  buildPasteParams,
  clipboardGraph,
  copyToClipboard,
  hasClipboard,
  materializeItems,
  pasteTarget,
} from './clipboard'
import { closestPointOnSegment } from '../geometry/segment'
import { getDerived } from '../store/derived'
import { polygonBounds } from '../geometry/polygon'
import { useAppSettings } from '../store/appSettings'
import { docContentBounds, selectionContentBounds } from './render/bounds'
import { useViewportStore } from './viewport/viewportStore'
import type { AnnotationId, FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../model/ids'
import { captureRigStarts, collectRoomRig } from '../model/mutations/roomRig'
import { roomPivot } from './tools/handles'

/**
 * Selection commands — ONE implementation shared by the keymap and the
 * context menu (M4). Every mutating command is a single undo entry and
 * no-ops (returning false) while a foreign transaction is live.
 */

const selectedFurniture = (ctx: ToolContext): FurnitureId[] =>
  ctx.ui().selection.filter((id) => ctx.doc().furniture[id as FurnitureId]) as FurnitureId[]

export function duplicateSelection(ctx: ToolContext): boolean {
  if (isTxActive()) return false
  const ids = selectedFurniture(ctx)
  if (!ids.length) return false
  const copies = ctx.actions().duplicateFurniture(ids)
  ctx.ui().setSelection(copies)
  return true
}

export function rotateSelection(ctx: ToolContext, dir: 1 | -1): boolean {
  if (isTxActive()) return false
  // sole-selected room: rotate the whole rig ±90° about its pivot (0.8.0)
  const sel = ctx.ui().selection
  if (sel.length === 1 && ctx.doc().rooms[sel[0]! as RoomId]) {
    return rotateRoom(ctx, sel[0]! as RoomId, dir)
  }
  const ids = selectedFurniture(ctx)
  if (!ids.length) return false
  const tx = beginTx()
  for (const id of ids) {
    const f = ctx.doc().furniture[id]!
    ctx.actions().transformFurniture(id, { rotation: f.rotation + (dir * Math.PI) / 2 })
  }
  commitTx(tx)
  return true
}

/**
 * One-shot ±90° room rotation about roomPivot — the same tear + rig
 * machinery as the drag, in one tx. Walls swept across neighbors resolve
 * through the commit pipeline (X-splits/welds, rig demoted) —
 * deterministic and a single undo entry.
 */
export function rotateRoom(ctx: ToolContext, roomId: RoomId, dir: 1 | -1): boolean {
  if (isTxActive()) return false
  const info = collectRoomRig(ctx.doc(), roomId)
  if (!info) return false
  const pivot = roomPivot(info)
  const tx = beginTx()
  const rig = ctx.actions().tearRoomRig(info.rig)
  const starts = captureRigStarts(ctx.doc(), rig)
  ctx.actions().transformRoomRig(
    rig,
    starts,
    { delta: { x: 0, y: 0 }, angleRad: (dir * Math.PI) / 2, center: pivot },
    { mode: 'commit' },
  )
  commitTx(tx)
  return true
}

export function flipSelection(ctx: ToolContext): boolean {
  if (isTxActive()) return false
  const ids = selectedFurniture(ctx)
  if (!ids.length) return false
  const tx = beginTx()
  for (const id of ids) {
    const f = ctx.doc().furniture[id]!
    ctx.actions().transformFurniture(id, { mirrored: !f.mirrored })
  }
  commitTx(tx)
  return true
}

export function copySelection(ctx: ToolContext): boolean {
  if (isTxActive()) return false
  return copyToClipboard(ctx.doc(), ctx.derived(), ctx.ui().selection)
}

/** Paste at `world` (context menu), or at the tracked cursor / view center. */
export function pasteClipboard(ctx: ToolContext, world?: Vec2): boolean {
  if (isTxActive() || !hasClipboard()) return false
  let target = world ?? pasteTarget(ctx.interaction().pointerWorld)
  const g = clipboardGraph()
  if (g && !world && !ctx.interaction().pointerWorld) {
    // no cursor to aim at: the furniture-era +0.25m nudge would weld a graph
    // payload onto its own source (X-split confetti) — land it DISJOINT
    const dxs = g.nodes.map((n) => n.dx)
    target = { x: target.x + (Math.max(...dxs) - Math.min(...dxs)) + 0.5, y: target.y }
  }
  // graph + furniture land as ONE undo entry
  const tx = beginTx()
  const wallIds = g ? ctx.actions().pasteSubgraph(g, target) : []
  const itemIds = ctx.actions().addFurnitureBatch(buildPasteParams(target))
  commitTx(tx)
  ctx.ui().setSelection([...wallIds, ...itemIds])
  return wallIds.length > 0 || itemIds.length > 0
}

/**
 * Duplicate a room: its cycle walls, openings, contents, and meta pasted
 * FULLY DISJOINT to the right (a small offset would X-split everything
 * into confetti against the source).
 */
export function duplicateRoom(ctx: ToolContext, roomId: string): boolean {
  if (isTxActive()) return false
  const doc = ctx.doc()
  const payload = buildPayload(doc, ctx.derived(), [roomId])
  if (!payload?.graph) return false
  const dxs = payload.graph.nodes.map((n) => n.dx)
  // beyond EVERY existing wall (landing on a neighbor room would weld):
  // clone minX = doc maxX + 0.5
  const docMaxX = Math.max(
    ...Object.values(doc.walls).flatMap((w) => {
      const a = doc.nodes[w.a]
      const b = doc.nodes[w.b]
      return a && b ? [a.x, b.x] : []
    }),
  )
  const target = { x: docMaxX + 0.5 - Math.min(...dxs), y: payload.anchor.y }
  const tx = beginTx()
  const wallIds = ctx.actions().pasteSubgraph(payload.graph, target)
  const itemIds = ctx.actions().addFurnitureBatch(materializeItems(payload, target))
  commitTx(tx)
  ctx.ui().setSelection([...wallIds, ...itemIds])
  return true
}

export function alignSelection(
  ctx: ToolContext,
  edge: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY',
): boolean {
  if (isTxActive()) return false
  const ids = selectedFurniture(ctx)
  if (ids.length < 2) return false
  ctx.actions().alignFurniture(ids, edge)
  return true
}

export function distributeSelection(ctx: ToolContext, axis: 'x' | 'y'): boolean {
  if (isTxActive()) return false
  const ids = selectedFurniture(ctx)
  if (ids.length < 3) return false
  ctx.actions().distributeFurniture(ids, axis)
  return true
}

export function deleteSelection(ctx: ToolContext): boolean {
  if (isTxActive()) return false
  const ids = ctx.ui().selection.filter((id) => !ctx.doc().rooms[id as never]) as (
    | WallId
    | NodeId
    | OpeningId
    | FurnitureId
    | AnnotationId
  )[]
  if (!ids.length) return false
  ctx.actions().deleteEntities(ids)
  return true
}

/** Split a wall at the point of `world` projected onto its segment. */
export function splitWallAt(ctx: ToolContext, wallId: WallId, world: Vec2): boolean {
  if (isTxActive()) return false
  const doc = ctx.doc()
  const w = doc.walls[wallId]
  const na = w && doc.nodes[w.a]
  const nb = w && doc.nodes[w.b]
  if (!w || !na || !nb) return false
  const { t } = closestPointOnSegment(world, na, nb)
  if (t <= 0.01 || t >= 0.99) return false // too close to an endpoint
  return ctx.actions().splitWall(wallId, t) !== null
}

export function selectAll(ctx: ToolContext): void {
  const d = ctx.doc()
  ctx
    .ui()
    .setSelection([
      ...Object.keys(d.walls),
      ...Object.keys(d.openings),
      ...Object.keys(d.furniture),
      // hidden annotations are unselectable EVERYWHERE (the M4 parity rule) —
      // Ctrl+A must not arm Delete against entities the user cannot see
      ...(useAppSettings.getState().showAnnotations ? Object.keys(d.annotations) : []),
    ])
}

export function zoomToSelection(ctx: ToolContext): boolean {
  const ids = ctx.ui().selection
  if (!ids.length) return false
  const d = ctx.doc()
  useViewportStore
    .getState()
    .zoomToFit(polygonBounds(selectionContentBounds(d, getDerived(d), ids)))
  return true
}

export function zoomToFitAll(ctx: ToolContext): void {
  const d = ctx.doc()
  useViewportStore.getState().zoomToFit(polygonBounds(docContentBounds(d, getDerived(d))))
}
