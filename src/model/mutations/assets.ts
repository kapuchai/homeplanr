import type { ImageAsset, ProjectDocument } from '../types'
import { newAssetId, type AssetId } from '../ids'

/** Anything carrying the shared assets map — the full document or a
 * LevelDoc view (whose `assets` aliases the same top-level map). */
interface AssetsHost {
  assets: Record<AssetId, ImageAsset>
}

/**
 * Embedded image assets (v6). Inert leaf data — no pipeline runs here, and
 * nothing in the wall graph ever references an asset. Size discipline lives
 * at ingest (persistence/imageIngest.ts); this layer only stores.
 */

/** Asset payload without identity — what ingest produces and clipboards
 * carry (content, not ids: a pasted id from another document is meaningless). */
export interface AssetContent {
  mime: string
  data: string
  w: number
  h: number
}

/** Insert an image, content-deduped: re-adding identical bytes (same-doc
 * paste, repeated upload) returns the existing id instead of growing the
 * document. */
export function addAsset(doc: AssetsHost, content: AssetContent): AssetId {
  for (const a of Object.values(doc.assets)) {
    if (a.data === content.data && a.mime === content.mime) return a.id
  }
  const id = newAssetId()
  doc.assets[id] = { id, mime: content.mime, data: content.data, w: content.w, h: content.h }
  return id
}

/** Every asset id the document references — THE GC oracle. Reference
 * kinds: wall-art (FurnitureInstance.assetId, on ANY level — v7 scans
 * every level's furniture; a single-level scan would GC-delete assets
 * referenced only by another floor at the next save) and the save
 * preview (doc.previewAssetId, 0.11.0). New reference kinds extend THIS
 * function or gcAssets eats their assets. */
export function referencedAssetIds(doc: ProjectDocument): Set<AssetId> {
  const refs = new Set<AssetId>()
  for (const level of doc.levels) {
    for (const f of Object.values(level.furniture)) {
      if (f.assetId) refs.add(f.assetId)
    }
  }
  if (doc.previewAssetId) refs.add(doc.previewAssetId)
  return refs
}

/**
 * Set/clear the CUSTOM save preview (0.11.0). Setting stores the image
 * (content-deduped) and flips previewCustom — an undoable, dirtying doc
 * change, unlike the write-time auto render. Clearing reverts to auto:
 * both fields go; the orphaned asset leaves the FILE bytes at the next
 * save while the store keeps it for undo.
 */
export function setPreviewImage(doc: ProjectDocument, content: AssetContent | null): void {
  if (content) {
    doc.previewAssetId = addAsset(doc, content)
    doc.previewCustom = true
  } else {
    delete doc.previewAssetId
    delete doc.previewCustom
  }
}

/**
 * Drop unreferenced assets from a SNAPSHOT for file writes. Returns the
 * same reference when nothing is orphaned (the common case — callers rely
 * on that), else a shallow copy with a filtered assets map. Deliberately
 * NEVER a store mutation: undo can resurrect a deleted art piece for the
 * rest of the session, so the in-memory doc keeps orphans; only the bytes
 * on disk shed them (persistence/controller wires this).
 */
export function gcAssets(doc: ProjectDocument): ProjectDocument {
  const ids = Object.keys(doc.assets) as AssetId[]
  if (!ids.length) return doc
  const refs = referencedAssetIds(doc)
  if (ids.every((id) => refs.has(id))) return doc
  const assets: ProjectDocument['assets'] = {}
  for (const id of ids) {
    if (refs.has(id)) assets[id] = doc.assets[id]!
  }
  return { ...doc, assets }
}
