import type { Prism } from '../../geometry/wallSolids'
import { triangulate, type Triangulation } from '../../geometry/triangulate'
import { signedArea } from '../../geometry/polygon'
import type { Vec2 } from '../../geometry/vec'

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
 *
 * buildWallFaceMeshData splits the same geometry into per-face buckets for
 * painted walls. Wall prisms live in wall-local (u,v) space where +v ≡
 * +perp(a→b) ≡ 'front' (the pinned door-swing side), so a side quad's flat
 * outward normal classifies it: ny > 0.999 front, ny < −0.999 back,
 * everything else (end caps, miter slants, jambs, top/bottom caps) trim.
 * Front/back quads swap the run-length u for the vertex's wall-local x so
 * courses stay aligned across prisms split by openings; trim keeps the
 * per-ring run u.
 */
export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

interface Accum {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

const newAccum = (): Accum => ({ positions: [], normals: [], uvs: [], indices: [] })

const toMeshData = (a: Accum): MeshData => ({
  positions: Float32Array.from(a.positions),
  normals: Float32Array.from(a.normals),
  uvs: Float32Array.from(a.uvs),
  indices: Uint32Array.from(a.indices),
})

/** Ring normalized to positive shoelace (the winding contract's precondition). */
const orientRing = (polygon: Vec2[]): Vec2[] =>
  signedArea(polygon) >= 0 ? polygon : polygon.slice().reverse()

/** One outward-facing side quad; the u pair is caller-chosen (run vs local x). */
function emitSideQuad(
  acc: Accum,
  p1: Vec2,
  p2: Vec2,
  z0: number,
  z1: number,
  nx: number,
  ny: number,
  u1: number,
  u2: number,
): void {
  const base = acc.positions.length / 3
  acc.positions.push(p1.x, p1.y, z0, p2.x, p2.y, z0, p2.x, p2.y, z1, p1.x, p1.y, z1)
  for (let k = 0; k < 4; k++) acc.normals.push(nx, ny, 0)
  acc.uvs.push(u1, z0, u2, z0, u2, z1, u1, z1)
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** Triangulated cap at height z; up=false reverses winding to face −z. */
function emitCap(acc: Accum, tri: Triangulation, z: number, up: boolean): void {
  const capVerts = tri.positions.length / 2
  const base = acc.positions.length / 3
  for (let i = 0; i < capVerts; i++) {
    const x = tri.positions[i * 2]!
    const y = tri.positions[i * 2 + 1]!
    acc.positions.push(x, y, z)
    acc.normals.push(0, 0, up ? 1 : -1)
    acc.uvs.push(x, y)
  }
  for (let i = 0; i < tri.indices.length; i += 3) {
    if (up) {
      acc.indices.push(base + tri.indices[i]!, base + tri.indices[i + 1]!, base + tri.indices[i + 2]!)
    } else {
      // reversed order flips winding → faces −z
      acc.indices.push(base + tri.indices[i + 2]!, base + tri.indices[i + 1]!, base + tri.indices[i]!)
    }
  }
}

export function buildPrismMeshData(prism: Prism, opts: { bottomCap?: boolean } = {}): MeshData {
  const ring = orientRing(prism.polygon)
  const n = ring.length
  const { z0, z1 } = prism
  const acc = newAccum()

  // --- side quads (non-indexed per edge for flat normals) ---
  let run = 0
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]!
    const p2 = ring[(i + 1) % n]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    emitSideQuad(acc, p1, p2, z0, z1, dy / len, -dx / len, run, run + len)
    run += len
  }

  // --- caps ---
  const tri = triangulate(ring)
  emitCap(acc, tri, z1, true) // top (+z)
  // bottom cap (−z) — only when lifted off the floor (lintels, window heads)
  if (opts.bottomCap ?? z0 > 1e-9) emitCap(acc, tri, z0, false)

  return toMeshData(acc)
}

export type WallFaceBucket = 'front' | 'back' | 'trim'

/**
 * All of a wall's prisms bucketed into front / back / trim mesh data (see
 * the module docblock for the classification and UV rules). Empty buckets
 * are null — a wall with no openings has no bottom caps, and every wall has
 * trim (end caps + top cap) as long as it has any prism.
 */
export function buildWallFaceMeshData(
  prisms: readonly Prism[],
): { front: MeshData | null; back: MeshData | null; trim: MeshData | null } {
  const acc: Record<WallFaceBucket, Accum> = {
    front: newAccum(),
    back: newAccum(),
    trim: newAccum(),
  }
  for (const prism of prisms) {
    const ring = orientRing(prism.polygon)
    const n = ring.length
    const { z0, z1 } = prism
    // run accumulates over ALL edges so trim u matches buildPrismMeshData
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
      if (ny > 0.999) emitSideQuad(acc.front, p1, p2, z0, z1, nx, ny, p1.x, p2.x)
      else if (ny < -0.999) emitSideQuad(acc.back, p1, p2, z0, z1, nx, ny, p1.x, p2.x)
      else emitSideQuad(acc.trim, p1, p2, z0, z1, nx, ny, run, run + len)
      run += len
    }
    const tri = triangulate(ring)
    emitCap(acc.trim, tri, z1, true)
    if (z0 > 1e-9) emitCap(acc.trim, tri, z0, false)
  }
  const finish = (a: Accum): MeshData | null => (a.indices.length ? toMeshData(a) : null)
  return { front: finish(acc.front), back: finish(acc.back), trim: finish(acc.trim) }
}

/** Concatenate mesh datas into one (indices re-offset) — one draw call. */
export function mergeMeshData(list: readonly MeshData[]): MeshData {
  let posLen = 0
  let uvLen = 0
  let idxLen = 0
  for (const m of list) {
    posLen += m.positions.length
    uvLen += m.uvs.length
    idxLen += m.indices.length
  }
  const positions = new Float32Array(posLen)
  const normals = new Float32Array(posLen)
  const uvs = new Float32Array(uvLen)
  const indices = new Uint32Array(idxLen)
  let vp = 0
  let vu = 0
  let vi = 0
  for (const m of list) {
    positions.set(m.positions, vp)
    normals.set(m.normals, vp)
    uvs.set(m.uvs, vu)
    const offset = vp / 3
    for (let i = 0; i < m.indices.length; i++) indices[vi + i] = m.indices[i]! + offset
    vp += m.positions.length
    vu += m.uvs.length
    vi += m.indices.length
  }
  return { positions, normals, uvs, indices }
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
