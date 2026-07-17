import type { Vec2 } from '../geometry/vec'
import type { WallSolid } from '../geometry/wallSolids'
import type { WallId } from '../model/ids'

/**
 * Orbit-mode wall occlusion (0.11.0 M3): the dollhouse view. A wall is
 * hidden when it stands BETWEEN the camera and the interior — decided
 * per wall solid by a side test against the scene anchor (bbox center):
 * hide iff camera and anchor lie on clearly opposite sides of the wall's
 * infinite line.
 *
 * The dead-zones make the edge cases resolve themselves:
 * - CAM_SIDE_MIN: a camera near the wall's own line (or plumb above the
 *   scene — top preset: plan position ≈ anchor) hides nothing, so the
 *   top view keeps every wall and close-in orbiting stays stable.
 * - ANCHOR_SIDE_MIN: a partition running through the anchor is
 *   ambiguous — it stays visible rather than flickering with azimuth.
 *
 * Pure plan-space math, no three.js — unit-tested headless. Consumers
 * apply the set as `visible={false}` on the per-wall group (which also
 * stops shadow casting) and to the wall's opening fixtures.
 */

/** Camera must be at least this far (m) beyond the wall line to occlude. */
export const CAM_SIDE_MIN = 0.4
/** Anchor must be at least this far (m) inside for the wall to have a side. */
export const ANCHOR_SIDE_MIN = 0.2

export function hiddenWallIds(
  camPlan: Vec2,
  anchor: Vec2,
  solids: Iterable<WallSolid>,
): Set<WallId> {
  const hidden = new Set<WallId>()
  for (const s of solids) {
    const { origin, dir, length } = s.frame
    const cx = origin.x + dir.x * (length / 2)
    const cy = origin.y + dir.y * (length / 2)
    // +perp(dir) in plan space — sign convention irrelevant here, only
    // OPPOSITENESS of the two side distances matters
    const nx = -dir.y
    const ny = dir.x
    const camSide = nx * (camPlan.x - cx) + ny * (camPlan.y - cy)
    const anchorSide = nx * (anchor.x - cx) + ny * (anchor.y - cy)
    if (Math.abs(camSide) < CAM_SIDE_MIN || Math.abs(anchorSide) < ANCHOR_SIDE_MIN) continue
    if (camSide * anchorSide < 0) hidden.add(s.wallId)
  }
  return hidden
}

/** Cheap set equality so consumers can skip no-op state updates. */
export function sameWallSet(a: Set<WallId>, b: Set<WallId>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}
