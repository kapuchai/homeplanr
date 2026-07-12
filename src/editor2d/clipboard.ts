import type { ProjectDocument } from '../model/types'
import type { FurnitureId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import type { AddFurnitureParams } from '../model/mutations/furniture'

/**
 * Furniture clipboard — module-level BY DESIGN: no OS-clipboard plugin or
 * permissions needed, and the payload survives New/Open (it is neither doc
 * nor ui state). Items are stored as offsets from the copy anchor (the
 * centroid of the copied centers) so a paste lands the group centered on
 * the target point.
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
}

let payload: { anchor: Vec2; items: ClipboardItem[] } | null = null

/** Copy the furniture among `ids`. No furniture ⇒ false, payload untouched. */
export function copyFurniture(doc: ProjectDocument, ids: readonly string[]): boolean {
  const items = ids
    .map((id) => doc.furniture[id as FurnitureId])
    .filter((f): f is NonNullable<typeof f> => f !== undefined)
  if (items.length === 0) return false
  const anchor: Vec2 = {
    x: items.reduce((s, f) => s + f.x, 0) / items.length,
    y: items.reduce((s, f) => s + f.y, 0) / items.length,
  }
  payload = {
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
    })),
  }
  return true
}

export const hasClipboard = (): boolean => payload !== null

/** Where a paste lands: the cursor, else the copy anchor nudged by 0.25m. */
export function pasteTarget(
  pointerWorld: Vec2 | null,
  fallbackAnchor: Vec2 = payload?.anchor ?? { x: 0, y: 0 },
): Vec2 {
  return pointerWorld ?? { x: fallbackAnchor.x + 0.25, y: fallbackAnchor.y + 0.25 }
}

/** Materialize the payload around `target` for addFurnitureBatch. */
export function buildPasteParams(target: Vec2): AddFurnitureParams[] {
  if (!payload) return []
  return payload.items.map((it) => ({
    catalogItemId: it.catalogItemId,
    x: target.x + it.dx,
    y: target.y + it.dy,
    rotation: it.rotation,
    size: { ...it.size },
    elevation: it.elevation,
    ...(it.name ? { name: it.name } : {}),
    ...(it.mirrored ? { mirrored: true } : {}),
  }))
}

/** Test hook: module state must not leak across cases. */
export function clearClipboardForTests(): void {
  payload = null
}
