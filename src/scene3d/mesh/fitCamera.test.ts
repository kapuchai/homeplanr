import { describe, expect, it } from 'vitest'
import { testLevelDoc } from '../../test/fixtureDoc'
import {
  fitCameraPose,
  presetPose,
  sceneBBox,
  type CameraPresetKind,
  type SceneBBox,
} from './fitCamera'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { addWallSegment } from '../../model/mutations/walls'
import { addFurniture } from '../../model/mutations/furniture'
import { vec } from '../../geometry/vec'

const doc = () => testLevelDoc('p_t', 't')

const finite = (pose: ReturnType<typeof fitCameraPose>) => {
  for (const v of [...pose.position, ...pose.target, pose.maxDistance]) {
    expect(Number.isFinite(v)).toBe(true)
  }
}

describe('sceneBBox + fitCameraPose degenerate cases (plan-pinned)', () => {
  it('empty document → 10×10×3 fallback box, finite pose, distance ≥ 3', () => {
    resetDerivedForTests()
    const d = doc()
    const box = sceneBBox(d, getDerived(d))
    expect(box.diag).toBeCloseTo(Math.hypot(10, 10), 6)
    expect(box.maxZ).toBe(3)
    const pose = fitCameraPose(box)
    finite(pose)
    expect(pose.maxDistance).toBeGreaterThanOrEqual(30)
  })

  it('single short wall → fallback kicks in (diag < 2m), centered on it', () => {
    resetDerivedForTests()
    const d = doc()
    addWallSegment(d, vec(10, 10), vec(11, 10))
    const box = sceneBBox(d, getDerived(d))
    expect(box.cx).toBeCloseTo(10.5, 6)
    expect(box.diag).toBeGreaterThanOrEqual(Math.hypot(10, 10) - 1e-9)
    finite(fitCameraPose(box))
  })

  it('single furniture item → finite pose', () => {
    resetDerivedForTests()
    const d = doc()
    addFurniture(d, { catalogItemId: 'sofa-3', x: 0, y: 0, size: { w: 2.2, d: 0.95, h: 0.85 } })
    finite(fitCameraPose(sceneBBox(d, getDerived(d))))
  })

  it('real apartment → bbox covers walls incl. height; distance clamped ≤ 200', () => {
    resetDerivedForTests()
    const d = doc()
    addWallSegment(d, vec(0, 0), vec(8, 0))
    addWallSegment(d, vec(8, 0), vec(8, 5))
    const box = sceneBBox(d, getDerived(d))
    expect(box.maxZ).toBeCloseTo(2.5, 6)
    expect(box.maxX).toBeGreaterThanOrEqual(8)
    const pose = fitCameraPose(box)
    finite(pose)
    // world-space target: y (height) = 1, z = −plan-y-center
    expect(pose.target[1]).toBe(1)
    expect(pose.target[2]).toBeLessThanOrEqual(0)
  })
})

describe('presetPose (M2, 0.4.0) — pose+target only, clamp-compliant', () => {
  const box: SceneBBox = {
    minX: 0, minY: 0, maxX: 8, maxY: 6, minZ: 0, maxZ: 2.5,
    cx: 4, cy: 3, diag: 10,
  }
  const KINDS: readonly CameraPresetKind[] = ['top', 'front', 'iso', 'reset']
  const d3 = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
  /** Polar angle (from +y) of the camera as OrbitControls measures it. */
  const polar = (kind: CameraPresetKind) => {
    const p = presetPose(box, kind)
    return Math.acos((p.position[1] - p.target[1]) / d3(p.position, p.target))
  }

  it('all presets share the fitted distance and the 1m-above-floor target', () => {
    const distances = KINDS.map((k) => d3(presetPose(box, k).position, presetPose(box, k).target))
    for (const dd of distances) expect(dd).toBeCloseTo(distances[0]!, 9)
    for (const k of KINDS) {
      expect(presetPose(box, k).target).toEqual([4, 1, -3])
      expect(presetPose(box, k).maxDistance).toBe(fitCameraPose(box).maxDistance)
    }
  })

  it('reset IS fitCameraPose', () => {
    expect(presetPose(box, 'reset')).toEqual(fitCameraPose(box))
  })

  it('top and front stay inside the OrbitControls polar clamps [0.1, π/2 − 0.12]', () => {
    expect(polar('top')).toBeGreaterThanOrEqual(0.1)
    expect(polar('top')).toBeLessThanOrEqual(0.15) // near-vertical
    expect(polar('front')).toBeLessThanOrEqual(Math.PI / 2 - 0.12)
    expect(polar('front')).toBeGreaterThanOrEqual(Math.PI / 2 - 0.2) // near-horizontal
  })

  it('top/front look from the 2D-south side (camera −z of target → screen-up = 2D up)', () => {
    for (const k of ['top', 'front'] as const) {
      const p = presetPose(box, k)
      expect(p.position[2]).toBeLessThan(p.target[2])
      expect(p.position[0]).toBeCloseTo(p.target[0], 9) // centered in x
    }
  })

  it('iso is the classic isometric elevation atan(1/√2)', () => {
    expect(Math.PI / 2 - polar('iso')).toBeCloseTo(Math.atan(1 / Math.SQRT2), 9)
  })
})
