import type { Opening, LevelDoc, Window } from '../types'
import type { FurnitureId, OpeningId } from '../ids'
import { add, dist, dot, perp, scale, sub, type Vec2 } from '../../geometry/vec'
import { closestPointOnSegment } from '../../geometry/segment'

/**
 * Window attachment (0.9.0 curtains). An attached instance's stored
 * x/y/rotation/size.w are WRITE-THROUGH derived from its window: the
 * pipeline re-syncs them after every graph mutation (live and commit), so
 * every consumer — renderers, hit test, export, clipboard — keeps reading
 * plain stored fields and nothing forks. Detaching (opening gone, or a
 * manual transform) simply stops the syncing; the item stands where it
 * last stood.
 *
 * The SIDE of the wall is derived from the stored center each sync (sign
 * of its perp offset) — self-maintaining, no schema field. Which catalog
 * items may attach is the tool layer's business (CatalogItem.windowAttach);
 * this layer only cares that the target is a window.
 */

/** Curtain width beyond the window reveal, each side (m). */
export const ATTACH_OVERHANG = 0.15

const EPS = 1e-9

export interface AttachedTransform {
  x: number
  y: number
  rotation: number
  width: number
}

/**
 * Target transform for depth-`depth` furniture attached to `op`, hanging on
 * the side of the wall that `ref` is on. Null when the host geometry is
 * unusable (missing wall/nodes, degenerate wall).
 */
export function windowAttachTransform(
  doc: LevelDoc,
  op: Opening,
  ref: Vec2,
  depth: number,
): AttachedTransform | null {
  const wall = doc.walls[op.wallId]
  if (!wall) return null
  const a = doc.nodes[wall.a]
  const b = doc.nodes[wall.b]
  if (!a || !b) return null
  const L = dist(a, b)
  if (L < EPS) return null
  const dir = scale(sub(b, a), 1 / L)
  const p = perp(dir)
  const linePoint = add(a, scale(dir, op.t * L))
  const side = dot(sub(ref, linePoint), p) >= 0 ? 1 : -1
  const n = scale(p, side)
  const center = add(linePoint, scale(n, wall.thickness / 2 + depth / 2))
  return {
    x: center.x,
    y: center.y,
    // local +y (item back) must point AT the wall — the wallBack formula
    rotation: Math.atan2(n.x, -n.y),
    width: Math.min(5, op.width + 2 * ATTACH_OVERHANG),
  }
}

/**
 * Nearest window within `maxDist` of `p` (distance to the realized reveal
 * segment on the wall centerline). Null when none is close enough.
 */
export function findWindowNear(
  doc: LevelDoc,
  p: Vec2,
  maxDist: number,
): Window | null {
  let best: Window | null = null
  let bestD = maxDist
  for (const op of Object.values(doc.openings)) {
    if (op.kind !== 'window') continue
    const wall = doc.walls[op.wallId]
    if (!wall) continue
    const a = doc.nodes[wall.a]
    const b = doc.nodes[wall.b]
    if (!a || !b) continue
    const L = dist(a, b)
    if (L < EPS) continue
    const dir = scale(sub(b, a), 1 / L)
    const u0 = op.t * L - op.width / 2
    const u1 = op.t * L + op.width / 2
    const s0 = add(a, scale(dir, u0))
    const s1 = add(a, scale(dir, u1))
    const d = dist(p, closestPointOnSegment(p, s0, s1).point)
    if (d < bestD) {
      bestD = d
      best = op
    }
  }
  return best
}

/** Attach + sync in one step (placement drop / drag re-target). No-op on
 * missing furniture, non-windows, or unusable geometry. */
export function attachFurnitureToOpening(
  doc: LevelDoc,
  id: FurnitureId,
  openingId: OpeningId,
  ref?: Vec2,
): void {
  const f = doc.furniture[id]
  const op = doc.openings[openingId]
  if (!f || !op || op.kind !== 'window') return
  const t = windowAttachTransform(doc, op, ref ?? { x: f.x, y: f.y }, f.size.d)
  if (!t) return
  f.attachedOpeningId = openingId
  f.x = t.x
  f.y = t.y
  f.rotation = t.rotation
  f.size.w = t.width
}

export function detachFurniture(doc: LevelDoc, id: FurnitureId): void {
  const f = doc.furniture[id]
  if (f) delete f.attachedOpeningId
}

/**
 * Pipeline step (both modes, after revalidateOpenings): re-sync every
 * attached instance; detach the ones whose window is gone. Field writes are
 * change-guarded — never write a value that hasn't changed (the derived
 * reference-stability rule).
 *
 * Detach happens in COMMIT mode only — the revalidateOpenings philosophy:
 * a live drag can pass through transient states (a node snapped exactly
 * onto its wall's other endpoint makes the wall degenerate for one frame)
 * that revert before pointer-up, and an overshoot mid-drag must never
 * strip an attachment permanently. In live mode an uncomputable frame
 * just leaves the stored transform alone; the commit re-run settles it.
 */
export function reconcileAttachedFurniture(
  doc: LevelDoc,
  mode: 'live' | 'commit' = 'commit',
): void {
  for (const f of Object.values(doc.furniture)) {
    const opId = f.attachedOpeningId
    if (!opId) continue
    const op = doc.openings[opId]
    if (!op || op.kind !== 'window') {
      if (mode === 'commit') delete f.attachedOpeningId
      continue
    }
    const t = windowAttachTransform(doc, op, { x: f.x, y: f.y }, f.size.d)
    if (!t) {
      if (mode === 'commit') delete f.attachedOpeningId
      continue
    }
    if (Math.abs(f.x - t.x) > EPS) f.x = t.x
    if (Math.abs(f.y - t.y) > EPS) f.y = t.y
    if (Math.abs(f.rotation - t.rotation) > EPS) f.rotation = t.rotation
    if (Math.abs(f.size.w - t.width) > EPS) f.size.w = t.width
  }
}
