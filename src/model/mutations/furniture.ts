import type { FurnitureInstance, ProjectDocument } from '../types'
import { newFurnitureId, type FurnitureId } from '../ids'

/**
 * Furniture mutations. Furniture never affects the wall graph, openings, or
 * rooms — no pipeline runs here; live drags mutate directly.
 */

const SIZE_MIN = 0.1 // footprint (w/d) floor
const HEIGHT_MIN = 0.01 // flat items (rugs) are legitimately ~2cm high
const SIZE_MAX = 5
const ELEV_MIN = 0
const ELEV_MAX = 3

const clampSize = (v: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, v))
const clampHeight = (v: number) => Math.min(SIZE_MAX, Math.max(HEIGHT_MIN, v))
const q = (v: number) => Math.round(v * 100) / 100 // 1cm quantization

export interface AddFurnitureParams {
  catalogItemId: string
  x: number
  y: number
  rotation?: number
  size: { w: number; d: number; h: number }
  elevation?: number
  name?: string
  mirrored?: boolean
}

export function addFurniture(doc: ProjectDocument, params: AddFurnitureParams): FurnitureId {
  const id = newFurnitureId()
  doc.furniture[id] = {
    id,
    catalogItemId: params.catalogItemId,
    x: q(params.x),
    y: q(params.y),
    rotation: params.rotation ?? 0,
    size: {
      w: clampSize(params.size.w),
      d: clampSize(params.size.d),
      h: clampHeight(params.size.h),
    },
    elevation: Math.min(ELEV_MAX, Math.max(ELEV_MIN, params.elevation ?? 0)),
    ...(params.name ? { name: params.name } : {}),
    ...(params.mirrored ? { mirrored: true } : {}),
  }
  return id
}

/** Batch add (paste); the docStore wires it as ONE set ⇒ one undo entry. */
export function addFurnitureBatch(
  doc: ProjectDocument,
  items: readonly AddFurnitureParams[],
): FurnitureId[] {
  return items.map((params) => addFurniture(doc, params))
}

export function transformFurniture(
  doc: ProjectDocument,
  id: FurnitureId,
  patch: Partial<Pick<FurnitureInstance, 'x' | 'y' | 'rotation' | 'elevation' | 'mirrored'>>,
  opts: { quantize?: boolean } = {},
): void {
  const f = doc.furniture[id]
  if (!f) return
  const round = opts.quantize === false ? (v: number) => v : q
  if (patch.x !== undefined) f.x = round(patch.x)
  if (patch.y !== undefined) f.y = round(patch.y)
  if (patch.rotation !== undefined) f.rotation = patch.rotation
  if (patch.elevation !== undefined) {
    f.elevation = Math.min(ELEV_MAX, Math.max(ELEV_MIN, patch.elevation))
  }
  if (patch.mirrored !== undefined) {
    if (patch.mirrored) f.mirrored = true
    else delete f.mirrored // absent = false — files stay clean
  }
}

export function resizeFurniture(
  doc: ProjectDocument,
  id: FurnitureId,
  size: Partial<{ w: number; d: number; h: number }>,
): void {
  const f = doc.furniture[id]
  if (!f) return
  if (size.w !== undefined) f.size.w = clampSize(size.w)
  if (size.d !== undefined) f.size.d = clampSize(size.d)
  if (size.h !== undefined) f.size.h = clampHeight(size.h)
}

export function renameFurniture(doc: ProjectDocument, id: FurnitureId, name: string): void {
  const f = doc.furniture[id]
  if (!f) return
  const trimmed = name.trim()
  if (trimmed) f.name = trimmed
  else delete f.name
}

/** Duplicate selected furniture at a +(0.25, 0.25) m offset; returns new ids. */
export function duplicateFurniture(
  doc: ProjectDocument,
  ids: readonly FurnitureId[],
): FurnitureId[] {
  const created: FurnitureId[] = []
  for (const id of ids) {
    const f = doc.furniture[id]
    if (!f) continue
    const nid = newFurnitureId()
    doc.furniture[nid] = {
      ...f,
      id: nid,
      x: q(f.x + 0.25),
      y: q(f.y + 0.25),
      size: { ...f.size },
    }
    created.push(nid)
  }
  return created
}
