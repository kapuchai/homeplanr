import type { Vec2 } from '../../geometry/vec'

/**
 * Pure walk-mode camera/movement math. No three.js, no React, no stores.
 *
 * YAW CONVENTION (pinned by tests): the walk camera uses rotation.order
 * 'YXZ' with yaw = rotation.y and pitch = rotation.x. At yaw 0 / pitch 0 it
 * looks down world −Z; positive yaw rotates around world +Y (right-hand),
 * turning −Z toward −X. The horizontal facing for a yaw is therefore
 *   world dir = (−sin yaw, 0, −cos yaw)   ⇔   yaw = atan2(−dir.x, −dir.z)
 * Through the ONE plan→world mapping (world z = −plan y) that facing is
 * plan (−sin yaw, +cos yaw): yaw 0 walks toward plan +y.
 */
export const WALK_SPEED = 1.5
export const SPRINT_SPEED = 3.0
/** Pitch clamp: ±85° in radians. */
export const PITCH_LIMIT = (85 * Math.PI) / 180

/** Hermite smoothstep on [0,1]; input is clamped. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

export function clampPitch(p: number): number {
  return Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p))
}

/** Plan (x, y) at height h → world [x, h, −y] (the one mapping, mirrored). */
export function planToWorld(p: Vec2, h: number): [number, number, number] {
  return [p.x, h, -p.y]
}

/** World [x, y, z] → plan (x, −z); world −Z is plan +y. */
export function worldToPlan(w: readonly [number, number, number]): Vec2 {
  return { x: w[0], y: -w[2] }
}

/**
 * Eye pose to enter walk mode with: yaw from the camera's horizontal
 * facing; when that is degenerate (looking straight down), face from the
 * camera position toward the clicked plan point instead. Pitch resets to 0.
 */
export function eyePoseFor(
  camPos: readonly [number, number, number],
  camDirXZ: { x: number; z: number } | null,
  clicked: Vec2,
): { yaw: number; pitch: 0 } {
  let dx = camDirXZ?.x ?? 0
  let dz = camDirXZ?.z ?? 0
  if (Math.hypot(dx, dz) < 1e-6) {
    const target = planToWorld(clicked, 0)
    dx = target[0] - camPos[0]
    dz = target[2] - camPos[2]
  }
  return { yaw: Math.atan2(-dx, -dz), pitch: 0 }
}

export interface MoveKeys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  sprint: boolean
}

/**
 * PLAN-space movement delta for one frame. Forward is the camera facing
 * projected to the floor (see yaw convention above); diagonals are
 * normalized so speed is direction-independent.
 */
export function moveDelta(keys: MoveKeys, yaw: number, dt: number): Vec2 {
  const f = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0)
  const s = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  if (!f && !s) return { x: 0, y: 0 }
  // Orthonormal plan-space camera basis for the yaw.
  const fx = -Math.sin(yaw)
  const fy = Math.cos(yaw)
  const rx = Math.cos(yaw)
  const ry = Math.sin(yaw)
  const dx = fx * f + rx * s
  const dy = fy * f + ry * s
  const L = Math.hypot(dx, dy)
  if (L < 1e-12) return { x: 0, y: 0 }
  const k = ((keys.sprint ? SPRINT_SPEED : WALK_SPEED) * dt) / L
  return { x: dx * k, y: dy * k }
}
