import type { Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, rotate } from '../../geometry/vec'
import { resolveSnap, type SnapResult } from '../../geometry/snapping'
import { alignmentGuideCandidates, wallBackCandidate } from '../snap/candidates'
import { CATALOG } from '../../catalog'

/**
 * Click-to-place furniture (plan-pinned): a catalog card click arms this
 * tool (ui.toolParams.catalogItemId); the canvas shows the same footprint
 * ghost + snapping as the drag path; each click places and STAYS armed
 * (chair rows). Esc/V exits; clicking the armed card again disarms.
 * The drag-from-catalog path is driven by CatalogPanel via placeAt().
 */
export function createPlaceFurnitureTool(): Tool {
  let lastSnap: SnapResult | null = null
  let rotation = 0

  const ghost = (ctx: ToolContext, world: Vec2): SnapResult | null => {
    const itemId = ctx.ui().toolParams.catalogItemId
    const item = itemId ? CATALOG[itemId] : null
    if (!item) return null
    const doc = ctx.doc()
    const quarter = Math.round(rotation / (Math.PI / 2)) % 2 !== 0
    const candidates = [
      ...alignmentGuideCandidates(
        doc,
        {
          hw: (quarter ? item.dims.d : item.dims.w) / 2,
          hh: (quarter ? item.dims.w : item.dims.d) / 2,
          rotation,
        },
        new Set(),
      ),
      ...(item.wallSnap
        ? [wallBackCandidate(doc, ctx.derived(), world, item.dims.d)].filter(
            (c): c is NonNullable<typeof c> => c !== null,
          )
        : []),
    ]
    const snap = resolveSnap(world, candidates, {
      pxToWorld: ctx.pxToWorld(),
      enabled: doc.settings.snapEnabled,
      ...(lastSnap ? { prev: lastSnap } : {}),
    })
    lastSnap = snap
    const rot = snap.rotation ?? rotation
    const hw = item.dims.w / 2
    const hh = item.dims.d / 2
    const corners: Vec2[] = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((p) => add(snap.point, rotate(p, rot)))
    ctx.interaction().set({ preview: { kind: 'ghost', polygon: corners, valid: true }, snap })
    return snap
  }

  const placeAt = (ctx: ToolContext, world: Vec2): void => {
    const itemId = ctx.ui().toolParams.catalogItemId
    const item = itemId ? CATALOG[itemId] : null
    if (!item) return
    const snap = ghost(ctx, world)
    if (!snap) return
    const id = ctx.actions().addFurniture({
      catalogItemId: item.id,
      x: snap.point.x,
      y: snap.point.y,
      rotation: snap.rotation ?? rotation,
      size: { ...item.dims },
    })
    ctx.ui().setSelection([id])
  }

  return {
    id: 'place-furniture',
    cursor: () => 'copy',

    onPointerMove(e, ctx) {
      ghost(ctx, e.world)
    },

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      placeAt(ctx, e.world) // stays armed for repeated placement
    },

    onPointerUp() {},

    onKeyDown(key, ctx) {
      if (key.toLowerCase() === 'r') {
        rotation += Math.PI / 2
        return true
      }
      if (key === 'Escape') {
        ctx.ui().setToolParams({ catalogItemId: null })
        ctx.interaction().clear()
        lastSnap = null
        return false // bubble: ladder switches back to select
      }
      return false
    },

    onDeactivate(ctx) {
      ctx.ui().setToolParams({ catalogItemId: null })
      ctx.interaction().clear()
      lastSnap = null
      rotation = 0
    },
  }
}
