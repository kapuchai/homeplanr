import type { Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, normalize, perp, scale, sub } from '../../geometry/vec'
import { closestPointOnSegment, distToSegment } from '../../geometry/segment'
import { findOpeningSlot } from '../../model/mutations/openings'
import { DEFAULTS } from '../../model/types'
import type { WallId } from '../../model/ids'

/**
 * Place doors/windows (one parameterized tool — ui.toolParams.openingKind).
 * The ghost slides along the nearest wall (within 14px), clamped by the
 * SAME oracle the mutation uses (findOpeningSlot) so the ghost can never
 * show a placement the commit would reject. Click commits and STAYS armed
 * (door rows); Esc/right-click → select (via keymap ladder / Editor2D).
 */
const WALL_PICK_PX = 14

export function createPlaceOpeningTool(): Tool {
  let hover: { wallId: WallId; u: number; valid: boolean } | null = null

  const ghost = (ctx: ToolContext, e: { world: Vec2 }) => {
    const doc = ctx.doc()
    const px = ctx.pxToWorld()
    const kind = ctx.ui().toolParams.openingKind
    const width = kind === 'door' ? DEFAULTS.door.width : DEFAULTS.window.width

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
    const slot = findOpeningSlot(doc, best.wallId, best.u, width)
    const u = slot ?? best.u
    const valid = slot !== null
    hover = { wallId: best.wallId, u, valid }

    // ghost rectangle in world coords (wall-aligned)
    const half = w.thickness / 2 + 0.02
    const p = (uu: number, v: number) => add(add(na, scale(dir, uu)), scale(perp(dir), v))
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
      if (kind === 'door') {
        // swing side = the side of the centerline the cursor is on
        const dir = normalize(sub(nb, na))
        const v = (e.world.x - na.x) * dir.y - (e.world.y - na.y) * dir.x
        ctx.actions().addOpening({
          kind: 'door',
          wallId: hover.wallId,
          t: hover.u / L,
          swing: v >= 0 ? 'front' : 'back',
        })
      } else {
        ctx.actions().addOpening({ kind: 'window', wallId: hover.wallId, t: hover.u / L })
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
