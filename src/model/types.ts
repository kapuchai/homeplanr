import type { FurnitureId, NodeId, OpeningId, RoomId, WallId } from './ids'

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

export interface Wall {
  id: WallId
  /** Undirected edge; the a→b order fixes opening `t`, hinge, and swing semantics. */
  a: NodeId
  b: NodeId
  /** m */
  thickness: number
  /** m */
  height: number
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
}

export interface ProjectSettings {
  /** m — base grid unit; display tiers and snap derive from it. */
  gridSize: number
  snapEnabled: boolean
  unitDisplay: 'm' | 'cm'
  defaultWallThickness: number
  defaultWallHeight: number
}

export interface ProjectDocument {
  schemaVersion: 1
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
}

export const SCHEMA_VERSION = 1 as const

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
} as const

export function defaultSettings(): ProjectSettings {
  return {
    gridSize: DEFAULTS.gridSize,
    snapEnabled: true,
    unitDisplay: 'm',
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
  }
}
