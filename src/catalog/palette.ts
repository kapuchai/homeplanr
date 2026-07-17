import type { MaterialId } from './types'
import type { PatternKind } from '../scene3d/proceduralTextures'

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
  // v6 wall-art print surface; per-instance images replace it at render
  canvas: { color: '#e9e4d8', roughness: 0.95, metalness: 0 },
  // fully metallic + near-smooth: the RoomEnvironment IBL gives the shine
  // (no real reflections — accepted)
  mirror: { color: '#e8f0f2', roughness: 0.06, metalness: 1 },
}

/**
 * Pure-white base under image-mapped materials (the texture multiplies the
 * base color — any tint would tint the artwork). Lives here so consumers
 * outside the allowed raw-color dirs stay hex-free (lint:colors).
 */
export const TEXTURE_BASE_WHITE = '#ffffff'

/** Scene-level materials (not per-item slots). */
export const SCENE_MATERIALS = {
  wallPaint: { color: '#f5f3ee', roughness: 0.9, metalness: 0 },
  ground: { color: '#dcdcd8', roughness: 1.0, metalness: 0 },
} as const

/** Floor registry — the single source; sceneMaterials/PropertiesPanel/2D tint all read this. */
export type FloorTextureKind = 'plank' | 'tile' | 'stone' | 'herringbone' | 'plaster' | null
export type FloorGroupId = 'wood' | 'tile' | 'stone' | 'smooth'
export interface FloorSpec {
  id: string
  name: string
  color: string
  roughness: number
  texture: FloorTextureKind
  /** Picker section (0.8.0 grouped picker). */
  group: FloorGroupId
}

/** Picker section order + display names (raw, catalog convention). */
export const FLOOR_GROUPS: readonly { id: FloorGroupId; name: string }[] = [
  { id: 'wood', name: 'Wood' },
  { id: 'tile', name: 'Tile' },
  { id: 'stone', name: 'Stone' },
  { id: 'smooth', name: 'Smooth & soft' },
]

// The first four ids predate v0.2.0 and are referenced by existing documents — never rename.
export const FLOOR_MATERIALS: readonly FloorSpec[] = [
  { id: 'woodFloor', name: 'Wood', color: '#d3b891', roughness: 0.55, texture: 'plank', group: 'wood' },
  { id: 'parquetLight', name: 'Light parquet', color: '#e0c9a2', roughness: 0.5, texture: 'plank', group: 'wood' },
  { id: 'parquetHerringbone', name: 'Herringbone parquet', color: '#cdb088', roughness: 0.5, texture: 'herringbone', group: 'wood' },
  { id: 'laminateGray', name: 'Gray laminate', color: '#b9b0a4', roughness: 0.45, texture: 'plank', group: 'wood' },
  { id: 'laminateOak', name: 'Oak laminate', color: '#d9bd93', roughness: 0.45, texture: 'plank', group: 'wood' },
  { id: 'laminateWalnut', name: 'Walnut laminate', color: '#9a7454', roughness: 0.45, texture: 'plank', group: 'wood' },
  { id: 'darkFloor', name: 'Dark wood', color: '#8a6a48', roughness: 0.55, texture: 'plank', group: 'wood' },
  { id: 'ceramicFloor', name: 'White tile', color: '#e8e8e4', roughness: 0.25, texture: 'tile', group: 'tile' },
  { id: 'tileGray', name: 'Gray tile', color: '#c9c9c4', roughness: 0.25, texture: 'tile', group: 'tile' },
  { id: 'terracotta', name: 'Terracotta', color: '#c07a56', roughness: 0.6, texture: 'tile', group: 'tile' },
  { id: 'marble', name: 'Marble', color: '#e9e7e2', roughness: 0.15, texture: 'stone', group: 'stone' },
  { id: 'stoneGray', name: 'Stone', color: '#a8a49c', roughness: 0.7, texture: 'stone', group: 'stone' },
  { id: 'concrete', name: 'Concrete', color: '#b5b3ae', roughness: 0.85, texture: null, group: 'smooth' },
  { id: 'plasterFloor', name: 'Plaster', color: '#ded8cc', roughness: 0.8, texture: 'plaster', group: 'smooth' },
  { id: 'linoleumBeige', name: 'Beige linoleum', color: '#d6c9a8', roughness: 0.35, texture: null, group: 'smooth' },
  { id: 'linoleumGray', name: 'Gray linoleum', color: '#b3b6b3', roughness: 0.35, texture: null, group: 'smooth' },
  { id: 'carpetFloor', name: 'Carpet', color: '#b8b2a4', roughness: 1.0, texture: null, group: 'smooth' },
]

export const FLOOR_IDS: ReadonlySet<string> = new Set(FLOOR_MATERIALS.map((f) => f.id))

/** Unknown/absent ids fall back to the default wood floor (render-side leniency). */
export function floorSpec(id: string | undefined): FloorSpec {
  return (id !== undefined && FLOOR_MATERIALS.find((f) => f.id === id)) || FLOOR_MATERIALS[0]!
}

/**
 * Wall finish registry (0.8.0) — Wall.finishFront/finishBack reference
 * these ids. OPEN registry: unknown ids in documents are preserved by the
 * validator and render as plain paint. In 3D a finish overlays its
 * grayscale pattern (tinted by the wall paint); `swatch` is the UI
 * preview color only. First three ids predate v5 — never rename.
 */
export interface FinishSpec {
  id: string
  name: string
  pattern: PatternKind
  roughness: number
  swatch: string
}

export const WALL_FINISHES: readonly FinishSpec[] = [
  { id: 'brick', name: 'Brick', pattern: 'brick', roughness: 0.95, swatch: '#b56a4f' },
  { id: 'concrete', name: 'Concrete', pattern: 'concrete', roughness: 0.95, swatch: '#b5b3ae' },
  { id: 'tile', name: 'Tile', pattern: 'tile', roughness: 0.3, swatch: '#dfe3e2' },
  { id: 'wallpaperStripe', name: 'Wallpaper, stripes', pattern: 'wallpaperStripe', roughness: 0.85, swatch: '#d9d2c6' },
  { id: 'wallpaperDamask', name: 'Wallpaper, damask', pattern: 'wallpaperDamask', roughness: 0.85, swatch: '#cfc6d4' },
  { id: 'panel', name: 'Wood panel', pattern: 'panel', roughness: 0.7, swatch: '#c8a878' },
  { id: 'plaster', name: 'Plaster', pattern: 'plaster', roughness: 0.9, swatch: '#e3ded4' },
]

export const WALL_FINISH_IDS: ReadonlySet<string> = new Set(WALL_FINISHES.map((f) => f.id))

/** Known finish → its spec; unknown/absent → null = plain paint (the
 * render-side fallback the open registry relies on). */
export function finishSpec(id: string | undefined): FinishSpec | null {
  return (id !== undefined && WALL_FINISHES.find((f) => f.id === id)) || null
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
