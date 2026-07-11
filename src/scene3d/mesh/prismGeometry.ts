import type { Prism } from '../../geometry/wallSolids'
import { triangulate } from '../../geometry/triangulate'
import { signedArea } from '../../geometry/polygon'

/**
 * Prism → raw mesh arrays (PURE — no three.js import; the scene3d layer
 * wraps these in BufferGeometry). Vertices are in PLAN coordinates
 * (x, y plan; z up); the r3f plan group's rotation-x=-π/2 maps them to
 * world space (x, z, −y), height → +Y.
 *
 * Winding contract (pinned by tests computing normals FROM winding):
 * - top caps face +z (world +Y), bottom caps −z (emitted only when z0 > 0);
 * - side quads face outward (away from the ring interior); rings are
 *   normalized to positive shoelace first, for which the outward
 *   perpendicular of edge direction (dx,dy) is (dy,−dx).
 * - UVs: sides = (running length, z) meters; caps = (x, y) meters.
 */
export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export function buildPrismMeshData(prism: Prism, opts: { bottomCap?: boolean } = {}): MeshData {
  const ring =
    signedArea(prism.polygon) >= 0 ? prism.polygon : prism.polygon.slice().reverse()
  const n = ring.length
  const { z0, z1 } = prism

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // --- side quads (non-indexed per edge for flat normals) ---
  let run = 0
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]!
    const p2 = ring[(i + 1) % n]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const nx = dy / len
    const ny = -dx / len
    const base = positions.length / 3
    positions.push(p1.x, p1.y, z0, p2.x, p2.y, z0, p2.x, p2.y, z1, p1.x, p1.y, z1)
    for (let k = 0; k < 4; k++) normals.push(nx, ny, 0)
    uvs.push(run, z0, run + len, z0, run + len, z1, run, z1)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    run += len
  }

  // --- caps ---
  const tri = triangulate(ring)
  const capVerts = tri.positions.length / 2

  // top cap (+z)
  const topBase = positions.length / 3
  for (let i = 0; i < capVerts; i++) {
    const x = tri.positions[i * 2]!
    const y = tri.positions[i * 2 + 1]!
    positions.push(x, y, z1)
    normals.push(0, 0, 1)
    uvs.push(x, y)
  }
  for (let i = 0; i < tri.indices.length; i += 3) {
    indices.push(topBase + tri.indices[i]!, topBase + tri.indices[i + 1]!, topBase + tri.indices[i + 2]!)
  }

  // bottom cap (−z) — only when lifted off the floor (lintels, window heads)
  if (opts.bottomCap ?? z0 > 1e-9) {
    const botBase = positions.length / 3
    for (let i = 0; i < capVerts; i++) {
      const x = tri.positions[i * 2]!
      const y = tri.positions[i * 2 + 1]!
      positions.push(x, y, z0)
      normals.push(0, 0, -1)
      uvs.push(x, y)
    }
    for (let i = 0; i < tri.indices.length; i += 3) {
      // reversed order flips winding → faces −z
      indices.push(botBase + tri.indices[i + 2]!, botBase + tri.indices[i + 1]!, botBase + tri.indices[i]!)
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  }
}

/** Flat floor slab from a room triangulation (z = 0, +z facing). */
export function buildFloorMeshData(tri: {
  positions: Float32Array
  indices: Uint32Array
}): MeshData {
  const verts = tri.positions.length / 2
  const positions = new Float32Array(verts * 3)
  const normals = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  for (let i = 0; i < verts; i++) {
    const x = tri.positions[i * 2]!
    const y = tri.positions[i * 2 + 1]!
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = 0
    normals[i * 3] = 0
    normals[i * 3 + 1] = 0
    normals[i * 3 + 2] = 1
    uvs[i * 2] = x
    uvs[i * 2 + 1] = y
  }
  return { positions, normals, uvs, indices: Uint32Array.from(tri.indices) }
}
