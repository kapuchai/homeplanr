import type { ImageAsset } from '../../model/types'
import type { AssetContent } from '../../model/mutations/assets'

/**
 * Image ingest — the ONLY way pixels enter a document. Every upload is
 * downscaled and re-encoded here so a single .homeplanr stays portable:
 * longest edge ≤ ASSET_MAX_EDGE, encoded bytes ≤ ASSET_MAX_BYTES (quality
 * ladder, then halving the resolution before giving up). Opaque images
 * re-encode as JPEG; images with any transparency try WebP and fall back
 * to PNG (WebKit's canvas encoder may not do WebP — the mime of the
 * RESULT is checked, never assumed).
 */

export const ASSET_MAX_EDGE = 1024
export const ASSET_MAX_BYTES = 400 * 1024

/** data-URL for an asset (the one place the prefix format lives). */
export const assetDataUrl = (asset: Pick<ImageAsset, 'mime' | 'data'>): string =>
  `data:${asset.mime};base64,${asset.data}`

/** Parse a base64 data-URL; null for anything else (SVG/utf8 URLs stay out
 * of documents by construction). */
export function splitDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  return m ? { mime: m[1]!, data: m[2]! } : null
}

/** Decoded size of a base64 payload in bytes (close enough for capping). */
export const base64Bytes = (b64: string): number => Math.floor((b64.length * 3) / 4)

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })

/** Full scan — a sampled scan could miss a small transparent region and a
 * JPEG re-encode would then flatten it onto a black background. */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true
  }
  return false
}

/**
 * Decode → downscale → re-encode → cap. Returns null when the source can't
 * be decoded or won't fit the byte budget even after halving twice — the
 * caller owns the user-facing message.
 */
/**
 * Small JPEG thumb from any data-URL (recents list, 0.11.0) — one
 * downscale pass, no byte ladder (128² JPEG is a few KB by construction).
 * Null on decode/encoder failure or outside a DOM (unit env).
 */
export async function thumbDataUrl(sourceDataUrl: string, maxEdge = 128): Promise<string | null> {
  try {
    const img = await loadImage(sourceDataUrl)
    const srcW = img.naturalWidth
    const srcH = img.naturalHeight
    if (!srcW || !srcH) return null
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const out = canvas.toDataURL('image/jpeg', 0.8)
    return out.startsWith('data:image/jpeg') ? out : null
  } catch {
    return null
  }
}

export async function ingestImage(sourceDataUrl: string): Promise<AssetContent | null> {
  let img: HTMLImageElement
  try {
    img = await loadImage(sourceDataUrl)
  } catch {
    return null
  }
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  if (!srcW || !srcH) return null

  let scale = Math.min(1, ASSET_MAX_EDGE / Math.max(srcW, srcH))
  for (let attempt = 0; attempt < 3; attempt++, scale /= 2) {
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)

    const mimes = hasAlpha(ctx, w, h) ? ['image/webp', 'image/png'] : ['image/jpeg']
    for (const mime of mimes) {
      for (const quality of [0.85, 0.7]) {
        const parsed = splitDataUrl(canvas.toDataURL(mime, quality))
        if (!parsed || parsed.mime !== mime) break // encoder unsupported here
        if (base64Bytes(parsed.data) <= ASSET_MAX_BYTES) {
          return { mime: parsed.mime, data: parsed.data, w, h }
        }
        if (mime === 'image/png') break // png has no quality knob — one try
      }
    }
  }
  return null
}
