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

// ---------- align / distribute (M9) ----------

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'

/** AABB of the ROTATED footprint (mirror is symmetric — irrelevant). */
function footprintAabb(f: FurnitureInstance): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const cos = Math.abs(Math.cos(f.rotation))
  const sin = Math.abs(Math.sin(f.rotation))
  const hx = (f.size.w * cos + f.size.d * sin) / 2
  const hy = (f.size.w * sin + f.size.d * cos) / 2
  return { minX: f.x - hx, maxX: f.x + hx, minY: f.y - hy, maxY: f.y + hy }
}

/**
 * Align in SCREEN terms (the 2D view renders y-up): 'top' = max data-y,
 * 'bottom' = min data-y, left/right = min/max x. One set ⇒ one undo entry.
 */
export function alignFurniture(
  doc: ProjectDocument,
  ids: readonly FurnitureId[],
  edge: AlignEdge,
): void {
  const items = ids.map((id) => doc.furniture[id]).filter((f): f is FurnitureInstance => !!f)
  if (items.length < 2) return
  const boxes = items.map(footprintAabb)
  // NO quantization: these are precision commands — rounding centers to
  // 1cm would leave "aligned" edges off by ≤1cm for odd-cm footprints
  const move = (f: FurnitureInstance, dx: number, dy: number) => {
    f.x = f.x + dx
    f.y = f.y + dy
  }
  if (edge === 'left') {
    const target = Math.min(...boxes.map((b) => b.minX))
    items.forEach((f, i) => move(f, target - boxes[i]!.minX, 0))
  } else if (edge === 'right') {
    const target = Math.max(...boxes.map((b) => b.maxX))
    items.forEach((f, i) => move(f, target - boxes[i]!.maxX, 0))
  } else if (edge === 'bottom') {
    const target = Math.min(...boxes.map((b) => b.minY)) // screen-bottom = min y
    items.forEach((f, i) => move(f, 0, target - boxes[i]!.minY))
  } else if (edge === 'top') {
    const target = Math.max(...boxes.map((b) => b.maxY)) // screen-top = max y
    items.forEach((f, i) => move(f, 0, target - boxes[i]!.maxY))
  } else if (edge === 'centerX') {
    const target = items.reduce((s, f) => s + f.x, 0) / items.length
    items.forEach((f) => move(f, target - f.x, 0))
  } else {
    const target = items.reduce((s, f) => s + f.y, 0) / items.length
    items.forEach((f) => move(f, 0, target - f.y))
  }
}

/**
 * Equal edge-gaps between footprints along the axis (Figma semantics);
 * when the span cannot fit them (negative gap), fall back to equal center
 * spacing. Order = current center order, stable.
 */
export function distributeFurniture(
  doc: ProjectDocument,
  ids: readonly FurnitureId[],
  axis: 'x' | 'y',
): void {
  const items = ids.map((id) => doc.furniture[id]).filter((f): f is FurnitureInstance => !!f)
  if (items.length < 3) return
  const sorted = [...items].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y))
  const boxes = sorted.map(footprintAabb)
  const lo = axis === 'x' ? Math.min(...boxes.map((b) => b.minX)) : Math.min(...boxes.map((b) => b.minY))
  const hi = axis === 'x' ? Math.max(...boxes.map((b) => b.maxX)) : Math.max(...boxes.map((b) => b.maxY))
  const sizes = boxes.map((b) => (axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY))
  const total = sizes.reduce((s, v) => s + v, 0)
  const gap = (hi - lo - total) / (sorted.length - 1)
  if (gap >= 0) {
    let cursor = lo
    sorted.forEach((f, i) => {
      const half = sizes[i]! / 2
      if (axis === 'x') f.x = cursor + half
      else f.y = cursor + half
      cursor += sizes[i]! + gap
    })
  } else {
    // overlap: equal center spacing across the span
    const centers = sorted.map((f) => (axis === 'x' ? f.x : f.y))
    const c0 = centers[0]!
    const c1 = centers[centers.length - 1]!
    sorted.forEach((f, i) => {
      const t = c0 + ((c1 - c0) * i) / (sorted.length - 1)
      if (axis === 'x') f.x = t
      else f.y = t
    })
  }
}
