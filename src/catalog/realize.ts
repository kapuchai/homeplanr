import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Euler,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { collectParts, mirrorPart, type Part } from './builder'
import type { CatalogItem } from './types'

/**
 * Realize a catalog item's part list into merged BufferGeometries —
 * ONE geometry per material slot per item (a sofa = 2 draw calls), cached
 * per item id for the app lifetime (mirrored variants under id+'|m');
 * every scene instance shares them.
 *
 * Parts are authored in item-local plan-style coords (x right, y depth,
 * z up) and the geometries stay in that frame — the r3f plan group's
 * rotation handles world orientation. `mirrored` reflects across
 * item-local x = 0 (FurnitureInstance.mirrored) by re-emitting each part
 * through mirrorPart — the same part-level transform builder.mirrorX
 * uses, never a negative-scale matrix, so winding stays valid.
 *
 * Seam inset (0.11.0): parts are authored ABUTTING exactly, so parts in
 * different slots share coplanar faces and z-fight. Every part is built
 * SEAM_EPS smaller per side around its authored center (translate math
 * keeps the ORIGINAL size so centers never drift); dims too thin to
 * survive the shrink keep their exact size. Render-only: symbols,
 * footprints, and collision all derive from the item defs, never from
 * these geometries.
 */
export interface RealizedItem {
  groups: { mat: string; geometry: BufferGeometry }[]
}

const cache = new Map<string, RealizedItem>()

/** Per-side seam shrink (m) — 0.5 mm, invisible at any viewing distance. */
export const SEAM_EPS = 0.0005
/** Dims at or below this (5 mm) keep their exact size — thin panels and
 * hairline reveals must never invert or visibly slim down. */
const MIN_SHRINKABLE = SEAM_EPS * 10

const inset = (v: number): number => (v > MIN_SHRINKABLE ? v - 2 * SEAM_EPS : v)

function partGeometry(p: Part): BufferGeometry {
  let geo: BufferGeometry
  if (p.kind === 'box') {
    const sx = inset(p.size[0])
    const sy = inset(p.size[1])
    const sz = inset(p.size[2])
    geo =
      p.round && p.round > 0
        ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(p.round, Math.min(sx, sy, sz) / 2))
        : new BoxGeometry(sx, sy, sz)
    if (p.rot) geo.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...p.rot)))
    // ORIGINAL half-height — the inset box stays centered in its authored slot
    geo.translate(p.at[0], p.at[1], p.at[2] + p.size[2] / 2)
  } else {
    const r = p.r > MIN_SHRINKABLE ? p.r - SEAM_EPS : p.r
    geo = new CylinderGeometry(r, r, inset(p.h), 24)
    // CylinderGeometry's height runs along +Y; reorient per axis
    const axis = p.axis ?? 'z'
    if (axis === 'z') geo.rotateX(Math.PI / 2)
    else if (axis === 'x') geo.rotateZ(Math.PI / 2)
    if (p.scale) geo.scale(p.scale[0], p.scale[1], p.scale[2])
    // ORIGINAL height keeps the authored center (see the box branch)
    const h = axis === 'z' ? p.h * (p.scale?.[2] ?? 1) : 0
    geo.translate(p.at[0], p.at[1], p.at[2] + h / 2)
  }
  // mergeGeometries requires all-indexed or all-non-indexed; RoundedBox is
  // non-indexed while Box/Cylinder are indexed — normalize so any slot mix merges
  if (geo.index) {
    const soup = geo.toNonIndexed()
    geo.dispose()
    return soup
  }
  return geo
}

export function realizeItem(item: CatalogItem, opts?: { mirrored?: boolean }): RealizedItem {
  const key = opts?.mirrored ? `${item.id}|m` : item.id
  const hit = cache.get(key)
  if (hit) return hit

  let parts = collectParts((b) => item.build3d(b, item.dims))
  if (opts?.mirrored) parts = parts.map(mirrorPart)
  const bySlot = new Map<string, BufferGeometry[]>()
  for (const p of parts) {
    ;(bySlot.get(p.mat) ?? bySlot.set(p.mat, []).get(p.mat)!).push(partGeometry(p))
  }
  const groups: RealizedItem['groups'] = []
  for (const [mat, geos] of bySlot) {
    const merged = mergeGeometries(geos, false)
    if (merged) groups.push({ mat, geometry: merged })
    else console.warn(`realizeItem: slot merge failed — dropping '${mat}' of ${item.id}`)
    for (const g of geos) g.dispose()
  }
  const realized: RealizedItem = { groups }
  cache.set(key, realized)
  return realized
}
