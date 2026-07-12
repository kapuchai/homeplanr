import { describe, expect, it } from 'vitest'
import { vec } from '../../geometry/vec'
import {
  PITCH_LIMIT,
  SPRINT_SPEED,
  WALK_SPEED,
  clampPitch,
  eyePoseFor,
  moveDelta,
  planToWorld,
  smoothstep,
  worldToPlan,
} from './walkMath'

const KEYS = { forward: false, back: false, left: false, right: false, sprint: false }

describe('smoothstep', () => {
  it('endpoints, midpoint, and clamping', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 12)
    expect(smoothstep(0.25)).toBeCloseTo(0.15625, 12)
    expect(smoothstep(-2)).toBe(0)
    expect(smoothstep(3)).toBe(1)
  })
})

describe('clampPitch', () => {
  it('clamps to ±85° in radians', () => {
    expect(PITCH_LIMIT).toBeCloseTo((85 * Math.PI) / 180, 12)
    expect(clampPitch(2)).toBe(PITCH_LIMIT)
    expect(clampPitch(-3)).toBe(-PITCH_LIMIT)
    expect(clampPitch(0.3)).toBe(0.3)
  })
})

describe('plan↔world mapping', () => {
  it('roundtrips and pins the y/z sign', () => {
    expect(planToWorld(vec(1.25, -2.5), 1.6)).toEqual([1.25, 1.6, 2.5])
    const back = worldToPlan([1.25, 1.6, 2.5])
    expect(back.x).toBeCloseTo(1.25, 12)
    expect(back.y).toBeCloseTo(-2.5, 12)
    // ground truth the yaw/move tests build on: world −Z is plan +y
    expect(worldToPlan([0, 0, -1]).y).toBe(1)
    expect(planToWorld(vec(0, 1), 0)[2]).toBe(-1)
  })
})

describe('eyePoseFor (YXZ camera: yaw 0 looks down world −Z)', () => {
  it('camera at (0,1.6,5) facing −Z: clicked point ahead keeps yaw ≈ 0', () => {
    const pose = eyePoseFor([0, 1.6, 5], { x: 0, z: -1 }, vec(0, 0))
    expect(pose.yaw).toBeCloseTo(0, 12)
    expect(pose.pitch).toBe(0)
  })

  it('facing world −X ⇒ yaw π/2 (positive yaw turns −Z toward −X)', () => {
    expect(eyePoseFor([0, 1.6, 0], { x: -1, z: 0 }, vec(0, 0)).yaw).toBeCloseTo(Math.PI / 2, 12)
  })

  it('degenerate facing falls back to camera→click, consistent with planToWorld', () => {
    // clicked plan (0,0) → world (0,·,0), straight ahead of z=5 → yaw 0
    expect(eyePoseFor([0, 1.6, 5], null, vec(0, 0)).yaw).toBeCloseTo(0, 12)
    // clicked plan (−3, −5) → world (−3,·,5): due −X of the camera → π/2
    expect(eyePoseFor([0, 1.6, 5], null, vec(-3, -5)).yaw).toBeCloseTo(Math.PI / 2, 12)
    // a zero-length facing vector degrades the same way as null
    expect(eyePoseFor([0, 1.6, 5], { x: 0, z: 0 }, vec(0, 0)).yaw).toBeCloseTo(0, 12)
  })
})

describe('moveDelta (plan space)', () => {
  it('forward at yaw 0 walks toward plan +y (= world −Z by the roundtrip)', () => {
    const d = moveDelta({ ...KEYS, forward: true }, 0, 1)
    expect(d.x).toBeCloseTo(0, 12)
    expect(d.y).toBeCloseTo(WALK_SPEED, 12)
  })

  it('strafe right at yaw 0 walks toward plan +x (world +X)', () => {
    const d = moveDelta({ ...KEYS, right: true }, 0, 1)
    expect(d.x).toBeCloseTo(WALK_SPEED, 12)
    expect(d.y).toBeCloseTo(0, 12)
  })

  it('forward at yaw π/2 walks toward plan −x (camera faces world −X)', () => {
    const d = moveDelta({ ...KEYS, forward: true }, Math.PI / 2, 1)
    expect(d.x).toBeCloseTo(-WALK_SPEED, 12)
    expect(d.y).toBeCloseTo(0, 12)
  })

  it('diagonals are normalized to walk speed', () => {
    const d = moveDelta({ ...KEYS, forward: true, right: true }, 0, 1)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(WALK_SPEED, 12)
    expect(d.x).toBeCloseTo(WALK_SPEED / Math.SQRT2, 12)
    expect(d.y).toBeCloseTo(WALK_SPEED / Math.SQRT2, 12)
  })

  it('sprint doubles speed; dt scales linearly; opposed keys cancel', () => {
    expect(SPRINT_SPEED).toBeCloseTo(2 * WALK_SPEED, 12)
    expect(moveDelta({ ...KEYS, forward: true, sprint: true }, 0, 1).y).toBeCloseTo(
      SPRINT_SPEED,
      12,
    )
    expect(moveDelta({ ...KEYS, forward: true }, 0, 1 / 60).y).toBeCloseTo(WALK_SPEED / 60, 12)
    const cancel = moveDelta({ ...KEYS, forward: true, back: true }, 0, 1)
    expect(cancel.x).toBe(0)
    expect(cancel.y).toBe(0)
    const none = moveDelta(KEYS, 0, 1)
    expect(none.x).toBe(0)
    expect(none.y).toBe(0)
  })
})
