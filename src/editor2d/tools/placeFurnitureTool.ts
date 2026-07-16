import type { Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, rotate } from '../../geometry/vec'
import { resolveSnap, type SnapResult } from '../../geometry/snapping'
import { alignmentGuideCandidates, wallBackCandidate } from '../snap/candidates'
import { useAppSettings } from '../../store/appSettings'
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
  let mirrored = false
  let armedFor: string | null = null

  // ghost rotation/mirror belong to ONE armed item: re-arming with a
  // different card must reset them (switchTool skips onDeactivate when the
  // tool is already active, so the tool tracks the item change itself)
  const syncArmedItem = (ctx: ToolContext): void => {
    const id = ctx.ui().toolParams.catalogItemId
    if (id !== armedFor) {
      armedFor = id
      rotation = 0
      mirrored = false
    }
  }

  const ghost = (ctx: ToolContext, world: Vec2): SnapResult | null => {
    syncArmedItem(ctx)
    const itemId = ctx.ui().toolParams.catalogItemId
    const item = itemId ? CATALOG[itemId] : null
    if (!item) return null
    const doc = ctx.doc()
    // guide extents must reflect the EFFECTIVE rotation — wall snap can
    // impose one (snap.rotation); the previous frame's resolution is the
    // best available before this frame's resolveSnap runs
    const effRot = lastSnap?.rotation ?? rotation
    const quarter = Math.round(effRot / (Math.PI / 2)) % 2 !== 0
    const candidates = [
      ...alignmentGuideCandidates(
        doc,
        {
          hw: (quarter ? item.dims.d : item.dims.w) / 2,
          hh: (quarter ? item.dims.w : item.dims.d) / 2,
          rotation: effRot,
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
      enabled: useAppSettings.getState().snapEnabled,
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
    ctx.interaction().set({
      preview: {
        kind: 'ghost',
        polygon: corners,
        valid: true,
        furniture: { itemId: item.id, at: snap.point, rot, mirrored },
      },
      snap,
    })
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
      elevation: item.defaultElevation ?? 0,
      ...(mirrored ? { mirrored: true } : {}),
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
      syncArmedItem(ctx)
      // the keymap offers R/F to the tool BEFORE the global rotate/flip
      // handlers — placement selects the dropped item, which would otherwise
      // shadow the ghost forever after the first drop. The raw key carries
      // shift ('R' = counter-rotate, mirroring the selection's Shift+R).
      const k = key.toLowerCase()
      if ((k === 'r' || k === 'f') && ctx.ui().toolParams.catalogItemId) {
        if (k === 'r') rotation += key === 'R' ? -Math.PI / 2 : Math.PI / 2
        else mirrored = !mirrored
        // refresh the ghost in place — otherwise the preview shows the OLD
        // orientation until the next pointermove while a click would place
        // with the new one
        const pw = ctx.interaction().pointerWorld
        if (pw) ghost(ctx, pw)
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
      mirrored = false
      armedFor = null
    },
  }
}
