import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { MeshStandardMaterial, SRGBColorSpace, Texture } from 'three'
import type { ImageAsset } from '../model/types'
import type { AssetId } from '../model/ids'
import { assetDataUrl } from '../store/persistence/imageIngest'
import { PALETTE } from '../catalog/palette'

/**
 * Per-asset art materials (v6 wall art). One material+texture per asset id,
 * REFCOUNTED by the consuming meshes and disposed when the last one
 * unmounts — this is the only textured-material path that follows user
 * data, so unlike the palette singletons it must not cache forever.
 * Assets are immutable after ingest, so an entry can never go stale.
 */
interface Entry {
  material: MeshStandardMaterial
  texture: Texture | null
  refs: number
}

const cache = new Map<AssetId, Entry>()

/** Object-fit: cover — fraction of the source shown, centered. */
export function coverTransform(
  assetW: number,
  assetH: number,
  faceW: number,
  faceH: number,
): { repeatX: number; repeatY: number; offsetX: number; offsetY: number } {
  const assetAspect = assetW / assetH
  const faceAspect = faceW / faceH
  if (assetAspect > faceAspect) {
    const repeatX = faceAspect / assetAspect
    return { repeatX, repeatY: 1, offsetX: (1 - repeatX) / 2, offsetY: 0 }
  }
  const repeatY = assetAspect / faceAspect
  return { repeatX: 1, repeatY, offsetX: 0, offsetY: (1 - repeatY) / 2 }
}

function acquire(asset: ImageAsset, face: { w: number; h: number }, onLoad: () => void): Entry {
  let entry = cache.get(asset.id)
  if (entry) {
    entry.refs++
    return entry
  }
  const spec = PALETTE.canvas
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: spec.roughness,
    metalness: spec.metalness,
  })
  const created: Entry = { material, texture: null, refs: 1 }
  cache.set(asset.id, created)
  const img = new Image()
  img.onload = () => {
    // the entry may have been released while the image decoded
    const live = cache.get(asset.id)
    if (live !== created) return
    const texture = new Texture(img)
    texture.colorSpace = SRGBColorSpace
    texture.needsUpdate = true
    const t = coverTransform(asset.w, asset.h, face.w, face.h)
    texture.repeat.set(t.repeatX, t.repeatY)
    texture.offset.set(t.offsetX, t.offsetY)
    created.texture = texture
    material.map = texture
    material.needsUpdate = true
    onLoad()
  }
  img.onerror = () => {
    // undecodable data (hand-edited file): stay on the white placeholder
  }
  img.src = assetDataUrl(asset)
  return created
}

function release(id: AssetId): void {
  const entry = cache.get(id)
  if (!entry || --entry.refs > 0) return
  cache.delete(id)
  entry.texture?.dispose()
  entry.material.dispose()
}

/**
 * Material showing `asset`, or null while unset (callers fall back to the
 * item's placeholder palette material). `face` is the item-local w×h of the
 * image slab, for the cover crop.
 */
export function useArtMaterial(
  asset: ImageAsset | undefined,
  face: { w: number; h: number },
): MeshStandardMaterial | null {
  const invalidate = useThree((s) => s.invalidate)
  const [material, setMaterial] = useState<MeshStandardMaterial | null>(null)
  const id = asset?.id
  useEffect(() => {
    if (!asset) {
      setMaterial(null)
      return
    }
    const entry = acquire(asset, face, invalidate)
    setMaterial(entry.material)
    return () => {
      release(asset.id)
      setMaterial(null)
    }
    // face derives from the catalog item (stable per item id); asset is
    // immutable per id — the id is the one real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, invalidate])
  return material
}

/** Test hook — the cache is module state. */
export const artCacheSizeForTests = (): number => cache.size
