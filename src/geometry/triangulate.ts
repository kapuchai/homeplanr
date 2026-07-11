import earcut from 'earcut'
import type { Vec2 } from './vec'
import { signedArea } from './polygon'

/**
 * The ONLY module that imports earcut.
 *
 * Ring orientation is normalized before triangulation (outer ring → positive
 * shoelace, holes → negative) so triangle winding in the output is
 * deterministic regardless of input orientation. The 3D layer relies on this:
 * caps generated from these indices must face the pinned directions
 * (see src/model/README.md → Winding & normals).
 */
export interface Triangulation {
  /** Flat [x0, y0, x1, y1, ...] in plan meters. */
  positions: Float32Array
  /** Triangle indices into positions/2. */
  indices: Uint32Array
}

function orient(ring: readonly Vec2[], positive: boolean): readonly Vec2[] {
  const a = signedArea(ring)
  if ((a >= 0) === positive) return ring
  return ring.slice().reverse()
}

export function triangulate(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): Triangulation {
  const outerN = orient(outer, true)
  const holesN = holes.map((h) => orient(h, false))

  const coords: number[] = []
  const holeIndices: number[] = []
  for (const p of outerN) coords.push(p.x, p.y)
  for (const hole of holesN) {
    holeIndices.push(coords.length / 2)
    for (const p of hole) coords.push(p.x, p.y)
  }

  const indices = earcut(coords, holeIndices.length ? holeIndices : undefined, 2)
  return {
    positions: Float32Array.from(coords),
    indices: Uint32Array.from(indices),
  }
}

/** Sum of triangle areas — used by tests to assert area conservation. */
export function triangulationArea(tri: Triangulation): number {
  let total = 0
  for (let i = 0; i < tri.indices.length; i += 3) {
    const a = tri.indices[i]! * 2
    const b = tri.indices[i + 1]! * 2
    const c = tri.indices[i + 2]! * 2
    const ax = tri.positions[a]!
    const ay = tri.positions[a + 1]!
    const bx = tri.positions[b]!
    const by = tri.positions[b + 1]!
    const cx = tri.positions[c]!
    const cy = tri.positions[c + 1]!
    total += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
  }
  return total
}

/**
 * Signed area of one output triangle in plan space — tests use this to pin
 * that all triangles share the normalized winding.
 */
export function triangleSignedArea(tri: Triangulation, triIndex: number): number {
  const i = triIndex * 3
  const a = tri.indices[i]! * 2
  const b = tri.indices[i + 1]! * 2
  const c = tri.indices[i + 2]! * 2
  const ax = tri.positions[a]!
  const ay = tri.positions[a + 1]!
  const bx = tri.positions[b]!
  const by = tri.positions[b + 1]!
  const cx = tri.positions[c]!
  const cy = tri.positions[c + 1]!
  return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
}
