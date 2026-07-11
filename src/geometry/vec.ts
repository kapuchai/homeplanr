/**
 * 2D vector math for plan space.
 *
 * CONVENTIONS (see src/model/README.md — the single source of truth):
 * - Units: meters. Angles: radians.
 * - Plan space: x → right, y → down (screen-aligned).
 * - 3D mapping lives in ONE place: the r3f scene's
 *   `<group rotation-x={-Math.PI/2}>` maps plan (x, y, z=height) to world
 *   (x, z, −y); height → world +Y. No other module may convert spaces.
 */
export interface Vec2 {
  x: number
  y: number
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
/** z-component of the 3D cross product; sign follows plan-space handedness. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
/** Perpendicular: rotates 90° in the +angle direction of plan space. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})
export const angle = (a: Vec2): number => Math.atan2(a.y, a.x)
export const rotate = (a: Vec2, rad: number): Vec2 => {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}
export const normalize = (a: Vec2): Vec2 => {
  const l = len(a)
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export const eq = (a: Vec2, b: Vec2, eps: number): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
