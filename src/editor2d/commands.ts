import type { ToolContext } from './tools/toolTypes'
import type { Vec2 } from '../geometry/vec'
import { beginTx, commitTx, isTxActive } from '../store/transactions'
import { buildPasteParams, copyFurniture, hasClipboard, pasteTarget } from './clipboard'
import { closestPointOnSegment } from '../geometry/segment'
import { getDerived } from '../store/derived'
import { polygonBounds } from '../geometry/polygon'
import { docContentBounds, selectionContentBounds } from './render/bounds'
import { useViewportStore } from './viewport/viewportStore'
import type { AnnotationId, FurnitureId, NodeId, OpeningId, WallId } from '../model/ids'

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
  return copyFurniture(ctx.doc(), ctx.ui().selection)
}

/** Paste at `world` (context menu), or at the tracked cursor / view center. */
export function pasteClipboard(ctx: ToolContext, world?: Vec2): boolean {
  if (isTxActive() || !hasClipboard()) return false
  const target = world ?? pasteTarget(ctx.interaction().pointerWorld)
  const ids = ctx.actions().addFurnitureBatch(buildPasteParams(target))
  ctx.ui().setSelection(ids)
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
      ...Object.keys(d.annotations),
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
