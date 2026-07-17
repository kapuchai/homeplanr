import type { Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, normalize, perp, scale, sub } from '../../geometry/vec'
import { closestPointOnSegment, distToSegment } from '../../geometry/segment'
import { findOpeningSlot } from '../../model/mutations/openings'
import { openingInk } from '../render/planGeometry'
import { openingStyleSpec, type OpeningStyleSpec } from '../../catalog/openingStyles'
import { OPENING_FLUSH_SNAP_PX, WALL_PICK_PX } from '../../geometry/snapping'
import { useAppSettings } from '../../store/appSettings'
import { DEFAULTS } from '../../model/types'
import type { WallId } from '../../model/ids'

/**
 * Place doors/windows (one parameterized tool — ui.toolParams.openingKind).
 * The ghost slides along the nearest wall (within 14px), clamped by the
 * SAME oracle the mutation uses (findOpeningSlot) so the ghost can never
 * show a placement the commit would reject. Click commits and STAYS armed
 * (door rows); Esc/right-click → select (via keymap ladder / Editor2D).
 */
/** Swing side = the side of the centerline the cursor is on ('front' = +perp of a→b). */
const swingFor = (world: Vec2, na: Vec2, dir: Vec2): 'front' | 'back' => {
  const v = (world.x - na.x) * dir.y - (world.y - na.y) * dir.x
  return v >= 0 ? 'front' : 'back'
}

/** The armed style spec (per-kind memory in toolParams; absent = standard). */
const armedStyle = (ctx: ToolContext): OpeningStyleSpec => {
  const params = ctx.ui().toolParams
  const kind = params.openingKind
  return openingStyleSpec(kind, kind === 'door' ? params.doorStyle : params.windowStyle)
}

export function createPlaceOpeningTool(): Tool {
  let hover: { wallId: WallId; u: number; valid: boolean } | null = null

  const ghost = (ctx: ToolContext, e: { world: Vec2; mods?: { ctrl: boolean } }) => {
    const doc = ctx.doc()
    const px = ctx.pxToWorld()
    const kind = ctx.ui().toolParams.openingKind
    const spec = armedStyle(ctx)
    const width =
      spec.defaults?.width ?? (kind === 'door' ? DEFAULTS.door.width : DEFAULTS.window.width)

    // nearest wall within pick radius
    let best: { wallId: WallId; d: number; u: number } | null = null
    for (const w of Object.values(doc.walls)) {
      const na = doc.nodes[w.a]
      const nb = doc.nodes[w.b]
      if (!na || !nb) continue
      const d = distToSegment(e.world, na, nb)
      if (d <= w.thickness / 2 + WALL_PICK_PX * px && (!best || d < best.d)) {
        const { t } = closestPointOnSegment(e.world, na, nb)
        const L = Math.hypot(nb.x - na.x, nb.y - na.y)
        best = { wallId: w.id, d, u: t * L }
      }
    }
    if (!best) {
      hover = null
      ctx.interaction().set({ preview: null, pills: [] })
      return
    }
    const w = doc.walls[best.wallId]!
    const na = doc.nodes[w.a]!
    const nb = doc.nodes[w.b]!
    const dir = normalize(sub(nb, na))
    // flush-snap (0.10.0) rides the same oracle call the commit re-runs —
    // a snapped ghost position is legal by construction, so the commit
    // keeps it. Ctrl suspends like every other snap.
    const snap = useAppSettings.getState().snapEnabled && !e.mods?.ctrl
    const slot = findOpeningSlot(doc, best.wallId, best.u, width, {
      snapRadius: snap ? OPENING_FLUSH_SNAP_PX * px : 0,
    })
    const u = slot ?? best.u
    const valid = slot !== null
    hover = { wallId: best.wallId, u, valid }

    // ghost rectangle in world coords (wall-aligned)
    const half = w.thickness / 2 + 0.02
    const p = (uu: number, v: number) => add(add(na, scale(dir, uu)), scale(perp(dir), v))
    // valid ghosts also preview the style-dispatched ink; door swing side
    // follows the cursor exactly like the click will commit it (same cross
    // product), and the pinned arc sweep flows through openingInk
    const ink = valid
      ? openingInk(
          p,
          u - width / 2,
          u + width / 2,
          w.thickness / 2,
          kind === 'door'
            ? {
                kind: 'door',
                hinge: DEFAULTS.door.hinge,
                swing: swingFor(e.world, na, dir),
                style: spec.id,
              }
            : { kind: 'window', style: spec.id },
        )
      : undefined
    ctx.interaction().set({
      preview: {
        kind: 'ghost',
        polygon: [
          p(u - width / 2, -half),
          p(u + width / 2, -half),
          p(u + width / 2, half),
          p(u - width / 2, half),
        ],
        valid,
        ...(ink ? { openingInk: ink } : {}),
      },
      pills: [],
    })
  }

  return {
    id: 'place-opening',
    cursor: () => 'crosshair',

    onPointerMove(e, ctx) {
      ghost(ctx, e)
    },

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      ghost(ctx, e)
      if (!hover?.valid) return
      const doc = ctx.doc()
      const wall = doc.walls[hover.wallId]
      const na = wall && doc.nodes[wall.a]
      const nb = wall && doc.nodes[wall.b]
      if (!wall || !na || !nb) return
      const L = Math.hypot(nb.x - na.x, nb.y - na.y)
      const kind = ctx.ui().toolParams.openingKind
      // the armed style stamps itself + its dimension seeds (addOpening
      // drops 'standard' — absent IS standard)
      const spec = armedStyle(ctx)
      const seeds = {
        style: spec.id,
        ...(spec.defaults?.width !== undefined ? { width: spec.defaults.width } : {}),
        ...(spec.defaults?.height !== undefined ? { height: spec.defaults.height } : {}),
      }
      if (kind === 'door') {
        const dir = normalize(sub(nb, na))
        ctx.actions().addOpening({
          kind: 'door',
          wallId: hover.wallId,
          t: hover.u / L,
          swing: swingFor(e.world, na, dir),
          ...seeds,
        })
      } else {
        ctx.actions().addOpening({
          kind: 'window',
          wallId: hover.wallId,
          t: hover.u / L,
          ...seeds,
          ...(spec.defaults?.sillHeight !== undefined
            ? { sillHeight: spec.defaults.sillHeight }
            : {}),
        })
      }
      // stays armed for repeated placement
    },

    onPointerUp() {},

    onKeyDown(key, ctx) {
      if (key === 'Escape') {
        if (hover) {
          hover = null
          ctx.interaction().clear()
        }
        return false // bubble: keymap ladder switches back to select
      }
      return false
    },

    onDeactivate(ctx) {
      hover = null
      ctx.interaction().clear()
    },
  }
}
