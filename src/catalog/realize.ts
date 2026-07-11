import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Euler,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { collectParts, type Part } from './builder'
import type { CatalogItem } from './types'

/**
 * Realize a catalog item's part list into merged BufferGeometries —
 * ONE geometry per material slot per item (a sofa = 2 draw calls), cached
 * per item id for the app lifetime; every scene instance shares them.
 *
 * Parts are authored in item-local plan-style coords (x right, y depth,
 * z up) and the geometries stay in that frame — the r3f plan group's
 * rotation handles world orientation.
 */
export interface RealizedItem {
  groups: { mat: string; geometry: BufferGeometry }[]
}

const cache = new Map<string, RealizedItem>()

function partGeometry(p: Part): BufferGeometry {
  let geo: BufferGeometry
  if (p.kind === 'box') {
    geo =
      p.round && p.round > 0
        ? new RoundedBoxGeometry(p.size[0], p.size[1], p.size[2], 2, Math.min(p.round, Math.min(...p.size) / 2))
        : new BoxGeometry(p.size[0], p.size[1], p.size[2])
    if (p.rot) geo.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...p.rot)))
    geo.translate(p.at[0], p.at[1], p.at[2] + p.size[2] / 2)
  } else {
    geo = new CylinderGeometry(p.r, p.r, p.h, 24)
    // CylinderGeometry's height runs along +Y; reorient per axis
    const axis = p.axis ?? 'z'
    if (axis === 'z') geo.rotateX(Math.PI / 2)
    else if (axis === 'x') geo.rotateZ(Math.PI / 2)
    if (p.scale) geo.scale(p.scale[0], p.scale[1], p.scale[2])
    const h = axis === 'z' ? p.h * (p.scale?.[2] ?? 1) : 0
    geo.translate(p.at[0], p.at[1], p.at[2] + h / 2)
  }
  return geo
}

export function realizeItem(item: CatalogItem): RealizedItem {
  const hit = cache.get(item.id)
  if (hit) return hit

  const parts = collectParts((b) => item.build3d(b, item.dims))
  const bySlot = new Map<string, BufferGeometry[]>()
  for (const p of parts) {
    ;(bySlot.get(p.mat) ?? bySlot.set(p.mat, []).get(p.mat)!).push(partGeometry(p))
  }
  const groups: RealizedItem['groups'] = []
  for (const [mat, geos] of bySlot) {
    const merged = mergeGeometries(geos, false)
    if (merged) groups.push({ mat, geometry: merged })
    for (const g of geos) g.dispose()
  }
  const realized: RealizedItem = { groups }
  cache.set(item.id, realized)
  return realized
}
