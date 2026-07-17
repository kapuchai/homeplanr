import type { AnnotationId, FurnitureId, NodeId, OpeningId, RoomId, WallId } from './ids'

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

export interface ProjectDocument {
  schemaVersion: 5
  id: string
  name: string
  /** ISO strings. Mutations never touch updatedAt — serialize() stamps it. */
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  nodes: Record<NodeId, WallNode>
  walls: Record<WallId, Wall>
  openings: Record<OpeningId, Opening>
  rooms: Record<RoomId, Room>
  furniture: Record<FurnitureId, FurnitureInstance>
  annotations: Record<AnnotationId, Annotation>
}

export const SCHEMA_VERSION = 5 as const

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

export function emptyDocument(id: string, name: string, nowIso: string): ProjectDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    settings: defaultSettings(),
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    furniture: {},
    annotations: {},
  }
}
