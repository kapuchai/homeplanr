import { MeshStandardMaterial } from 'three'
import { PALETTE, SCENE_MATERIALS, type FloorMaterialId } from '../catalog/palette'
import type { MaterialId } from '../catalog/types'

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

export function floorMaterial(id: string | undefined): MeshStandardMaterial {
  const valid: FloorMaterialId[] = ['woodFloor', 'ceramicFloor', 'darkFloor', 'carpetFloor']
  return sceneMaterial(valid.includes(id as FloorMaterialId) ? (id as FloorMaterialId) : 'woodFloor')
}
