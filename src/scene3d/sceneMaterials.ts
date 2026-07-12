import { MeshStandardMaterial } from 'three'
import { PALETTE, SCENE_MATERIALS, WALL_PAINTS, floorSpec } from '../catalog/palette'
import type { MaterialId } from '../catalog/types'
import type { WallFinishId } from '../model/types'
import { patternTexture } from './proceduralTextures'

/** Singleton three materials — created once, shared by every mesh. */
const itemCache = new Map<MaterialId, MeshStandardMaterial>()
export function itemMaterial(id: MaterialId): MeshStandardMaterial {
  let m = itemCache.get(id)
  if (!m) {
    const spec = PALETTE[id]
    m = new MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
      ...(spec.opacity !== undefined
        ? { transparent: true, opacity: spec.opacity, depthWrite: false }
        : {}),
    })
    itemCache.set(id, m)
  }
  return m
}

const sceneCache = new Map<string, MeshStandardMaterial>()
export function sceneMaterial(id: keyof typeof SCENE_MATERIALS): MeshStandardMaterial {
  let m = sceneCache.get(id)
  if (!m) {
    const spec = SCENE_MATERIALS[id]
    m = new MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
    })
    sceneCache.set(id, m)
  }
  return m
}

const floorCache = new Map<string, MeshStandardMaterial>()
export function floorMaterial(id: string | undefined): MeshStandardMaterial {
  const spec = floorSpec(id)
  let m = floorCache.get(spec.id)
  if (!m) {
    // floor UVs are world (x, y) meters; the pattern repeat is baked in
    const map = spec.texture && patternTexture(spec.texture)
    m = new MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0,
      ...(map ? { map } : {}),
    })
    floorCache.set(spec.id, m)
  }
  return m
}

/** Face roughness per wall finish ('paint' is the absent-finish default). */
const FINISH_ROUGHNESS: Record<WallFinishId, number> = {
  paint: 0.9,
  brick: 0.95,
  concrete: 0.95,
  tile: 0.3,
}

const wallFaceCache = new Map<string, MeshStandardMaterial>()

/**
 * Wall FACE material (front/back buckets of buildWallFaceMeshData). Unknown
 * or absent paint ids fall back to the default wallPaint color; brick /
 * concrete / tile finishes overlay the matching grayscale pattern so the
 * paint tint shows through (pattern may be null where canvas is missing).
 */
export function wallFaceMaterial(
  paintId: string | undefined,
  finish: WallFinishId | undefined,
): MeshStandardMaterial {
  const f = finish ?? 'paint'
  const key = `${f}|${paintId ?? 'default'}`
  let m = wallFaceCache.get(key)
  if (!m) {
    const color =
      (paintId !== undefined && WALL_PAINTS.find((p) => p.id === paintId)?.color) ||
      SCENE_MATERIALS.wallPaint.color
    const map = f === 'paint' ? null : patternTexture(f)
    m = new MeshStandardMaterial({
      color,
      roughness: FINISH_ROUGHNESS[f],
      metalness: 0,
      ...(map ? { map } : {}),
    })
    wallFaceCache.set(key, m)
  }
  return m
}
