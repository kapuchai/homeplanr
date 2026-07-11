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
}

/** Scene-level materials (not per-item slots). */
export const SCENE_MATERIALS = {
  wallPaint: { color: '#f5f3ee', roughness: 0.9, metalness: 0 },
  woodFloor: { color: '#d3b891', roughness: 0.55, metalness: 0 },
  ceramicFloor: { color: '#e8e8e4', roughness: 0.25, metalness: 0 },
  darkFloor: { color: '#8a6a48', roughness: 0.55, metalness: 0 },
  carpetFloor: { color: '#b8b2a4', roughness: 1.0, metalness: 0 },
  ground: { color: '#dcdcd8', roughness: 1.0, metalness: 0 },
} as const

export type FloorMaterialId = 'woodFloor' | 'ceramicFloor' | 'darkFloor' | 'carpetFloor'
export const FLOOR_MATERIALS: FloorMaterialId[] = [
  'woodFloor',
  'ceramicFloor',
  'darkFloor',
  'carpetFloor',
]
