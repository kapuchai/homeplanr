/**
 * Catalog item schema — build3d (procedural part list) is the ONE authoring
 * source: the 3D view renders the parts and the 2D symbol is DERIVED from
 * them (symbolFromParts.ts), so the two renderers can never drift.
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
  | 'canvas'
  | 'mirror'

export type CatalogCategory =
  | 'living'
  | 'bedroom'
  | 'dining'
  | 'kitchen'
  | 'bathroom'
  | 'office'
  | 'decor'

/**
 * silhouette + body form the item's footprint layer (0.7.0): one stroke and
 * one fill prim per unique part footprint, rendered inside a single
 * flattened-opacity group — the fills cover every stroke segment interior to
 * the part union, so the strong border survives only along the union
 * boundary. outline/detail are the per-part hairlines drawn on top.
 */
export type SymbolRole = 'silhouette' | 'body' | 'outline' | 'detail'

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
  /**
   * Walk mode passes through this item (curtains, blinds — fabric yields;
   * matters for balcony-door curtains). Absent = blocks by the band
   * geometry (walk/collision.ts).
   */
  passable?: boolean
  /**
   * Placement snaps onto a window and the instance ATTACHES to it
   * (attachedOpeningId): position/rotation/width derive from the opening
   * and follow it (model/mutations/attachment.ts). Curtains.
   */
  windowAttach?: boolean
  /**
   * Initial elevation for wall-mounted items (meters above the floor) —
   * both placement paths copy it into the instance. Absent = 0 (on floor).
   */
  defaultElevation?: number
  /** Named material slots → default palette entries. */
  materials: Record<string, MaterialId>
  /**
   * Slot that displays the instance's embedded image (v6 wall art) — must
   * be a declared materials slot, and SHOULD be a single flat part so the
   * texture maps cleanly. Absent = the item takes no image.
   */
  imageSlot?: string
  /** Procedural 3D parts (see builder.ts). */
  build3d: (b: Builder, dims: Dims) => void
  /** FUTURE: presence switches the 3D renderer to a GLTF loader. */
  gltfUrl?: string
}
