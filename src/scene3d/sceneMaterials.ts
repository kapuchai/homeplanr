import { MeshStandardMaterial } from 'three'
import { PALETTE, SCENE_MATERIALS, WALL_PAINTS, finishSpec, floorSpec } from '../catalog/palette'
import type { MaterialId } from '../catalog/types'
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

/**
 * Per-slot furniture material with an optional instance override (v6
 * coloring UI): a PALETTE id swaps the whole material; a hex recolors the
 * slot's DEFAULT material (its roughness/metalness survive, so a recolored
 * sofa still reads as fabric). Unknown values fall back to the default —
 * open-registry rule, junk arrives from forward-compatible files. Color
 * variants share the base shader program (color is a uniform), so the
 * palette's few-programs invariant holds; the cache follows the
 * wallFaceMaterial precedent (keyed, kept for the app lifetime).
 */
const overrideCache = new Map<string, MeshStandardMaterial>()
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
export function furnitureSlotMaterial(
  defaultId: MaterialId,
  override: string | undefined,
): MeshStandardMaterial {
  if (!override || override === defaultId) return itemMaterial(defaultId)
  if (override in PALETTE) return itemMaterial(override as MaterialId)
  if (!HEX_RE.test(override)) return itemMaterial(defaultId)
  const key = `${defaultId}|${override.toLowerCase()}`
  let m = overrideCache.get(key)
  if (!m) {
    const spec = PALETTE[defaultId]
    m = new MeshStandardMaterial({
      color: override,
      roughness: spec.roughness,
      metalness: spec.metalness,
      ...(spec.opacity !== undefined
        ? { transparent: true, opacity: spec.opacity, depthWrite: false }
        : {}),
    })
    overrideCache.set(key, m)
  }
  return m
}

/**
 * Lit-emitter slot variant (0.12.0): the furnitureSlotMaterial resolve
 * rules (default / palette swap / hex recolor) plus an emissive uniform so
 * the shade/bulb part GLOWS while the instance's light is on. Emissive is
 * a uniform on the same standard shader — the few-programs invariant
 * holds. Cache keyed (default|override|emissive), kept for the app
 * lifetime like every other slot cache.
 */
const emissiveCache = new Map<string, MeshStandardMaterial>()
export function emissiveSlotMaterial(
  defaultId: MaterialId,
  override: string | undefined,
  emissive: string,
): MeshStandardMaterial {
  const base = furnitureSlotMaterial(defaultId, override)
  const key = `${defaultId}|${override ?? ''}|${emissive}`
  let m = emissiveCache.get(key)
  if (!m) {
    m = base.clone()
    m.emissive.set(emissive)
    m.emissiveIntensity = 0.7
    emissiveCache.set(key, m)
  }
  return m
}

/**
 * Shadow-only stand-in (0.12.0): occluder-hidden walls under realistic
 * lighting keep CASTING — else the sun floods the dollhouse view from the
 * hidden side (user report). Visible mesh, zero color/depth writes, so it
 * draws nothing and occludes nothing but still renders into shadow maps.
 * ONE shared singleton — the no-per-wall-material-clones rule holds.
 */
let shadowOnly: MeshStandardMaterial | null = null
export function shadowOnlyMaterial(): MeshStandardMaterial {
  if (!shadowOnly) {
    shadowOnly = new MeshStandardMaterial()
    shadowOnly.colorWrite = false
    shadowOnly.depthWrite = false
  }
  return shadowOnly
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

const wallFaceCache = new Map<string, MeshStandardMaterial>()

/**
 * Wall FACE material (front/back buckets of buildWallFaceMeshData). Unknown
 * or absent paint ids fall back to the default wallPaint color; a known
 * finish overlays its grayscale pattern so the paint tint shows through
 * (pattern may be null where canvas is missing). Finish ids are an OPEN
 * registry (v5): finishSpec returns null for unknown ids, which render as
 * plain paint — never index pattern tables with an unknown key.
 */
export function wallFaceMaterial(
  paintId: string | undefined,
  finishId: string | undefined,
): MeshStandardMaterial {
  const spec = finishSpec(finishId)
  const key = `${spec?.id ?? 'paint'}|${paintId ?? 'default'}`
  let m = wallFaceCache.get(key)
  if (!m) {
    const color =
      (paintId !== undefined && WALL_PAINTS.find((p) => p.id === paintId)?.color) ||
      SCENE_MATERIALS.wallPaint.color
    const map = spec ? patternTexture(spec.pattern) : null
    m = new MeshStandardMaterial({
      color,
      roughness: spec?.roughness ?? SCENE_MATERIALS.wallPaint.roughness,
      metalness: 0,
      ...(map ? { map } : {}),
    })
    wallFaceCache.set(key, m)
  }
  return m
}
