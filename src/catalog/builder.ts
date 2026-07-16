/**
 * Procedural furniture builder — PURE part lists, no three.js import.
 * realize.ts turns parts into merged BufferGeometries per material slot.
 *
 * Part coordinates are item-local: x right, y depth (front = −y), z up;
 * `at` = [centerX, centerY, bottomZ] so furniture stacks upward naturally.
 */
export type V3 = [number, number, number]

/**
 * 2D-symbol authoring hint (M3, 0.4.0) — how symbolFromParts renders this
 * part's plan projection: 'omit' skips it (inner structure that only
 * clutters the top view), 'outline' emits it with the stronger outline role
 * (the part that should read as the item's silhouette). Absent = 'detail'
 * hairline, the default. 3D rendering is unaffected.
 */
export type SymbolHint = 'omit' | 'outline'

export interface BoxPart {
  kind: 'box'
  mat: string
  /** Full sizes along item-local x/y/z. */
  size: V3
  /** [centerX, centerY, bottomZ]. */
  at: V3
  /** Corner radius (RoundedBoxGeometry) — cushions, seats. */
  round?: number
  /** Euler rotation [rx, ry, rz] about the part's own center. */
  rot?: V3
  symbol?: SymbolHint
}

export interface CylinderPart {
  kind: 'cylinder'
  mat: string
  r: number
  h: number
  /** [centerX, centerY, bottomZ] (bottom along the axis for z; center else). */
  at: V3
  /** Axis the cylinder height runs along. Default 'z' (vertical). */
  axis?: 'x' | 'y' | 'z'
  /** Non-uniform scale applied to the geometry (elongated bowls). */
  scale?: V3
  symbol?: SymbolHint
}

export type Part = BoxPart | CylinderPart

export interface Builder {
  box: (mat: string, p: Omit<BoxPart, 'kind' | 'mat'>) => void
  cylinder: (mat: string, p: Omit<CylinderPart, 'kind' | 'mat'>) => void
  /**
   * Run `fn` and duplicate every part it emitted, mirrored across x = 0.
   * Implemented PART-LEVEL via mirrorPart — never a negative scale matrix
   * (that inverts triangle winding and back-face culls mirrored parts
   * into invisibility).
   */
  mirrorX: (fn: () => void) => void
}

/**
 * Reflect one part across item-local x = 0 — the transform behind both
 * builder.mirrorX and mirrored instances (realizeItem): negate center x;
 * boxes also negate rotY/rotZ (rotX kept — it conjugates to itself under
 * the reflection). Scale magnitudes untouched; never a negative-scale
 * matrix, so triangle winding survives.
 */
export function mirrorPart(part: Part): Part {
  if (part.kind === 'box') {
    return {
      ...part,
      at: [-part.at[0], part.at[1], part.at[2]],
      ...(part.rot ? { rot: [part.rot[0], -part.rot[1], -part.rot[2]] as V3 } : {}),
    }
  }
  return { ...part, at: [-part.at[0], part.at[1], part.at[2]] }
}

export function collectParts(fn: (b: Builder) => void): Part[] {
  const parts: Part[] = []
  const b: Builder = {
    box: (mat, p) => parts.push({ kind: 'box', mat, ...p }),
    cylinder: (mat, p) => parts.push({ kind: 'cylinder', mat, ...p }),
    mirrorX: (inner) => {
      const start = parts.length
      inner()
      const emitted = parts.slice(start)
      for (const part of emitted) parts.push(mirrorPart(part))
    },
  }
  fn(b)
  return parts
}

/** Axis-aligned bounds of a part list (rotations bounded conservatively). */
export function partsBounds(parts: readonly Part[]): {
  min: V3
  max: V3
} {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  const grow = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
  }
  for (const p of parts) {
    if (p.kind === 'box') {
      let [hx, hy, hz] = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2]
      if (p.rot && (p.rot[0] !== 0 || p.rot[1] !== 0 || p.rot[2] !== 0)) {
        // exact rotated-box AABB: |R| · halfExtents (Euler XYZ order)
        const [rx, ry, rz] = p.rot
        const cx = Math.cos(rx)
        const sx_ = Math.sin(rx)
        const cy = Math.cos(ry)
        const sy_ = Math.sin(ry)
        const cz = Math.cos(rz)
        const sz_ = Math.sin(rz)
        // R = Rz(rz)·Ry(ry)·Rx(rx) applied as XYZ intrinsic — use standard
        // three.js Euler XYZ composition
        const r00 = cy * cz
        const r01 = -cy * sz_
        const r02 = sy_
        const r10 = cx * sz_ + sx_ * sy_ * cz
        const r11 = cx * cz - sx_ * sy_ * sz_
        const r12 = -sx_ * cy
        const r20 = sx_ * sz_ - cx * sy_ * cz
        const r21 = sx_ * cz + cx * sy_ * sz_
        const r22 = cx * cy
        const ex = Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz
        const ey = Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz
        const ez = Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz
        hx = ex
        hy = ey
        hz = ez
      }
      const czr = p.at[2] + p.size[2] / 2 // rotation is about the part center
      grow(p.at[0] - hx, p.at[1] - hy, czr - hz)
      grow(p.at[0] + hx, p.at[1] + hy, czr + hz)
    } else {
      const s = p.scale ?? [1, 1, 1]
      const axis = p.axis ?? 'z'
      let ex: number
      let ey: number
      let ez: number
      if (axis === 'z') {
        ex = p.r * 2 * s[0]
        ey = p.r * 2 * s[1]
        ez = p.h * s[2]
      } else if (axis === 'x') {
        ex = p.h * s[0]
        ey = p.r * 2 * s[1]
        ez = p.r * 2 * s[2]
      } else {
        ex = p.r * 2 * s[0]
        ey = p.h * s[1]
        ez = p.r * 2 * s[2]
      }
      grow(p.at[0] - ex / 2, p.at[1] - ey / 2, p.at[2])
      grow(p.at[0] + ex / 2, p.at[1] + ey / 2, p.at[2] + ez)
    }
  }
  return { min, max }
}
