import { describe, expect, it } from 'vitest'
import { buildFloorMeshData, buildPrismMeshData, type MeshData } from './prismGeometry'
import { triangulate } from '../../geometry/triangulate'
import { vec, type Vec2 } from '../../geometry/vec'

/**
 * THE orientation pins (plan §Global conventions): normals are computed
 * FROM TRIANGLE WINDING (never trusted from the attribute), then mapped
 * plan→world via (x, y, z) → (x, z, −y) to assert the world-space contract:
 * floor/top-cap normals +Y, lintel bottom-caps −Y, sides horizontal+outward.
 */
const square: Vec2[] = [vec(0, 0), vec(4, 0), vec(4, 0.2), vec(0, 0.2)]

function triangleWindingNormals(mesh: MeshData): { plan: [number, number, number]; world: [number, number, number] }[] {
  const out: { plan: [number, number, number]; world: [number, number, number] }[] = []
  const p = mesh.positions
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3
    const b = mesh.indices[i + 1]! * 3
    const c = mesh.indices[i + 2]! * 3
    const e1 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!]
    const e2 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!]
    const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!
    const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!
    const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!
    const len = Math.hypot(nx, ny, nz) || 1
    const plan: [number, number, number] = [nx / len, ny / len, nz / len]
    // plan (x, y, z) → world (x, z, −y)
    out.push({ plan, world: [plan[0], plan[2], -plan[1]] })
  }
  return out
}

const centroidOf = (ring: Vec2[]) => ({
  x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
  y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
})

describe('buildPrismMeshData winding pins', () => {
  it('full-height prism: top cap world-normal is +Y; sides horizontal and outward', () => {
    const mesh = buildPrismMeshData({ polygon: square, z0: 0, z1: 2.5 })
    const tris = triangleWindingNormals(mesh)
    const c = centroidOf(square)
    let tops = 0
    let sides = 0
    for (let t = 0; t < tris.length; t++) {
      const { plan, world } = tris[t]!
      if (Math.abs(plan[2]) > 0.99) {
        // cap triangle → must face up (world +Y); no bottom cap at z0=0
        expect(world[1]).toBeGreaterThan(0.99)
        tops++
      } else {
        // side triangle → horizontal normal pointing away from the centroid
        expect(Math.abs(world[1])).toBeLessThan(1e-6)
        const i0 = mesh.indices[t * 3]! * 3
        const mx = mesh.positions[i0]!
        const my = mesh.positions[i0 + 1]!
        const dot = plan[0] * (mx - c.x) + plan[1] * (my - c.y)
        expect(dot).toBeGreaterThanOrEqual(-1e-9)
        sides++
      }
    }
    expect(tops).toBeGreaterThan(0)
    expect(sides).toBe(8) // 4 edges × 2 triangles
  })

  it('lintel prism (z0 > 0): bottom cap faces world −Y', () => {
    const mesh = buildPrismMeshData({ polygon: square, z0: 2.0, z1: 2.5 })
    const tris = triangleWindingNormals(mesh)
    const downs = tris.filter(({ plan }) => plan[2] < -0.99)
    expect(downs.length).toBeGreaterThan(0)
    for (const { world } of downs) expect(world[1]).toBeLessThan(-0.99)
  })

  it('ring orientation does not matter (reversed input, same winding)', () => {
    const a = buildPrismMeshData({ polygon: square, z0: 0, z1: 2 })
    const b = buildPrismMeshData({ polygon: square.slice().reverse(), z0: 0, z1: 2 })
    const upsA = triangleWindingNormals(a).filter((t) => t.plan[2] > 0.99).length
    const upsB = triangleWindingNormals(b).filter((t) => t.plan[2] > 0.99).length
    expect(upsA).toBe(upsB)
    expect(upsA).toBeGreaterThan(0)
  })

  it('side UVs run in meters (run-length, z)', () => {
    const mesh = buildPrismMeshData({ polygon: square, z0: 0, z1: 2.5 })
    // first side quad: u from 0 → 4 (edge length), v = z
    expect(mesh.uvs[0]).toBe(0)
    expect(mesh.uvs[2]).toBeCloseTo(4, 9)
    expect(mesh.uvs[5]).toBeCloseTo(2.5, 9) // wait — uv pairs: [u,z0][u+len,z0][u+len,z1][u,z1]
  })
})

describe('buildFloorMeshData', () => {
  it('floor triangles face world +Y', () => {
    const tri = triangulate([vec(0, 0), vec(5, 0), vec(5, 4), vec(0, 4)])
    const mesh = buildFloorMeshData(tri)
    for (const { world } of triangleWindingNormals(mesh)) {
      expect(world[1]).toBeGreaterThan(0.99)
    }
  })
})
