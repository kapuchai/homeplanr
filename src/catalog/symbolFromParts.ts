import { collectParts, type Part } from './builder'
import type { CatalogItem, SymbolPrim } from './types'

/**
 * Derive an item's top-view symbol FROM ITS 3D PARTS (M6 gate, user idea):
 * one authoring source — the 2D plan drawing is the plan projection of the
 * exact geometry the 3D view renders, so the two can never drift and every
 * item automatically "looks right" (a toilet reads as tank + bowl, etc.).
 *
 * body role: the footprint rect (paper mask over room fills);
 * detail role: each part's plan outline as a hairline, lower parts first.
 */
const cache = new Map<string, SymbolPrim[]>()

function partPrim(p: Part): SymbolPrim {
  if (p.kind === 'cylinder') {
    const s = p.scale ?? [1, 1, 1]
    const axis = p.axis ?? 'z'
    if (axis === 'z') {
      const rx = p.r * s[0]
      const ry = p.r * s[1]
      const [cx, cy] = p.at
      // ellipse as two arcs
      return {
        kind: 'path',
        d: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`,
        role: 'detail',
      }
    }
    // lying cylinders: plan bbox
    const ex = axis === 'x' ? (p.h * s[0]) / 2 : p.r * s[0]
    const ey = axis === 'y' ? (p.h * s[1]) / 2 : p.r * s[1]
    return { kind: 'rect', x: p.at[0] - ex, y: p.at[1] - ey, w: ex * 2, h: ey * 2, role: 'detail' }
  }
  const [sx, sy] = p.size
  const rz = p.rot?.[2] ?? 0
  if (Math.abs(rz) < 1e-9) {
    return {
      kind: 'rect',
      x: p.at[0] - sx / 2,
      y: p.at[1] - sy / 2,
      w: sx,
      h: sy,
      ...(p.round ? { rx: Math.min(p.round, Math.min(sx, sy) / 2) } : {}),
      role: 'detail',
    }
  }
  // z-rotated box: exact rotated footprint polygon
  const c = Math.cos(rz)
  const s = Math.sin(rz)
  const corners = [
    [-sx / 2, -sy / 2],
    [sx / 2, -sy / 2],
    [sx / 2, sy / 2],
    [-sx / 2, sy / 2],
  ].map(([x, y]) => [p.at[0] + x! * c - y! * s, p.at[1] + x! * s + y! * c])
  return {
    kind: 'path',
    d: `M ${corners.map((q) => `${q[0]} ${q[1]}`).join(' L ')} Z`,
    role: 'detail',
  }
}

export function symbolFor(item: CatalogItem): SymbolPrim[] {
  const hit = cache.get(item.id)
  if (hit) return hit

  const parts = collectParts((b) => item.build3d(b, item.dims))
  const prims: SymbolPrim[] = [
    // footprint mask
    {
      kind: 'rect',
      x: -item.dims.w / 2,
      y: -item.dims.d / 2,
      w: item.dims.w,
      h: item.dims.d,
      rx: 0.015,
      role: 'body',
    },
    ...parts
      .slice()
      .sort((a, b) => a.at[2] - b.at[2]) // lower parts first, top parts on top
      .map(partPrim),
  ]
  cache.set(item.id, prims)
  return prims
}
