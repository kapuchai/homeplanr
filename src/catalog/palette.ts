import type { MaterialId } from './types'

/**
 * Shared material palette — few, coherent materials (≤2 shader programs:
 * opaque + transparent glass). Pure data here; three.js singletons are
 * created once in scene3d/sceneMaterials.ts.
 */
export interface MaterialSpec {
  color: string
  roughness: number
  metalness: number
  /** Transparent materials (glass). */
  opacity?: number
}

export const PALETTE: Record<MaterialId, MaterialSpec> = {
  fabricGray: { color: '#9096a0', roughness: 0.95, metalness: 0 },
  fabricBeige: { color: '#cfc4b2', roughness: 0.95, metalness: 0 },
  linen: { color: '#eceae4', roughness: 0.9, metalness: 0 },
  leather: { color: '#8a5a3b', roughness: 0.6, metalness: 0 },
  woodLight: { color: '#c8a878', roughness: 0.7, metalness: 0 },
  woodDark: { color: '#7a5638', roughness: 0.65, metalness: 0 },
  whiteLacquer: { color: '#f2f2ef', roughness: 0.35, metalness: 0 },
  metal: { color: '#a8adb5', roughness: 0.4, metalness: 0.85 },
  metalDark: { color: '#3f4247', roughness: 0.5, metalness: 0.8 },
  ceramic: { color: '#f7f8f7', roughness: 0.12, metalness: 0 },
  glass: { color: '#cfe4ee', roughness: 0.08, metalness: 0, opacity: 0.35 },
  screenBlack: { color: '#14161a', roughness: 0.3, metalness: 0 },
  foliage: { color: '#6b8f5f', roughness: 0.95, metalness: 0 },
}

/** Scene-level materials (not per-item slots). */
export const SCENE_MATERIALS = {
  wallPaint: { color: '#f5f3ee', roughness: 0.9, metalness: 0 },
  ground: { color: '#dcdcd8', roughness: 1.0, metalness: 0 },
} as const

/** Floor registry — the single source; sceneMaterials/PropertiesPanel/2D tint all read this. */
export type FloorTextureKind = 'plank' | 'tile' | 'stone' | null
export interface FloorSpec {
  id: string
  name: string
  color: string
  roughness: number
  texture: FloorTextureKind
}
// The first four ids predate v0.2.0 and are referenced by existing documents — never rename.
export const FLOOR_MATERIALS: readonly FloorSpec[] = [
  { id: 'woodFloor', name: 'Wood', color: '#d3b891', roughness: 0.55, texture: 'plank' },
  { id: 'parquetLight', name: 'Light parquet', color: '#e0c9a2', roughness: 0.5, texture: 'plank' },
  { id: 'laminateGray', name: 'Gray laminate', color: '#b9b0a4', roughness: 0.45, texture: 'plank' },
  { id: 'darkFloor', name: 'Dark wood', color: '#8a6a48', roughness: 0.55, texture: 'plank' },
  { id: 'ceramicFloor', name: 'White tile', color: '#e8e8e4', roughness: 0.25, texture: 'tile' },
  { id: 'tileGray', name: 'Gray tile', color: '#c9c9c4', roughness: 0.25, texture: 'tile' },
  { id: 'terracotta', name: 'Terracotta', color: '#c07a56', roughness: 0.6, texture: 'tile' },
  { id: 'marble', name: 'Marble', color: '#e9e7e2', roughness: 0.15, texture: 'stone' },
  { id: 'stoneGray', name: 'Stone', color: '#a8a49c', roughness: 0.7, texture: 'stone' },
  { id: 'concrete', name: 'Concrete', color: '#b5b3ae', roughness: 0.85, texture: null },
  { id: 'carpetFloor', name: 'Carpet', color: '#b8b2a4', roughness: 1.0, texture: null },
]

export const FLOOR_IDS: ReadonlySet<string> = new Set(FLOOR_MATERIALS.map((f) => f.id))

/** Unknown/absent ids fall back to the default wood floor (render-side leniency). */
export function floorSpec(id: string | undefined): FloorSpec {
  return (id !== undefined && FLOOR_MATERIALS.find((f) => f.id === id)) || FLOOR_MATERIALS[0]!
}

/** Per-side wall paint presets (Wall.paintFront/paintBack reference these ids). */
export const WALL_PAINTS: readonly { id: string; name: string; color: string }[] = [
  { id: 'white', name: 'White', color: '#f5f3ee' },
  { id: 'warmWhite', name: 'Warm white', color: '#f3ede1' },
  { id: 'cream', name: 'Cream', color: '#efe6d0' },
  { id: 'lightGray', name: 'Light gray', color: '#dcdcd8' },
  { id: 'greige', name: 'Greige', color: '#cfc8bc' },
  { id: 'sand', name: 'Sand', color: '#e3cfa8' },
  { id: 'blush', name: 'Blush', color: '#e8cfc4' },
  { id: 'sage', name: 'Sage', color: '#c3cfb8' },
  { id: 'olive', name: 'Olive', color: '#7d8468' },
  { id: 'paleBlue', name: 'Pale blue', color: '#c5d5e0' },
  { id: 'denim', name: 'Denim', color: '#5b7590' },
  { id: 'terracotta', name: 'Terracotta', color: '#c07a56' },
  { id: 'charcoal', name: 'Charcoal', color: '#4a4d52' },
  { id: 'deepNavy', name: 'Deep navy', color: '#33415c' },
]

export const WALL_PAINT_IDS: ReadonlySet<string> = new Set(WALL_PAINTS.map((p) => p.id))
