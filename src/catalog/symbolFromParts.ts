import { collectParts, type Part } from './builder'
import type { CatalogItem, SymbolPrim, SymbolRole } from './types'

/**
 * Derive an item's top-view symbol FROM ITS 3D PARTS (M6 gate, user idea):
 * one authoring source — the 2D plan drawing is the plan projection of the
 * exact geometry the 3D view renders, so the two can never drift and every
 * item automatically "looks right" (a toilet reads as tank + bowl, etc.).
 *
 * silhouette + body roles: the footprint layer — one strong-stroke prim and
 * one paper-fill prim per unique part footprint (0.7.0: the old single bbox
 * mask lied about L-shapes and circles). Renderers draw them inside ONE
 * flattened-opacity group, fills after strokes: every stroke segment
 * interior to the part union is covered by a fill, so the strong border
 * survives only along the union boundary — a poor man's polygon union with
 * zero geometry code.
 * detail role: each part's plan outline as a hairline, lower parts first.
 * Per-part `symbol` hints (builder.ts) adjust the projection: 'omit' skips
 * a part, 'outline' promotes it to the outline role. Near-duplicate prims
 * (stacked parts with the same plan footprint, e.g. cabinet body + door
 * front) are deduped at 1mm quantization — first (lowest) wins.
 */
const cache = new Map<string, SymbolPrim[]>()

/** 1mm quantization for dedup keys. */
const q = (n: number) => Math.round(n * 1000)

/**
 * A part's plan projection plus its dedup key. The key is computed from the
 * SOURCE geometry (not the formatted d string), at 1mm quantization and
 * role-blind — identical plan footprints render identically enough that a
 * later duplicate (stacked parts, body + door front) is pure clutter.
 */
function partPrim(p: Part): { prim: SymbolPrim; key: string } {
  const role: SymbolRole = p.symbol === 'outline' ? 'outline' : 'detail'
  if (p.kind === 'cylinder') {
    const s = p.scale ?? [1, 1, 1]
    const axis = p.axis ?? 'z'
    if (axis === 'z') {
      const rx = p.r * s[0]
      const ry = p.r * s[1]
      const [cx, cy] = p.at
      // ellipse as two arcs
      return {
        prim: {
          kind: 'path',
          d: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`,
          role,
        },
        key: `e|${q(cx)}|${q(cy)}|${q(rx)}|${q(ry)}`,
      }
    }
    // lying cylinders: plan bbox
    const ex = axis === 'x' ? (p.h * s[0]) / 2 : p.r * s[0]
    const ey = axis === 'y' ? (p.h * s[1]) / 2 : p.r * s[1]
    return {
      prim: { kind: 'rect', x: p.at[0] - ex, y: p.at[1] - ey, w: ex * 2, h: ey * 2, role },
      key: `r|${q(p.at[0] - ex)}|${q(p.at[1] - ey)}|${q(ex * 2)}|${q(ey * 2)}|0`,
    }
  }
  const [sx, sy] = p.size
  const rz = p.rot?.[2] ?? 0
  if (Math.abs(rz) < 1e-9) {
    const rx = p.round ? Math.min(p.round, Math.min(sx, sy) / 2) : 0
    return {
      prim: {
        kind: 'rect',
        x: p.at[0] - sx / 2,
        y: p.at[1] - sy / 2,
        w: sx,
        h: sy,
        ...(rx ? { rx } : {}),
        role,
      },
      key: `r|${q(p.at[0] - sx / 2)}|${q(p.at[1] - sy / 2)}|${q(sx)}|${q(sy)}|${q(rx)}`,
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
    prim: {
      kind: 'path',
      d: `M ${corners.map((pt) => `${pt[0]} ${pt[1]}`).join(' L ')} Z`,
      role,
    },
    key: `p|${corners.map((pt) => `${q(pt[0]!)},${q(pt[1]!)}`).join('|')}`,
  }
}

export function symbolFor(item: CatalogItem): SymbolPrim[] {
  const hit = cache.get(item.id)
  if (hit) return hit

  const parts = collectParts((b) => item.build3d(b, item.dims))
  const mapped = parts
    .filter((p) => p.symbol !== 'omit')
    .sort((a, b) => a.at[2] - b.at[2]) // lower parts first, top parts on top
    .map(partPrim)

  // near-duplicate dedup — first (lowest part) wins; 'outline' survives a
  // tie against a plain detail twin so the hint cannot be shadowed
  const byKey = new Map<string, SymbolPrim>()
  for (const { prim, key } of mapped) {
    const kept = byKey.get(key)
    if (!kept) byKey.set(key, prim)
    else if (kept.role === 'detail' && prim.role === 'outline') byKey.set(key, prim)
  }

  // footprint layer: silhouette stroke + paper fill per unique shape, reusing
  // the deduped stroke-prim geometry (roles overridden)
  const silhouettes: SymbolPrim[] = []
  const bodies: SymbolPrim[] = []
  for (const p of byKey.values()) {
    silhouettes.push({ ...p, role: 'silhouette' })
    bodies.push({ ...p, role: 'body' })
  }

  // hand-authored annotation prims (0.13.0: stair direction arrows) go
  // LAST — on top of the derived body, through the same styling path
  const extra = item.symbol2d?.(item.dims) ?? []
  const prims: SymbolPrim[] = [...silhouettes, ...bodies, ...byKey.values(), ...extra]
  cache.set(item.id, prims)
  return prims
}
