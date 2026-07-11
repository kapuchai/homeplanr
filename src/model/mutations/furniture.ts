import type { FurnitureInstance, ProjectDocument } from '../types'
import { newFurnitureId, type FurnitureId } from '../ids'

/**
 * Furniture mutations. Furniture never affects the wall graph, openings, or
 * rooms — no pipeline runs here; live drags mutate directly.
 */

const SIZE_MIN = 0.1
const SIZE_MAX = 5
const ELEV_MIN = 0
const ELEV_MAX = 3

const clampSize = (v: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, v))
const q = (v: number) => Math.round(v * 100) / 100 // 1cm quantization

export function addFurniture(
  doc: ProjectDocument,
  params: {
    catalogItemId: string
    x: number
    y: number
    rotation?: number
    size: { w: number; d: number; h: number }
    elevation?: number
    name?: string
  },
): FurnitureId {
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
      h: clampSize(params.size.h),
    },
    elevation: Math.min(ELEV_MAX, Math.max(ELEV_MIN, params.elevation ?? 0)),
    ...(params.name ? { name: params.name } : {}),
  }
  return id
}

export function transformFurniture(
  doc: ProjectDocument,
  id: FurnitureId,
  patch: Partial<Pick<FurnitureInstance, 'x' | 'y' | 'rotation' | 'elevation'>>,
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
  if (size.h !== undefined) f.size.h = clampSize(size.h)
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
