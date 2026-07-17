import type { ProjectDocument } from '../types'
import { newAssetId, type AssetId } from '../ids'

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
export function addAsset(doc: ProjectDocument, content: AssetContent): AssetId {
  for (const a of Object.values(doc.assets)) {
    if (a.data === content.data && a.mime === content.mime) return a.id
  }
  const id = newAssetId()
  doc.assets[id] = { id, mime: content.mime, data: content.data, w: content.w, h: content.h }
  return id
}

/** Every asset id the document references. Wall art is the only reference
 * kind today; 0.11.0's save-preview slot must extend THIS function so GC
 * learns about it. */
export function referencedAssetIds(doc: ProjectDocument): Set<AssetId> {
  const refs = new Set<AssetId>()
  for (const f of Object.values(doc.furniture)) {
    if (f.assetId) refs.add(f.assetId)
  }
  return refs
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
