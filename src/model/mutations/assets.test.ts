import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../types'
import type { AssetId, OpeningId } from '../ids'
import { addAsset, gcAssets, referencedAssetIds, type AssetContent } from './assets'
import {
  addFurniture,
  duplicateFurniture,
  setFurnitureAsset,
  type AddFurnitureParams,
} from './furniture'
import { buildPayload, materializeItems } from '../../editor2d/clipboard'
import { getDerived } from '../../store/derived'
import { splitDataUrl, assetDataUrl, base64Bytes } from '../../store/persistence/imageIngest'

const STAMP = '2026-07-17T00:00:00.000Z'
const doc = () => emptyDocument('p_assets_test', 'Assets test', STAMP)

const JPEG: AssetContent = { mime: 'image/jpeg', data: 'aGVsbG8=', w: 640, h: 480 }
const PNG: AssetContent = { mime: 'image/png', data: 'd29ybGQ=', w: 32, h: 32 }

const item = (over: Partial<AddFurnitureParams> = {}): AddFurnitureParams => ({
  catalogItemId: 'tv-wall',
  x: 1,
  y: 1,
  size: { w: 1.25, d: 0.2, h: 0.75 },
  ...over,
})

describe('addAsset', () => {
  it('mints an id, stores the content, and content-dedupes re-adds', () => {
    const d = doc()
    const a = addAsset(d, JPEG)
    expect(d.assets[a]).toEqual({ id: a, ...JPEG })
    expect(addAsset(d, JPEG)).toBe(a) // identical bytes → same id
    expect(addAsset(d, PNG)).not.toBe(a)
    expect(Object.keys(d.assets)).toHaveLength(2)
  })

  it('same bytes under a different mime is a different asset', () => {
    const d = doc()
    const a = addAsset(d, JPEG)
    expect(addAsset(d, { ...JPEG, mime: 'image/png' })).not.toBe(a)
  })
})

describe('setFurnitureAsset', () => {
  it('sets and clears; absent stays absent (files stay clean)', () => {
    const d = doc()
    const fid = addFurniture(d, item())
    const a = addAsset(d, JPEG)
    setFurnitureAsset(d, fid, a)
    expect(d.furniture[fid]!.assetId).toBe(a)
    setFurnitureAsset(d, fid, undefined)
    expect('assetId' in d.furniture[fid]!).toBe(false)
  })
})

describe('addFurniture with asset content (paste path)', () => {
  it('ingests the content and points the instance at it, deduped', () => {
    const d = doc()
    const f1 = addFurniture(d, item({ asset: JPEG }))
    const f2 = addFurniture(d, item({ asset: JPEG }))
    const a1 = d.furniture[f1]!.assetId!
    expect(d.assets[a1]).toBeDefined()
    expect(d.furniture[f2]!.assetId).toBe(a1) // dedupe across two pastes
    expect(Object.keys(d.assets)).toHaveLength(1)
  })
})

describe('gcAssets', () => {
  it('is identity when there are no assets or all are referenced', () => {
    const d = doc()
    expect(gcAssets(d)).toBe(d)
    const fid = addFurniture(d, item())
    setFurnitureAsset(d, fid, addAsset(d, JPEG))
    expect(gcAssets(d)).toBe(d)
  })

  it('drops orphans in a COPY, never touching the input', () => {
    const d = doc()
    const fid = addFurniture(d, item())
    const kept = addAsset(d, JPEG)
    setFurnitureAsset(d, fid, kept)
    const orphan = addAsset(d, PNG)
    const out = gcAssets(d)
    expect(out).not.toBe(d)
    expect(Object.keys(out.assets)).toEqual([kept])
    // purity: the in-memory doc keeps the orphan (undo may resurrect it)
    expect(d.assets[orphan]).toBeDefined()
    expect(out.furniture).toBe(d.furniture) // shallow copy — collections shared
  })

  it('referencedAssetIds sees furniture refs only for present fields', () => {
    const d = doc()
    addFurniture(d, item())
    expect(referencedAssetIds(d).size).toBe(0)
  })

  it('previewAssetId (0.11.0) is a reference — gc keeps the preview asset', () => {
    const d = doc()
    const preview = addAsset(d, JPEG)
    d.previewAssetId = preview
    const orphan = addAsset(d, PNG)
    const out = gcAssets(d)
    expect(referencedAssetIds(d).has(preview)).toBe(true)
    expect(Object.keys(out.assets)).toEqual([preview])
    expect(d.assets[orphan]).toBeDefined() // input untouched
  })
})

describe('duplicateFurniture (v6 fields)', () => {
  it('shares assetId, strips attachedOpeningId', () => {
    const d = doc()
    const fid = addFurniture(d, item({ asset: JPEG }))
    d.furniture[fid]!.attachedOpeningId = 'o_win1' as OpeningId
    const [nid] = duplicateFurniture(d, [fid])
    const dup = d.furniture[nid!]!
    expect(dup.assetId).toBe(d.furniture[fid]!.assetId) // same doc — sharing is right
    expect('attachedOpeningId' in dup).toBe(false)
  })
})

describe('clipboard asset carry', () => {
  it('copies CONTENT, and a cross-document paste re-ingests it', () => {
    const src = doc()
    const fid = addFurniture(src, item({ asset: JPEG }))
    const payload = buildPayload(src, getDerived(src), [fid])!
    expect(payload.items[0]!.asset).toEqual(JPEG)

    const dst = doc() // a fresh document that never saw the asset
    dst.id = 'p_assets_dst'
    const params = materializeItems(payload, { x: 5, y: 5 })
    const [pid] = params.map((p) => addFurniture(dst, p))
    const aid = dst.furniture[pid!]!.assetId!
    expect(dst.assets[aid]).toEqual({ id: aid, ...JPEG })
  })

  it('items without an image copy without an asset field', () => {
    const src = doc()
    const fid = addFurniture(src, item())
    const payload = buildPayload(src, getDerived(src), [fid])!
    expect('asset' in payload.items[0]!).toBe(false)
  })

  it('a dangling assetId copies as no asset (content is gone)', () => {
    const src = doc()
    const fid = addFurniture(src, item())
    src.furniture[fid]!.assetId = 'i_gone' as AssetId
    const payload = buildPayload(src, getDerived(src), [fid])!
    expect('asset' in payload.items[0]!).toBe(false)
  })
})

describe('imageIngest pure helpers', () => {
  it('splitDataUrl round-trips assetDataUrl and rejects junk', () => {
    const url = assetDataUrl(JPEG)
    expect(splitDataUrl(url)).toEqual({ mime: 'image/jpeg', data: JPEG.data })
    expect(splitDataUrl('data:image/svg+xml;utf8,<svg/>')).toBeNull()
    expect(splitDataUrl('http://example.com/x.png')).toBeNull()
    expect(splitDataUrl('data:;base64,')).toBeNull()
  })

  it('base64Bytes approximates decoded size', () => {
    expect(base64Bytes('aGVsbG8=')).toBe(6) // "hello" + pad ≈ 6
    expect(base64Bytes('')).toBe(0)
  })
})
