/**
 * Catalog item schema — one definition carries BOTH renderers:
 * symbol2d (declarative SVG prims for the 2D editor) and build3d (procedural
 * part list for the 3D view) live side by side so they can never drift.
 *
 * Item-local frame (pinned, see src/model/README.md): origin at footprint
 * center, z = 0 at floor, FRONT faces −y. dims are meters.
 */
import type { Builder } from './builder'

export type MaterialId =
  | 'fabricGray'
  | 'fabricBeige'
  | 'linen'
  | 'leather'
  | 'woodLight'
  | 'woodDark'
  | 'whiteLacquer'
  | 'metal'
  | 'metalDark'
  | 'ceramic'
  | 'glass'
  | 'screenBlack'
  | 'foliage'

export type CatalogCategory =
  | 'living'
  | 'bedroom'
  | 'dining'
  | 'kitchen'
  | 'bathroom'
  | 'office'

export type SymbolRole = 'body' | 'outline' | 'detail'

/** Declarative top-view symbol primitives, item-local meters. */
export type SymbolPrim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number; role: SymbolRole }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; role: SymbolRole }
  | { kind: 'circle'; cx: number; cy: number; r: number; role: SymbolRole }
  | { kind: 'path'; d: string; role: SymbolRole }

export interface Dims {
  w: number
  d: number
  h: number
}

export interface CatalogItem {
  id: string
  name: string
  category: CatalogCategory
  /** Default size, meters — copied onto the instance at placement. */
  dims: Dims
  /** Back-against-wall capture + auto-rotate applies to this item. */
  wallSnap: boolean
  /** Named material slots → default palette entries. */
  materials: Record<string, MaterialId>
  /**
   * @deprecated Top-view symbols are DERIVED from build3d parts
   * (symbolFromParts.ts) since the M6 gate — hand symbols drifted from the
   * 3D look. This field is ignored by all renderers and kept only until the
   * item files drop their legacy data.
   */
  symbol2d: SymbolPrim[]
  /** Procedural 3D parts (see builder.ts). */
  build3d: (b: Builder, dims: Dims) => void
  /** FUTURE: presence switches the 3D renderer to a GLTF loader. */
  gltfUrl?: string
}
