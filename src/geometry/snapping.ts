import type { NodeId, WallId } from '../model/ids'
import type { Vec2 } from './vec'
import { add, dist, dot, scale, sub } from './vec'
import { segSegIntersection } from './segment'

/**
 * THE snap resolver — the only place snap priorities live.
 * editor2d/snap/* modules are candidate GENERATORS only; they feed concrete
 * candidates (already positioned against the raw cursor) into resolveSnap.
 *
 * Priority (plan table ①–⑦): hard clamps are enforced by tools before/after
 * snapping (not candidates); then node > wallPoint > wallBack > angleRay >
 * guides (per-axis) > grid. A node candidate in capture radius beats an
 * active angle ray (escape hatch); all lower snaps project onto an active
 * ray. Hysteresis: the previous frame's winning candidate survives within
 * its RELEASE radius against same-or-lower priority challengers.
 */

export type SnapCandidate =
  | { kind: 'node'; point: Vec2; nodeId: NodeId }
  | {
      kind: 'wallPoint'
      point: Vec2
      wallId: WallId
      t: number
      /** Segment endpoints — lets an active angle ray snap to the RAY∩WALL
       * intersection instead of the cursor's sliding foot point. */
      a?: Vec2
      b?: Vec2
    }
  | {
      kind: 'wallBack'
      point: Vec2
      wallId: WallId
      /** Auto-rotation so the item's back faces the wall. */
      rotation: number
      /** 1-DOF slide line while captured. */
      slideOrigin: Vec2
      slideDir: Vec2
    }
  | { kind: 'angleRay'; origin: Vec2; dir: Vec2; label: string }
  | {
      kind: 'guideX'
      /** Snapped CENTER x for the dragged subject. */
      value: number
      refIds: string[]
      /** Where the visual alignment line runs (edge/center of the pair). */
      display?: number
    }
  | { kind: 'guideY'; value: number; refIds: string[]; display?: number }
  | { kind: 'grid'; step: number }

export type SnapKind = SnapCandidate['kind']

/** Screen-space radii (px) — converted per call via pxToWorld. */
export const SNAP_RADII_PX: Record<
  Exclude<SnapKind, 'grid' | 'angleRay'>,
  { capture: number; release: number }
> = {
  node: { capture: 10, release: 14 },
  wallPoint: { capture: 8, release: 12 },
  wallBack: { capture: 12, release: 18 },
  guideX: { capture: 6, release: 8 },
  guideY: { capture: 6, release: 8 },
}

/** Angular capture for the draw-wall angle assist (radians). */
export const ANGLE_RAY_CAPTURE = (7.5 * Math.PI) / 180

const PRIORITY: Record<SnapKind, number> = {
  node: 1,
  wallPoint: 2,
  wallBack: 3,
  angleRay: 4,
  guideX: 5,
  guideY: 5,
  grid: 6,
}

export interface SnapConstraint {
  kind: 'ray' | 'wallSlide'
  origin: Vec2
  dir: Vec2
  wallId?: WallId
}

export interface SnapResult {
  point: Vec2
  /** Winning point-candidate (if any) — drives snap indicator rendering. */
  primary?: SnapCandidate
  /** Axis contributors when resolution was per-axis (guides/grid). */
  axes?: { x?: SnapCandidate; y?: SnapCandidate }
  /** wallBack auto-rotation, passed through. */
  rotation?: number
  /** Active 1-DOF constraint for the CURRENT gesture frame. */
  constraint?: SnapConstraint
}

export interface SnapOptions {
  /** meters per screen px at current zoom (radii conversion). */
  pxToWorld: number
  /** Previous frame's result — enables hysteresis. */
  prev?: SnapResult
  /** Externally-imposed constraint (e.g. wallSlide while captured). */
  constraint?: SnapConstraint
  /** Master switch (settings.snapEnabled / Ctrl suspends soft snaps). */
  enabled?: boolean
}

const candidateIdentity = (c: SnapCandidate): string => {
  switch (c.kind) {
    case 'node':
      return `node:${c.nodeId}`
    case 'wallPoint':
      return `wallPoint:${c.wallId}`
    case 'wallBack':
      return `wallBack:${c.wallId}`
    case 'angleRay':
      return `angleRay:${c.label}`
    case 'guideX':
      return `guideX:${c.value.toFixed(6)}`
    case 'guideY':
      return `guideY:${c.value.toFixed(6)}`
    case 'grid':
      return 'grid'
  }
}

function projectOnRay(p: Vec2, origin: Vec2, dir: Vec2): Vec2 {
  const u = dot(sub(p, origin), dir)
  return add(origin, scale(dir, u))
}

const snapToGrid = (v: number, step: number) => Math.round(v / step) * step

export function resolveSnap(
  raw: Vec2,
  candidates: readonly SnapCandidate[],
  opts: SnapOptions,
): SnapResult {
  if (opts.enabled === false) {
    // Hard external constraints still apply with soft snapping suspended.
    if (opts.constraint) {
      return {
        point: projectOnRay(raw, opts.constraint.origin, opts.constraint.dir),
        constraint: opts.constraint,
      }
    }
    return { point: raw }
  }

  const toWorld = (px: number) => px * opts.pxToWorld
  const prevId = opts.prev?.primary ? candidateIdentity(opts.prev.primary) : null

  // --- active ray detection first (wallPoints project onto it) ---
  let preRay: { origin: Vec2; dir: Vec2 } | null = null
  if (opts.constraint) {
    preRay = { origin: opts.constraint.origin, dir: opts.constraint.dir }
  } else {
    let bestAng = ANGLE_RAY_CAPTURE
    for (const c of candidates) {
      if (c.kind !== 'angleRay') continue
      const v = sub(raw, c.origin)
      const len = Math.hypot(v.x, v.y)
      if (len < 1e-9) continue
      const cos = Math.min(1, Math.max(-1, (v.x * c.dir.x + v.y * c.dir.y) / len))
      const ang = Math.acos(cos)
      if (ang <= bestAng) {
        bestAng = ang
        preRay = { origin: c.origin, dir: c.dir }
      }
    }
  }

  // --- collect point-candidates (node/wallPoint/wallBack) within radius ---
  interface Scored {
    c: SnapCandidate & { point: Vec2 }
    d: number
    priority: number
    sticky: boolean
  }
  const scored: Scored[] = []
  for (const c of candidates) {
    if (c.kind !== 'node' && c.kind !== 'wallPoint' && c.kind !== 'wallBack') continue
    let cand = c
    // Straight-attachment (M6 gate): with an angle ray active, a wall's
    // snap point is the RAY∩SEGMENT intersection, not the sliding foot
    // of the cursor — drawing along an axis lands ON the crossed wall.
    if (preRay && c.kind === 'wallPoint' && c.a && c.b) {
      const far = add(preRay.origin, scale(preRay.dir, 10_000))
      const hit = segSegIntersection(preRay.origin, far, c.a, c.b)
      if (!hit) continue // ray misses this wall — not a candidate under lock
      cand = { ...c, point: hit.p, t: hit.u }
    }
    const d = dist(raw, cand.point)
    const radii = SNAP_RADII_PX[cand.kind as keyof typeof SNAP_RADII_PX]
    const sticky = prevId === candidateIdentity(cand)
    const within = d <= toWorld(sticky ? radii.release : radii.capture)
    if (within) scored.push({ c: cand, d, priority: PRIORITY[cand.kind], sticky })
  }
  scored.sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(b.sticky) - Number(a.sticky) ||
      a.d - b.d,
  )
  const winner = scored[0]

  // --- the active ray (computed above; external constraint already wins) ---
  const ray: SnapConstraint | undefined = opts.constraint
    ? opts.constraint
    : preRay
      ? { kind: 'ray', origin: preRay.origin, dir: preRay.dir }
      : undefined

  // --- node/wallPoint escape: a point-winner beats the ray outright ---
  if (winner && (winner.c.kind === 'node' || PRIORITY[winner.c.kind] < PRIORITY.angleRay)) {
    const result: SnapResult = { point: winner.c.point, primary: winner.c }
    if (winner.c.kind === 'wallBack') {
      result.rotation = winner.c.rotation
      const slide = {
        kind: 'wallSlide' as const,
        origin: winner.c.slideOrigin,
        dir: winner.c.slideDir,
        wallId: winner.c.wallId,
      }
      result.constraint = slide
      // Under an active external slide, project the capture point onto it.
      if (opts.constraint) {
        result.point = projectOnRay(result.point, opts.constraint.origin, opts.constraint.dir)
      }
      // CORNER COMPOSITION: guides (incl. the perpendicular wall's face)
      // clamp the slide parameter — this is how furniture snaps into room
      // corners while captured against one wall.
      let bestCorner: { point: Vec2; cand: SnapCandidate; d: number } | null = null
      for (const c of candidates) {
        let p: Vec2 | null = null
        if (c.kind === 'guideX' && Math.abs(slide.dir.x) > 1e-9) {
          const u = (c.value - slide.origin.x) / slide.dir.x
          p = add(slide.origin, scale(slide.dir, u))
        } else if (c.kind === 'guideY' && Math.abs(slide.dir.y) > 1e-9) {
          const u = (c.value - slide.origin.y) / slide.dir.y
          p = add(slide.origin, scale(slide.dir, u))
        }
        if (!p) continue
        const d = dist(result.point, p)
        const r = toWorld(SNAP_RADII_PX.guideX.capture)
        if (d <= r && (!bestCorner || d < bestCorner.d)) {
          bestCorner = { point: p, cand: c, d }
        }
      }
      if (bestCorner) {
        result.point = bestCorner.point
        result.axes =
          bestCorner.cand.kind === 'guideX'
            ? { x: bestCorner.cand }
            : { y: bestCorner.cand }
      }
    } else if (ray && opts.constraint) {
      // External constraints are hard: even point snaps project onto them.
      result.point = projectOnRay(result.point, ray.origin, ray.dir)
      result.constraint = ray
    }
    return result
  }

  // --- per-axis resolution among guides, then grid fills the rest ---
  const grid = candidates.find((c): c is Extract<SnapCandidate, { kind: 'grid' }> => c.kind === 'grid')
  const axes: { x?: SnapCandidate; y?: SnapCandidate } = {}
  let px = raw.x
  let py = raw.y

  let bestGX: Extract<SnapCandidate, { kind: 'guideX' }> | undefined
  let bestGY: Extract<SnapCandidate, { kind: 'guideY' }> | undefined
  for (const c of candidates) {
    if (c.kind === 'guideX') {
      const sticky = prevId === candidateIdentity(c)
      const r = toWorld(sticky ? SNAP_RADII_PX.guideX.release : SNAP_RADII_PX.guideX.capture)
      if (Math.abs(raw.x - c.value) <= r && (!bestGX || Math.abs(raw.x - c.value) < Math.abs(raw.x - bestGX.value))) {
        bestGX = c
      }
    } else if (c.kind === 'guideY') {
      const sticky = prevId === candidateIdentity(c)
      const r = toWorld(sticky ? SNAP_RADII_PX.guideY.release : SNAP_RADII_PX.guideY.capture)
      if (Math.abs(raw.y - c.value) <= r && (!bestGY || Math.abs(raw.y - c.value) < Math.abs(raw.y - bestGY.value))) {
        bestGY = c
      }
    }
  }
  if (bestGX) {
    px = bestGX.value
    axes.x = bestGX
  } else if (grid) {
    px = snapToGrid(raw.x, grid.step)
    axes.x = grid
  }
  if (bestGY) {
    py = bestGY.value
    axes.y = bestGY
  } else if (grid) {
    py = snapToGrid(raw.y, grid.step)
    axes.y = grid
  }

  let point: Vec2 = { x: px, y: py }
  if (ray) point = projectOnRay(point, ray.origin, ray.dir)

  const result: SnapResult = { point }
  if (axes.x || axes.y) result.axes = axes
  if (ray) result.constraint = ray
  return result
}
