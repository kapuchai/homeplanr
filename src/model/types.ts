import type {
  AnnotationId,
  AssetId,
  FurnitureId,
  LevelId,
  NodeId,
  OpeningId,
  RoomId,
  WallId,
} from './ids'
import { newLevelId } from './ids'

/**
 * The document model — the single source of truth both renderers derive from.
 * Conventions: meters, plan space (x right, y down), radians.
 * See src/model/README.md.
 */

export interface WallNode {
  id: NodeId
  x: number
  y: number
}

/** Known finish ids (0.8.0: storage is an OPEN registry like paint —
 * these are the built-ins; unknown ids roundtrip and render as paint). */
export type WallFinishId = 'paint' | 'brick' | 'concrete' | 'tile'

export interface Wall {
  id: WallId
  /** Undirected edge; the a→b order fixes opening `t`, hinge, and swing semantics. */
  a: NodeId
  b: NodeId
  /** m */
  thickness: number
  /** m */
  height: number
  /**
   * Paint on the front face — front = the +perp(dir a→b) side, with
   * perp(v)=(−v.y,v.x) in plan y-down space: the SAME side Door.swing calls
   * 'front'. Values are WALL_PAINTS preset ids; absent = default paint.
   */
  paintFront?: string
  /** Paint on the back face (−perp side); WALL_PAINTS id, absent = default. */
  paintBack?: string
  /** Surface finish on the front (+perp) face — v5 splits the old
   * both-faces `finish` per side, mirroring paint. Open registry ids;
   * absent = plain paint. */
  finishFront?: string
  /** Surface finish on the back (−perp) face; absent = plain paint. */
  finishBack?: string
}

export interface OpeningBase {
  id: OpeningId
  wallId: WallId
  /** Center of the opening, normalized (0,1) along the a→b centerline. */
  t: number
  /** m */
  width: number
  /** m */
  height: number
  /** Opening style, open registry (v6, UI lands in 0.10.0) — any non-empty
   * string; renderers fall back to the standard style for unknown ids. */
  style?: string
}

export interface Door extends OpeningBase {
  kind: 'door'
  /** Which wall endpoint the hinge is nearer. */
  hinge: 'a' | 'b'
  /** 'front' = the +perp(dir(a→b)) side of the wall. */
  swing: 'front' | 'back'
}

export interface Window extends OpeningBase {
  kind: 'window'
  /** m above the floor. */
  sillHeight: number
}

export type Opening = Door | Window

export interface Room {
  id: RoomId
  /** Ordered outer boundary; maintained by reconcileRooms. */
  wallCycle: WallId[]
  /** Island loops punched out of the floor slab. */
  holeCycles: WallId[][]
  name?: string
  /** Key into the floor material registry; undefined = default. */
  floorMaterialId?: string
  /** Open room-type registry (v4, UI lands in 0.8.0); any non-empty string —
   * render-side fallback handles unknown values. */
  roomType?: string
  /** m the room's floor slab sits above its level's floor plane (v7 —
   * podium/loft steps; absent = 0). Level elevation stacking never reads
   * it — it is a within-level offset only. */
  floorElevation?: number
}

export interface FurnitureInstance {
  id: FurnitureId
  catalogItemId: string
  /** User label; UI placeholder is the catalog item name. */
  name?: string
  /** Footprint center, plan meters. */
  x: number
  y: number
  /** Radians. */
  rotation: number
  /** Resolved from the catalog at placement; per-instance editable. */
  size: { w: number; d: number; h: number }
  /** m above the floor (0 = on floor). */
  elevation: number
  /** Reflection across item-local x=0, applied before rotation; absent = false. */
  mirrored?: boolean
  /** Per-item price in the user's own currency (v4, UI lands in 0.9.0). */
  price?: number
  /** Free-form notes (v4, UI lands in 0.9.0). */
  notes?: string
  /** Material-slot recolors, slot → material id or hex (v4, open registry —
   * render-side fallback handles unknown values; UI lands in 0.9.0). */
  materialOverrides?: Record<string, string>
  /** Embedded image shown by image-capable items (wall art) — a doc.assets
   * key (v6). Dangling refs render as the item's placeholder, never crash. */
  assetId?: AssetId
  /** Window this item derives its placement from (v6, curtains) — while the
   * opening exists the derived layer positions the item; on opening removal
   * the commit pipeline detaches, leaving the stored transform. */
  attachedOpeningId?: OpeningId
  /** Luminous flux for light-emitting items, lm (v6, UI lands in 0.12.0). */
  lumen?: number
  /** Whether an emitter is switched on (v6, UI lands in 0.12.0). */
  lightOn?: boolean
}

/**
 * Embedded image asset (v6): ingest-time downscaled + re-encoded, stored as
 * base64 so the document stays a single portable JSON file. A new top-level
 * map (not per-instance data) so undo snapshots share it structurally.
 * Unreferenced assets are garbage-collected on explicit save.
 */
export interface ImageAsset {
  id: AssetId
  /** e.g. 'image/jpeg' — open set; decoders that can't handle it fall back. */
  mime: string
  /** Base64 payload (no data-URL prefix). */
  data: string
  /** Pixel dimensions after ingest downscaling. */
  w: number
  h: number
}

/**
 * Free world-anchored dimension (v3): deliberately NOT wall-attached — it
 * survives any wall edit, and its text is DERIVED at render from dist(a,b)
 * plus the current unit preference (never stored, so unit switches and
 * endpoint edits can't go stale).
 */
export interface DimensionAnnotation {
  id: AnnotationId
  kind: 'dimension'
  a: { x: number; y: number }
  b: { x: number; y: number }
  /** Signed offset (m) of the dimension line along +perp(a→b). */
  offset: number
}

/** Free text label (v3), world-sized so it scales with the plan. */
export interface LabelAnnotation {
  id: AnnotationId
  kind: 'label'
  x: number
  y: number
  text: string
  /** Radians; absent = 0. */
  rotation?: number
  /** Text height in meters; absent = DEFAULTS.labelFontSize. */
  fontSize?: number
}

/**
 * Traced area polygon (v4): free world-anchored like every annotation —
 * NEVER graph-healed. Its area/label text is DERIVED at render from the
 * shoelace of `points` plus the current unit preference (never stored).
 */
export interface AreaAnnotation {
  id: AnnotationId
  kind: 'area'
  /** ≥ 3 vertices, world meters; implicitly closed. */
  points: { x: number; y: number }[]
}

export type Annotation = DimensionAnnotation | LabelAnnotation | AreaAnnotation

export interface ProjectSettings {
  /** m — base grid unit; display tiers and snap derive from it. */
  gridSize: number
  defaultWallThickness: number
  defaultWallHeight: number
}

/**
 * One storey (v7). Entity records live INSIDE their level — a level is the
 * unit of 2D editing (one active level at a time) and of 3D stacking.
 * Array order in ProjectDocument.levels = stacking order, index 0 = ground.
 */
export interface Level {
  id: LevelId
  /** User label; absent = the chrome fallback ("Floor N") at render. */
  name?: string
  /** Absolute z (m) of this level's floor plane — OVERRIDE only. Absent =
   * derived by stacking (see model/levels.ts levelElevations): sum of the
   * levels below (max wall height + slab). No UI in 0.13.0; the field
   * exists so split-level never needs a schema break. */
  elevation?: number
  /** Floor-wide wall height (m) — user feedback 0.13.0: one height per
   * storey. setLevelWallHeight stores it AND re-heights every wall on the
   * level; new walls on the level default to it (else the project-wide
   * settings default). Walls still CARRY height individually (renderers/
   * solids read the wall), this is the storey's authoritative setting. */
  wallHeight?: number
  nodes: Record<NodeId, WallNode>
  walls: Record<WallId, Wall>
  openings: Record<OpeningId, Opening>
  rooms: Record<RoomId, Room>
  furniture: Record<FurnitureId, FurnitureInstance>
  annotations: Record<AnnotationId, Annotation>
}

/**
 * The single-level working view (v7) — the shape every entity mutation,
 * getDerived, hit-testing, snapping, and the 2D renderer operate on. Its
 * entity maps ALIAS one Level's maps; `assets` and `settings` alias the
 * document's top-level fields (walls read default thickness/height,
 * wall art writes assets). Views are plain wrappers: writes go THROUGH
 * the aliased maps (immer drafts in mutations), never onto the view's own
 * properties — the doc-scoped fields (name, preview, notes, levels) are
 * deliberately absent so a level-scoped mutation CANNOT touch them.
 */
export interface LevelDoc {
  /** The wrapped level's id — memo/cache key for per-level derived state. */
  levelId: LevelId
  /** The level's floor-wide wall height (READ-ONLY through the view — a
   * scalar cannot write through; setLevelWallHeight is doc-scoped). */
  wallHeight?: number
  settings: ProjectSettings
  nodes: Record<NodeId, WallNode>
  walls: Record<WallId, Wall>
  openings: Record<OpeningId, Opening>
  rooms: Record<RoomId, Room>
  furniture: Record<FurnitureId, FurnitureInstance>
  annotations: Record<AnnotationId, Annotation>
  assets: Record<AssetId, ImageAsset>
}

export interface ProjectDocument {
  schemaVersion: 7
  id: string
  name: string
  /** ISO strings. Mutations never touch updatedAt — serialize() stamps it. */
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  /** Storeys, ground first (v7). Never empty — the validator mints one. */
  levels: Level[]
  /** Embedded image assets (v6) — inert leaf data, excluded from graph
   * self-heal; SHARED across levels (referenced by
   * FurnitureInstance.assetId on any level and previewAssetId). */
  assets: Record<AssetId, ImageAsset>
  /** Save-preview image (0.11.0, additive on v6). Without previewCustom
   * the preview is AUTO: regenerated into the write-time clone at every
   * save (the store doc never carries it until a file round-trips).
   * With previewCustom it is the user's uploaded override — a real,
   * undoable part of the document. referencedAssetIds counts this field,
   * so GC keeps the asset; dangling ids are kept like furniture art. */
  previewAssetId?: AssetId
  previewCustom?: true
  /** Free-form project notes (pulled forward from 0.15.0; additive on v7). */
  notes?: string
}

export const SCHEMA_VERSION = 7 as const

/** Pinned defaults (plan: "DEFAULTS"). All meters. */
export const DEFAULTS = {
  wallThickness: 0.15,
  wallHeight: 2.5,
  door: { width: 0.9, height: 2.0, hinge: 'a' as const },
  window: { width: 1.2, height: 1.2, sillHeight: 0.9 },
  gridSize: 0.1,
  /** Openings must clear wall ends by this much inside the straight core. */
  openingCoreMargin: 0.01,
  /** Vertical clearance an opening keeps below the wall top. */
  openingHeadroom: 0.02,
  /** Minimum window height after clamping; shorter windows are deleted. */
  minWindowHeight: 0.3,
  /** Walls shorter than this are rejected/merged away. */
  minWallLength: 0.01,
  /** Default world height (m) of a label annotation's text. */
  labelFontSize: 0.15,
  /** Dimension-line offset clamp (m) — validator bound, ± this. */
  maxDimensionOffset: 20,
} as const

export function defaultSettings(): ProjectSettings {
  return {
    gridSize: DEFAULTS.gridSize,
    defaultWallThickness: DEFAULTS.wallThickness,
    defaultWallHeight: DEFAULTS.wallHeight,
  }
}

export function emptyLevel(id: LevelId = newLevelId()): Level {
  return {
    id,
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    furniture: {},
    annotations: {},
  }
}

export function emptyDocument(id: string, name: string, nowIso: string): ProjectDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    settings: defaultSettings(),
    levels: [emptyLevel()],
    assets: {},
  }
}
