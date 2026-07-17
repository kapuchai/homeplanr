import type { FurnitureInstance, LevelDoc } from '../types'
import { newFurnitureId, type AssetId, type FurnitureId, type OpeningId } from '../ids'
import { addAsset, type AssetContent } from './assets'
import { reconcileAttachedFurniture } from './attachment'

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
  /** v4 per-item meta (0.9.0 UI) — carried by paste so copies keep it. */
  price?: number
  notes?: string
  materialOverrides?: Record<string, string>
  /** Embedded image CONTENT (v6) — clipboards carry bytes, not ids, so a
   * cross-document paste re-ingests (content-deduped by addAsset). */
  asset?: AssetContent
  /** Window attachment at placement (v6 curtains) — caller supplies the
   * already-derived x/y/rotation/size; the pipeline keeps them synced. */
  attachedOpeningId?: OpeningId
  /** v6 emitter state (0.12.0 UI) — carried by paste so copies keep it. */
  lumen?: number
  lightOn?: boolean
}

export function addFurniture(doc: LevelDoc, params: AddFurnitureParams): FurnitureId {
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
    ...(params.price !== undefined ? { price: params.price } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
    ...(params.materialOverrides ? { materialOverrides: { ...params.materialOverrides } } : {}),
    ...(params.asset ? { assetId: addAsset(doc, params.asset) } : {}),
    ...(params.attachedOpeningId ? { attachedOpeningId: params.attachedOpeningId } : {}),
    ...(params.lumen !== undefined ? { lumen: params.lumen } : {}),
    ...(params.lightOn !== undefined ? { lightOn: params.lightOn } : {}),
  }
  return id
}

/** Batch add (paste); the docStore wires it as ONE set ⇒ one undo entry. */
export function addFurnitureBatch(
  doc: LevelDoc,
  items: readonly AddFurnitureParams[],
): FurnitureId[] {
  return items.map((params) => addFurniture(doc, params))
}

export function transformFurniture(
  doc: LevelDoc,
  id: FurnitureId,
  patch: Partial<Pick<FurnitureInstance, 'x' | 'y' | 'rotation' | 'elevation' | 'mirrored'>>,
  opts: { quantize?: boolean } = {},
): void {
  const f = doc.furniture[id]
  if (!f) return
  // a MANUAL move/rotate breaks a window attachment (v6 curtains): the
  // user takes over, else the next pipeline sync would snap the item back
  // and the edit would read as ignored. Elevation/mirror never detach.
  if (
    f.attachedOpeningId &&
    (patch.x !== undefined || patch.y !== undefined || patch.rotation !== undefined)
  ) {
    delete f.attachedOpeningId
  }
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
  doc: LevelDoc,
  id: FurnitureId,
  size: Partial<{ w: number; d: number; h: number }>,
): void {
  const f = doc.furniture[id]
  if (!f) return
  // width is attachment-derived (window span + overhang) — a manual width
  // takes over, so it detaches; depth/height edits keep the attachment
  if (f.attachedOpeningId && size.w !== undefined) delete f.attachedOpeningId
  if (size.w !== undefined) f.size.w = clampSize(size.w)
  if (size.d !== undefined) f.size.d = clampSize(size.d)
  if (size.h !== undefined) f.size.h = clampHeight(size.h)
  // an attached curtain's center offsets by HALF ITS DEPTH from the wall
  // face — a depth edit must re-sync in the same mutation (no pipeline
  // runs on furniture mutations, so the write-through won't catch it)
  if (f.attachedOpeningId && size.d !== undefined) reconcileAttachedFurniture(doc)
}

export function renameFurniture(doc: LevelDoc, id: FurnitureId, name: string): void {
  const f = doc.furniture[id]
  if (!f) return
  const trimmed = name.trim()
  if (trimmed) f.name = trimmed
  else delete f.name
}

/** Price/notes (0.9.0 UI for the v4 fields). Key presence = intent (the
 * updateWall convention): an explicit undefined clears the field; invalid
 * prices clear rather than store junk. Prices are unit-less — display
 * dresses them in the currency device pref. */
export function setFurnitureMeta(
  doc: LevelDoc,
  id: FurnitureId,
  patch: { price?: number | undefined; notes?: string | undefined },
): void {
  const f = doc.furniture[id]
  if (!f) return
  if ('price' in patch) {
    const p = patch.price
    if (p !== undefined && Number.isFinite(p) && p >= 0) {
      f.price = Math.round(p * 100) / 100
    } else {
      delete f.price
    }
  }
  if ('notes' in patch) {
    const trimmed = patch.notes?.trim()
    if (trimmed) f.notes = trimmed
    else delete f.notes
  }
}

/**
 * Emitter state (0.12.0 UI for the v6 lumen/lightOn fields). Key presence
 * = intent (the setFurnitureMeta convention). ABSENT lightOn means ON — a
 * placed lamp glows at night out of the box — so `true` DELETES the field
 * (files stay clean) and only `false` is stored. Absent lumen falls back
 * to the catalog emitter's defaultLumen at render; invalid values clear
 * rather than store junk (the v6 validator keeps finite > 0 only).
 */
export function setFurnitureLight(
  doc: LevelDoc,
  id: FurnitureId,
  patch: { lumen?: number | undefined; lightOn?: boolean | undefined },
): void {
  const f = doc.furniture[id]
  if (!f) return
  if ('lumen' in patch) {
    const v = patch.lumen
    if (v !== undefined && Number.isFinite(v) && v > 0) f.lumen = Math.round(v)
    else delete f.lumen
  }
  if ('lightOn' in patch) {
    if (patch.lightOn === false) f.lightOn = false
    else delete f.lightOn
  }
}

/** Per-slot recolor (v6 coloring UI): value = PALETTE id or hex; undefined
 * clears the slot; an emptied record leaves the document (files stay
 * clean). Values are NOT validated here — the render side falls back on
 * unknowns (open-registry rule). */
export function setMaterialOverride(
  doc: LevelDoc,
  id: FurnitureId,
  slot: string,
  value: string | undefined,
): void {
  const f = doc.furniture[id]
  if (!f || !slot) return
  if (value) {
    f.materialOverrides = { ...(f.materialOverrides ?? {}), [slot]: value }
  } else if (f.materialOverrides) {
    delete f.materialOverrides[slot]
    if (!Object.keys(f.materialOverrides).length) delete f.materialOverrides
  }
}

/** Point an instance at an embedded asset (set-or-clear; absent = the
 * item's placeholder art). The asset itself is added via addAsset — orphans
 * left behind by a swap/clear are shed by gcAssets at file-write time. */
export function setFurnitureAsset(
  doc: LevelDoc,
  id: FurnitureId,
  assetId: AssetId | undefined,
): void {
  const f = doc.furniture[id]
  if (!f) return
  if (assetId) f.assetId = assetId
  else delete f.assetId
}

/** Duplicate selected furniture at a +(0.25, 0.25) m offset; returns new ids. */
export function duplicateFurniture(
  doc: LevelDoc,
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
      // spread copies by REFERENCE — clone the record or duplicates alias it
      ...(f.materialOverrides ? { materialOverrides: { ...f.materialOverrides } } : {}),
    }
    // assetId rides the spread (same doc, sharing is right); attachment does
    // NOT — a second curtain landing exactly on the same window would be an
    // invisible overlapping twin. The duplicate is a detached copy at the
    // offset position.
    delete doc.furniture[nid]!.attachedOpeningId
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
  doc: LevelDoc,
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
  doc: LevelDoc,
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
