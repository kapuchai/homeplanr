import { DEFAULTS, type ProjectDocument } from '../../model/types'
import type { AnnotationId, FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../../model/ids'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'
import { dist, sub } from '../../geometry/vec'
import { distToSegment, segSegIntersection } from '../../geometry/segment'
import {
  area,
  centroid,
  pointInOBB,
  pointInPolygon,
  pointInPolygonWithHoles,
} from '../../geometry/polygon'

/**
 * Geometric hit-testing (never DOM-based). Priority order (plan-pinned):
 * annotations (topmost render layer) > openings > furniture (smallest
 * footprint wins among overlaps) > nodes (only those offered by the caller
 * — selection context) > walls > rooms. Manipulation handles are tested by
 * the select tool itself (M3) before calling this. Tolerances are screen
 * px, converted via pxToWorld.
 */
export type EntityRef =
  | { kind: 'annotation'; id: AnnotationId }
  | { kind: 'opening'; id: OpeningId }
  | { kind: 'furniture'; id: FurnitureId }
  | { kind: 'node'; id: NodeId }
  | { kind: 'wall'; id: WallId }
  | { kind: 'room'; id: RoomId }

export interface HitOptions {
  /** Nodes eligible for hitting (plan: only when self/neighbor selected). */
  nodeCandidates?: ReadonlySet<NodeId>
  /** The showAnnotations toggle (0.7.0): pass false when the annotations
   * layer is hidden so hidden annotations never steal clicks/marquees —
   * the same visibility-parity rule as the zoom culls below. */
  annotationsVisible?: boolean
}

const ANNOTATION_TOLERANCE_PX = 5
/** Rough half-extent of the centroid area pill — a coarse click target. */
const AREA_PILL_RADIUS_PX = 20
/** Visibility floors, shared with AnnotationsLayer: what the layer culls at
 * the current zoom must not be hittable either — an invisible annotation
 * stealing clicks from the wall under it reads as a broken click. */
export const DIMENSION_MIN_PX = 24
export const LABEL_MIN_PX = 6
/** Area polygons cull on k·√area — the same floor the layer uses. */
export const AREA_MIN_PX = 24
const OPENING_INFLATE_PX = 4
const FURNITURE_INFLATE_PX = 3
const NODE_RADIUS_PX = 8
const WALL_TOLERANCE_PX = 4


/** Dimension line moved to its offset position. */
export function dimensionSpan(ann: {
  a: { x: number; y: number }
  b: { x: number; y: number }
  offset: number
}): { p: Vec2; q: Vec2 } {
  const d = sub(ann.b, ann.a)
  const len = Math.hypot(d.x, d.y) || 1
  const n = { x: -d.y / len, y: d.x / len }
  return {
    p: { x: ann.a.x + n.x * ann.offset, y: ann.a.y + n.y * ann.offset },
    q: { x: ann.b.x + n.x * ann.offset, y: ann.b.y + n.y * ann.offset },
  }
}

/** Approximate box of a label's rendered text (world units). */
export function labelBox(ann: { text: string; fontSize?: number }): { w: number; d: number } {
  const size = ann.fontSize ?? DEFAULTS.labelFontSize
  return { w: Math.max(size, ann.text.length * size * 0.62), d: size * 1.3 }
}

export function hitTestAll(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  world: Vec2,
  pxToWorld: number,
  opts: HitOptions = {},
): EntityRef[] {
  const hits: EntityRef[] = []

  // --- annotations (topmost render layer; invisible-at-zoom ones excluded) ---
  const annTol = ANNOTATION_TOLERANCE_PX * pxToWorld
  for (const ann of opts.annotationsVisible === false ? [] : Object.values(doc.annotations)) {
    if (ann.kind === 'dimension') {
      const { p, q } = dimensionSpan(ann)
      if (dist(p, q) < DIMENSION_MIN_PX * pxToWorld) continue // layer culls it
      if (distToSegment(world, p, q) <= annTol) {
        hits.push({ kind: 'annotation', id: ann.id })
      }
    } else if (ann.kind === 'area') {
      if (Math.sqrt(area(ann.points)) < AREA_MIN_PX * pxToWorld) continue // layer culls it
      // the outline (near an edge) or the centroid readout pill hits; the
      // interior does NOT — an area traced over a room must not shadow the
      // furniture/room under it
      const pts = ann.points
      const onEdge = pts.some(
        (p, i) => distToSegment(world, p, pts[(i + 1) % pts.length]!) <= annTol,
      )
      const onPill = dist(world, centroid(pts)) <= AREA_PILL_RADIUS_PX * pxToWorld
      if (onEdge || onPill) hits.push({ kind: 'annotation', id: ann.id })
    } else {
      const size = ann.fontSize ?? DEFAULTS.labelFontSize
      if (size < LABEL_MIN_PX * pxToWorld) continue // layer culls it
      if (pointInOBB(world, { x: ann.x, y: ann.y }, labelBox(ann), ann.rotation ?? 0)) {
        hits.push({ kind: 'annotation', id: ann.id })
      }
    }
  }

  // --- openings (they sit on top of walls) ---
  for (const solid of Object.values(derived.wallSolids)) {
    if (!solid.openings.length) continue
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    const { origin, dir } = solid.frame
    const rel = sub(world, origin)
    const u = rel.x * dir.x + rel.y * dir.y
    const v = rel.x * dir.y - rel.y * dir.x
    const inflate = OPENING_INFLATE_PX * pxToWorld
    if (Math.abs(v) > wall.thickness / 2 + inflate) continue
    for (const op of solid.openings) {
      if (u >= op.u0 - inflate && u <= op.u1 + inflate) {
        hits.push({ kind: 'opening', id: op.openingId })
      }
    }
  }

  // --- furniture: smallest footprint first among overlapping hits ---
  const inflate = FURNITURE_INFLATE_PX * pxToWorld
  const furnitureHits = Object.values(doc.furniture)
    .filter((f) =>
      pointInOBB(
        world,
        { x: f.x, y: f.y },
        { w: f.size.w + 2 * inflate, d: f.size.d + 2 * inflate },
        f.rotation,
      ),
    )
    .sort((a, b) => a.size.w * a.size.d - b.size.w * b.size.d || (a.id < b.id ? -1 : 1))
  for (const f of furnitureHits) hits.push({ kind: 'furniture', id: f.id })

  // --- nodes (contextual) ---
  if (opts.nodeCandidates?.size) {
    const r = NODE_RADIUS_PX * pxToWorld
    for (const id of opts.nodeCandidates) {
      const n = doc.nodes[id]
      if (n && dist(world, n) <= r) hits.push({ kind: 'node', id })
    }
  }

  // --- walls ---
  const wallTol = WALL_TOLERANCE_PX * pxToWorld
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    if (distToSegment(world, na, nb) <= w.thickness / 2 + wallTol) {
      hits.push({ kind: 'wall', id: w.id })
    }
  }

  // --- rooms (read-only select) ---
  for (const room of Object.values(derived.rooms)) {
    if (pointInPolygonWithHoles(world, room.polygon, room.holePolygons)) {
      hits.push({ kind: 'room', id: room.roomId })
    }
  }

  return hits
}

export const hitTestTop = (
  doc: ProjectDocument,
  derived: DerivedGeometry,
  world: Vec2,
  pxToWorld: number,
  opts: HitOptions = {},
): EntityRef | null => hitTestAll(doc, derived, world, pxToWorld, opts)[0] ?? null

// ---------- rect (marquee) selection ----------

const pointInRect = (p: Vec2, min: Vec2, max: Vec2): boolean =>
  p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y

function segIntersectsRect(p: Vec2, q: Vec2, min: Vec2, max: Vec2): boolean {
  if (pointInRect(p, min, max) || pointInRect(q, min, max)) return true
  const c1 = { x: min.x, y: min.y }
  const c2 = { x: max.x, y: min.y }
  const c3 = { x: max.x, y: max.y }
  const c4 = { x: min.x, y: max.y }
  return (
    segSegIntersection(p, q, c1, c2) !== null ||
    segSegIntersection(p, q, c2, c3) !== null ||
    segSegIntersection(p, q, c3, c4) !== null ||
    segSegIntersection(p, q, c4, c1) !== null
  )
}

function polyIntersectsRect(poly: readonly Vec2[], min: Vec2, max: Vec2): boolean {
  if (poly.some((p) => pointInRect(p, min, max))) return true
  // rect fully inside the polygon
  if (pointInPolygon({ x: min.x, y: min.y }, poly)) return true
  for (let i = 0; i < poly.length; i++) {
    if (segIntersectsRect(poly[i]!, poly[(i + 1) % poly.length]!, min, max)) return true
  }
  return false
}

/** Quad of a segment inflated by half-thickness (the rendered band). */
function bandQuad(p: Vec2, q: Vec2, halfT: number): Vec2[] | null {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null
  const nx = (-dy / len) * halfT
  const ny = (dx / len) * halfT
  return [
    { x: p.x + nx, y: p.y + ny },
    { x: q.x + nx, y: q.y + ny },
    { x: q.x - nx, y: q.y - ny },
    { x: p.x - nx, y: p.y - ny },
  ]
}

/**
 * Marquee selection: INTERSECTION semantics — anything whose RENDERED shape
 * touches the rect selects (walls/openings count their thickness band, not
 * just the centerline — matching click hit-testing). Walls, openings,
 * furniture, and annotations; bare nodes are manipulation targets (not
 * bulk-selectable) and rooms are derived, so sweeping a plan must not grab
 * them. Pass pxToWorld to exclude annotations the layer culls at this zoom.
 */
export function hitTestRect(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  a: Vec2,
  b: Vec2,
  pxToWorld?: number,
  opts: HitOptions = {},
): EntityRef[] {
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
  const hits: EntityRef[] = []

  for (const ann of opts.annotationsVisible === false ? [] : Object.values(doc.annotations)) {
    if (ann.kind === 'dimension') {
      const { p, q } = dimensionSpan(ann)
      if (pxToWorld !== undefined && dist(p, q) < DIMENSION_MIN_PX * pxToWorld) continue
      if (segIntersectsRect(p, q, min, max)) hits.push({ kind: 'annotation', id: ann.id })
    } else if (ann.kind === 'area') {
      if (pxToWorld !== undefined && Math.sqrt(area(ann.points)) < AREA_MIN_PX * pxToWorld) {
        continue
      }
      if (polyIntersectsRect(ann.points, min, max)) hits.push({ kind: 'annotation', id: ann.id })
    } else {
      if (
        pxToWorld !== undefined &&
        (ann.fontSize ?? DEFAULTS.labelFontSize) < LABEL_MIN_PX * pxToWorld
      ) {
        continue
      }
      const box = labelBox(ann)
      const rot = ann.rotation ?? 0
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const corners = [
        { x: -box.w / 2, y: -box.d / 2 },
        { x: box.w / 2, y: -box.d / 2 },
        { x: box.w / 2, y: box.d / 2 },
        { x: -box.w / 2, y: box.d / 2 },
      ].map((c) => ({ x: ann.x + c.x * cos - c.y * sin, y: ann.y + c.x * sin + c.y * cos }))
      if (polyIntersectsRect(corners, min, max)) hits.push({ kind: 'annotation', id: ann.id })
    }
  }

  for (const solid of Object.values(derived.wallSolids)) {
    if (!solid.openings.length) continue
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    const { origin, dir } = solid.frame
    for (const op of solid.openings) {
      const p = { x: origin.x + dir.x * op.u0, y: origin.y + dir.y * op.u0 }
      const q = { x: origin.x + dir.x * op.u1, y: origin.y + dir.y * op.u1 }
      const quad = bandQuad(p, q, wall.thickness / 2)
      if (quad ? polyIntersectsRect(quad, min, max) : segIntersectsRect(p, q, min, max)) {
        hits.push({ kind: 'opening', id: op.openingId })
      }
    }
  }

  for (const f of Object.values(doc.furniture)) {
    const cos = Math.cos(f.rotation)
    const sin = Math.sin(f.rotation)
    const hw = f.size.w / 2
    const hh = f.size.d / 2
    const corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((p) => ({ x: f.x + p.x * cos - p.y * sin, y: f.y + p.x * sin + p.y * cos }))
    if (polyIntersectsRect(corners, min, max)) hits.push({ kind: 'furniture', id: f.id })
  }

  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const quad = bandQuad(na, nb, w.thickness / 2)
    if (quad ? polyIntersectsRect(quad, min, max) : segIntersectsRect(na, nb, min, max)) {
      hits.push({ kind: 'wall', id: w.id })
    }
  }

  return hits
}
