import { describe, expect, it } from 'vitest'
import { fitCameraPose, sceneBBox } from './fitCamera'
import { getDerived, resetDerivedForTests } from '../../store/derived'
import { emptyDocument } from '../../model/types'
import { addWallSegment } from '../../model/mutations/walls'
import { addFurniture } from '../../model/mutations/furniture'
import { vec } from '../../geometry/vec'

const doc = () => emptyDocument('p_t', 't', '2026-07-11T00:00:00.000Z')

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
