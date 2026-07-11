import { describe, expect, it } from 'vitest'
import {
  fitBounds,
  gridTier,
  pxToWorld,
  screenToWorld,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
  K_DEFAULT,
  K_MAX,
  K_MIN,
  type Viewport,
} from './viewportMath'
import { vec } from '../../geometry/vec'

const vp: Viewport = { k: 100, tx: 50, ty: 20, width: 800, height: 600 }

describe('viewport transforms (y-up render)', () => {
  it('world↔screen roundtrip; +world.y maps UP-screen (−y px)', () => {
    const w = vec(2.5, -1.25)
    const s = worldToScreen(w, vp)
    expect(s).toEqual({ x: 300, y: 145 }) // 20 − (−1.25)·100
    expect(screenToWorld(s, vp)).toEqual(w)
    // chirality pin: growing world.y must DECREASE screen.y
    expect(worldToScreen(vec(0, 1), vp).y).toBeLessThan(worldToScreen(vec(0, 0), vp).y)
  })

  it('pxToWorld scales with k', () => {
    expect(pxToWorld(10, vp)).toBeCloseTo(0.1, 12)
  })

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const cursor = vec(400, 300)
    const before = screenToWorld(cursor, vp)
    const zoomed = zoomAt(vp, cursor, 1.2)
    const after = screenToWorld(cursor, zoomed)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(zoomed.k).toBeCloseTo(120, 9)
  })

  it('zoomAt clamps k to [K_MIN, K_MAX]', () => {
    expect(zoomAt(vp, vec(0, 0), 1000).k).toBe(K_MAX)
    expect(zoomAt(vp, vec(0, 0), 1e-9).k).toBe(K_MIN)
  })
})

describe('fitBounds', () => {
  it('fits and centers bounds with padding', () => {
    const fitted = fitBounds({ minX: 0, minY: 0, maxX: 8, maxY: 6 }, vp)
    // 800/8=100, 600/6=100 → k = 100·0.9 = 90; centered
    expect(fitted.k).toBeCloseTo(90, 9)
    const center = screenToWorld(vec(400, 300), fitted)
    expect(center.x).toBeCloseTo(4, 9)
    expect(center.y).toBeCloseTo(3, 9)
  })

  it('empty bounds → default view centered on origin', () => {
    const fitted = fitBounds(null, vp)
    expect(fitted.k).toBe(K_DEFAULT)
    const origin = worldToScreen(vec(0, 0), fitted)
    expect(origin).toEqual({ x: 400, y: 300 })
  })
})

describe('gridTier (one rule: gridSize × {1,5,10,50}, minor ≥ 12px)', () => {
  it('default gridSize 0.1 across zoom levels', () => {
    expect(gridTier(200, 0.1)).toEqual({ minor: 0.1, major: 1 }) // 20px
    expect(gridTier(60, 0.1)).toEqual({ minor: 0.5, major: 5 }) // 6px→30px
    expect(gridTier(20, 0.1)).toEqual({ minor: 1, major: 10 })
    expect(gridTier(5, 0.1)).toEqual({ minor: 5, major: 50 })
  })

  it('editing gridSize rescales both grid and snap step', () => {
    // 0.05·300px = 15px ≥ 12 → finest tier shows; at 200px it's only 10px
    // so the rule correctly climbs to the next tier
    expect(gridTier(300, 0.05)).toEqual({ minor: 0.05, major: 0.5 })
    expect(gridTier(200, 0.05)).toEqual({ minor: 0.25, major: 2.5 })
    expect(gridTier(200, 0.25)).toEqual({ minor: 0.25, major: 2.5 })
  })

  it('falls back to the coarsest tier when zoomed way out', () => {
    expect(gridTier(1, 0.1).minor).toBe(5)
  })
})

describe('wheelZoomFactor', () => {
  it('normalizes deltaMode and clamps to 1.25× per event', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeCloseTo(Math.exp(0.15), 9)
    expect(wheelZoomFactor(-5, 1, false)).toBeCloseTo(Math.exp(0.12), 9) // 5 lines ≈ 80px
    expect(wheelZoomFactor(-10, 1, false)).toBe(1.25) // 160px exceeds the clamp
    expect(wheelZoomFactor(-10000, 0, false)).toBe(1.25)
    expect(wheelZoomFactor(10000, 0, false)).toBe(1 / 1.25)
  })

  it('ctrl (pinch) uses a finer, still-clamped response', () => {
    expect(wheelZoomFactor(-20, 0, true)).toBeCloseTo(Math.exp(0.1), 9)
    expect(wheelZoomFactor(-9999, 0, true)).toBe(1.25)
  })
})
