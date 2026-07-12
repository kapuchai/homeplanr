import { afterEach, describe, expect, it, vi } from 'vitest'
import { Box3, Vector3, type Mesh, type MeshStandardMaterial } from 'three'
import { CATALOG } from './index'
import { realizeItem } from './realize'
import {
  __setRendererFactoryForTests,
  buildThumbScene,
  ensureThumbnails,
  frameOrtho,
  getThumbnail,
} from './thumbnails'

/**
 * Thumbnail pipeline under the node environment — canvas/WebGL are
 * unavailable, so a fake renderer is injected; everything else
 * (realizeItem, scene assembly, ortho framing) is real CPU math.
 */

const makeFake = () => ({
  setSize: vi.fn(),
  setClearColor: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  domElement: {
    toDataURL: () => 'data:image/png;base64,AAAA',
    addEventListener() {},
  },
  outputColorSpace: '',
  toneMapping: 0,
})

afterEach(() => {
  __setRendererFactoryForTests(null)
})

describe('thumbnails', () => {
  it('caches per item: two ensure calls render once, getThumbnail serves the cache', async () => {
    const fake = makeFake()
    let created = 0
    __setRendererFactoryForTests(() => {
      created++
      return fake
    })
    const sofa = CATALOG['sofa-3']!
    await ensureThumbnails([sofa])
    await ensureThumbnails([sofa])
    expect(fake.render).toHaveBeenCalledTimes(1)
    expect(created).toBe(1)
    expect(getThumbnail(sofa)).toBe('data:image/png;base64,AAAA')
  })

  it('factory throw latches failure: null thumbnails, no retry, no throw', async () => {
    let calls = 0
    __setRendererFactoryForTests(() => {
      calls++
      throw new Error('no webgl here')
    })
    const sofa = CATALOG['sofa-3']!
    await ensureThumbnails([sofa])
    expect(getThumbnail(sofa)).toBeNull()
    await ensureThumbnails([sofa]) // cheap: the factory is never retried
    expect(calls).toBe(1)
    expect(getThumbnail(sofa)).toBeNull()
  })

  it('ensureThumbnails covers all items with monotonic progress and disposes at the end', async () => {
    const fake = makeFake()
    __setRendererFactoryForTests(() => fake)
    const items = Object.values(CATALOG)
    const seen: number[] = []
    await ensureThumbnails(items, (done, total) => {
      expect(total).toBe(items.length)
      seen.push(done)
    })
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
    expect(seen[seen.length - 1]).toBe(items.length)
    expect(fake.render).toHaveBeenCalledTimes(items.length)
    expect(fake.dispose).toHaveBeenCalledTimes(1)
    for (const item of items) expect(getThumbnail(item)).not.toBeNull()
  })

  it('frameOrtho: all 8 corners inside a square frustum hugging the box up to the margin', () => {
    const box = new Box3(new Vector3(-1, 0, -0.5), new Vector3(1, 0.8, 0.5))
    const margin = 0.05
    const azimuth = Math.PI / 4
    const elevation = Math.PI / 6
    const f = frameOrtho(box, azimuth, elevation, margin)

    // reconstruct the camera basis the same way a lookAt with up=+y does
    const dir = new Vector3(
      Math.cos(elevation) * Math.cos(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.sin(azimuth),
    )
    const forward = dir.clone().negate()
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
    const up = new Vector3().crossVectors(right, forward)

    let minR = Infinity
    let maxR = -Infinity
    let minU = Infinity
    let maxU = -Infinity
    for (let i = 0; i < 8; i++) {
      const p = new Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ).sub(f.position)
      const r = p.dot(right)
      const u = p.dot(up)
      const depth = p.dot(forward)
      // every corner inside the frustum
      expect(r).toBeGreaterThanOrEqual(f.left - 1e-9)
      expect(r).toBeLessThanOrEqual(f.right + 1e-9)
      expect(u).toBeGreaterThanOrEqual(f.bottom - 1e-9)
      expect(u).toBeLessThanOrEqual(f.top + 1e-9)
      expect(depth).toBeGreaterThanOrEqual(f.near - 1e-9)
      expect(depth).toBeLessThanOrEqual(f.far + 1e-9)
      minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
    }
    const span = Math.max(maxR - minR, maxU - minU)
    // square frustum, sized to the larger projected span plus the margin
    expect(f.right - f.left).toBeCloseTo(span * (1 + 2 * margin), 9)
    expect(f.top - f.bottom).toBeCloseTo(f.right - f.left, 9)
    // the binding axis hugs the box: slack per side ≤ margin·span (+ε)
    const slack = Math.min(minR - f.left, f.right - maxR, minU - f.bottom, f.top - maxU)
    expect(slack).toBeLessThanOrEqual(margin * span + 1e-9)
    expect(f.near).toBeGreaterThan(0)
    expect(f.far).toBeGreaterThan(f.near)
  })

  it('buildThumbScene: one mesh per realized group, all sharing the neutral override', () => {
    const sofa = CATALOG['sofa-3']!
    const toilet = CATALOG['toilet']!
    const { scene, root } = buildThumbScene(sofa)
    expect(scene.children).toContain(root)
    expect(root.rotation.x).toBeCloseTo(-Math.PI / 2, 12)

    const groups = realizeItem(sofa).groups
    expect(root.children.length).toBe(groups.length)
    const materials = new Set(root.children.map((child) => (child as Mesh).material))
    expect(materials.size).toBe(1)
    const neutral = [...materials][0] as MeshStandardMaterial
    expect(neutral.color.getHexString()).toBe('f2f2f2')
    expect(neutral.roughness).toBe(0.85)
    expect(neutral.metalness).toBe(0)
    // geometries are the shared realize singletons, never copies
    expect(root.children.map((child) => (child as Mesh).geometry)).toEqual(
      groups.map((g) => g.geometry),
    )
    // the override is one module-wide singleton across items (glass too)
    const other = buildThumbScene(toilet)
    expect((other.root.children[0] as Mesh).material).toBe(neutral)
  })
})
