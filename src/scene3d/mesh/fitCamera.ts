import type { ProjectDocument } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'

/**
 * Scene bounding box + initial camera pose (PURE — headless-testable).
 * sceneBBox (plan-pinned) = union of wall-solid AABBs, patch prisms, and
 * furniture OBBs (footprint × height at elevation), in PLAN coords
 * (x, y plan, z up). Degenerate/empty scenes fall back to a 10×10×3 m box
 * so the camera can never NaN. The same box drives the shadow frustum and
 * the ground-disc radius.
 */
export interface SceneBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  minZ: number
  maxZ: number
  cx: number
  cy: number
  diag: number
}

export function sceneBBox(doc: ProjectDocument, derived: DerivedGeometry): SceneBBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = 0

  for (const solid of Object.values(derived.wallSolids)) {
    const { origin, dir } = solid.frame
    for (const prism of solid.prisms) {
      for (const p of prism.polygon) {
        const wx = origin.x + dir.x * p.x - dir.y * p.y
        const wy = origin.y + dir.y * p.x + dir.x * p.y
        minX = Math.min(minX, wx)
        minY = Math.min(minY, wy)
        maxX = Math.max(maxX, wx)
        maxY = Math.max(maxY, wy)
      }
      maxZ = Math.max(maxZ, prism.z1)
    }
  }
  for (const patch of derived.patchSolids) {
    for (const p of patch.polygon) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    maxZ = Math.max(maxZ, patch.z1)
  }
  for (const f of Object.values(doc.furniture)) {
    const r = Math.hypot(f.size.w, f.size.d) / 2
    minX = Math.min(minX, f.x - r)
    minY = Math.min(minY, f.y - r)
    maxX = Math.max(maxX, f.x + r)
    maxY = Math.max(maxY, f.y + r)
    maxZ = Math.max(maxZ, f.elevation + f.size.h)
  }

  const empty = !Number.isFinite(minX)
  let diag = empty ? 0 : Math.hypot(maxX - minX, maxY - minY)
  if (empty || diag < 2) {
    // fallback: 10×10×3 m box centered on existing content (or the origin)
    const cx = empty ? 0 : (minX + maxX) / 2
    const cy = empty ? 0 : (minY + maxY) / 2
    minX = cx - 5
    maxX = cx + 5
    minY = cy - 5
    maxY = cy + 5
    maxZ = Math.max(maxZ, 3)
    diag = Math.hypot(10, 10)
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    minZ: 0,
    maxZ,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    diag,
  }
}

export interface CameraPose {
  /** WORLD-space (three.js y-up) camera position + orbit target. */
  position: [number, number, number]
  target: [number, number, number]
  maxDistance: number
}

/** Azimuth 45°, elevation 55°, distance fitted by fov; clamped [3, 200]m. */
export function fitCameraPose(box: SceneBBox, fovDeg = 45): CameraPose {
  const distance = Math.min(
    200,
    Math.max(3, (box.diag / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180)) * 1.15),
  )
  const azimuth = Math.PI / 4
  const elevation = (55 * Math.PI) / 180
  // plan (x, y, z) → world (x, z, −y); target sits 1m above the floor
  const tx = box.cx
  const ty = 1
  const tz = -box.cy
  return {
    position: [
      tx + distance * Math.cos(elevation) * Math.cos(azimuth),
      ty + distance * Math.sin(elevation),
      tz + distance * Math.cos(elevation) * Math.sin(azimuth),
    ],
    target: [tx, ty, tz],
    maxDistance: Math.max(30, 3 * box.diag),
  }
}
