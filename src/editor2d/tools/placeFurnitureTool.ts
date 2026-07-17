import type { Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, rotate } from '../../geometry/vec'
import { WINDOW_PICK_PX, resolveSnap, type SnapResult } from '../../geometry/snapping'
import { alignmentGuideCandidates, wallBackCandidate } from '../snap/candidates'
import {
  findWindowNear,
  windowAttachTransform,
  type AttachedTransform,
} from '../../model/mutations/attachment'
import type { Window } from '../../model/types'
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
  // windowAttach capture from the last ghost frame — placeAt attaches to it
  let lastWindow: Window | null = null
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
      lastWindow = null
    }
  }

  /** Ghost polygon + preview for an explicit transform (window capture). */
  const attachGhost = (
    ctx: ToolContext,
    itemId: string,
    at: AttachedTransform,
    depth: number,
  ): void => {
    const hw = at.width / 2
    const hh = depth / 2
    const center = { x: at.x, y: at.y }
    const corners: Vec2[] = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((p) => add(center, rotate(p, at.rotation)))
    ctx.interaction().set({
      preview: {
        kind: 'ghost',
        polygon: corners,
        valid: true,
        furniture: { itemId, at: center, rot: at.rotation, mirrored },
      },
      snap: null,
    })
  }

  const ghost = (ctx: ToolContext, world: Vec2): SnapResult | null => {
    syncArmedItem(ctx)
    const itemId = ctx.ui().toolParams.catalogItemId
    const item = itemId ? CATALOG[itemId] : null
    if (!item) return null
    const doc = ctx.doc()
    // windowAttach capture outranks wall/guide snapping: near a window the
    // ghost sits reveal-aligned on the cursor's side of the wall
    if (item.windowAttach) {
      const win = findWindowNear(doc, world, WINDOW_PICK_PX * ctx.pxToWorld())
      const at = win ? windowAttachTransform(doc, win, world, item.dims.d) : null
      if (win && at) {
        lastWindow = win
        lastSnap = null
        attachGhost(ctx, item.id, at, item.dims.d)
        return null
      }
      lastWindow = null
    }
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
    if (lastWindow) {
      // ghost captured a window this frame — place attached
      const at = windowAttachTransform(ctx.doc(), lastWindow, world, item.dims.d)
      if (at) {
        const id = ctx.actions().addFurniture({
          catalogItemId: item.id,
          x: at.x,
          y: at.y,
          rotation: at.rotation,
          size: { w: at.width, d: item.dims.d, h: item.dims.h },
          elevation: item.defaultElevation ?? 0,
          attachedOpeningId: lastWindow.id,
          ...(mirrored ? { mirrored: true } : {}),
        })
        ctx.ui().setSelection([id])
        return
      }
    }
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
        lastWindow = null
        return false // bubble: ladder switches back to select
      }
      return false
    },

    onDeactivate(ctx) {
      ctx.ui().setToolParams({ catalogItemId: null })
      ctx.interaction().clear()
      lastSnap = null
      lastWindow = null
      rotation = 0
      mirrored = false
      armedFor = null
    },
  }
}
