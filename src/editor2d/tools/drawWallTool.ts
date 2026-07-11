import type { EditorPointerEvent, Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { dist } from '../../geometry/vec'
import { resolveSnap, type SnapResult } from '../../geometry/snapping'
import {
  angleRayCandidates,
  gridCandidate,
  nodeCandidates,
  wallPointCandidates,
} from '../snap/candidates'
import { safeUndo } from '../../store/transactions'

/**
 * Click-click wall drawing. Each click commits ONE segment (one undo entry
 * per segment — plan-pinned); the rubber band previews the next.
 * Esc drops the rubber band only; Backspace steps back one segment;
 * Enter / double-click / closing the loop ends the chain.
 */
interface ChainState {
  anchor: Vec2 | null
  start: Vec2 | null
  segments: number
  history: Vec2[]
  lastSnap: SnapResult | null
  lastClick: { at: Vec2; time: number } | null
}

const fresh = (): ChainState => ({
  anchor: null,
  start: null,
  segments: 0,
  history: [],
  lastSnap: null,
  lastClick: null,
})

export function createDrawWallTool(): Tool {
  let chain = fresh()

  const snapAt = (e: EditorPointerEvent, ctx: ToolContext): SnapResult => {
    const doc = ctx.doc()
    const candidates = [
      ...nodeCandidates(doc),
      ...wallPointCandidates(doc, e.world),
      gridCandidate(doc, 1 / ctx.pxToWorld()),
      ...(chain.anchor ? angleRayCandidates(chain.anchor) : []),
    ]
    const result = resolveSnap(e.world, candidates, {
      pxToWorld: ctx.pxToWorld(),
      enabled: doc.settings.snapEnabled && !e.mods.ctrl,
      ...(chain.lastSnap ? { prev: chain.lastSnap } : {}),
    })
    chain.lastSnap = result
    return result
  }

  const updatePreview = (ctx: ToolContext, cursor: Vec2 | null, snap: SnapResult | null) => {
    const doc = ctx.doc()
    const pills = []
    let angleBadge: string | undefined
    if (chain.anchor && cursor) {
      const len = dist(chain.anchor, cursor)
      if (len > 0.01) {
        pills.push({
          at: { x: (chain.anchor.x + cursor.x) / 2, y: (chain.anchor.y + cursor.y) / 2 },
          text: doc.settings.unitDisplay === 'cm' ? `${Math.round(len * 100)} cm` : `${len.toFixed(2)} m`,
        })
      }
      if (snap?.constraint?.kind === 'ray') {
        const deg = Math.round(
          ((Math.atan2(snap.constraint.dir.y, snap.constraint.dir.x) * 180) / Math.PI + 360) % 360,
        )
        angleBadge = `${deg}°`
      }
    }
    ctx.interaction().set({
      preview: {
        kind: 'wallDraw',
        anchor: chain.anchor,
        cursor,
        thickness: doc.settings.defaultWallThickness,
        ...(angleBadge ? { angleBadge } : {}),
      },
      snap,
      pills,
    })
  }

  const endChain = (ctx: ToolContext) => {
    chain = fresh()
    ctx.interaction().clear()
  }

  return {
    id: 'draw-wall',
    cursor: () => 'crosshair',

    onPointerMove(e, ctx) {
      updatePreview(ctx, snapAt(e, ctx).point, chain.lastSnap)
    },

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      const snap = snapAt(e, ctx)
      const p = snap.point
      const now = performance.now()

      // double-click (2nd click, <300ms, <4px screen) ends the chain
      if (
        chain.lastClick &&
        now - chain.lastClick.time < 300 &&
        dist(chain.lastClick.at, p) < 4 * ctx.pxToWorld()
      ) {
        endChain(ctx)
        return
      }
      chain.lastClick = { at: p, time: now }

      if (!chain.anchor) {
        chain.anchor = p
        chain.start = p
        updatePreview(ctx, p, snap)
        return
      }
      // closing the loop: click near the chain start with ≥2 segments
      const closing =
        chain.start && chain.segments >= 2 && dist(p, chain.start) < 10 * ctx.pxToWorld()
      const target = closing ? chain.start! : p
      const r = ctx.actions().addWallSegment(chain.anchor, target)
      if (r.wallId) {
        chain.history.push(chain.anchor)
        chain.segments++
      }
      if (closing) {
        endChain(ctx)
      } else {
        chain.anchor = p
        updatePreview(ctx, p, snap)
      }
    },

    onPointerUp() {},

    onDoubleClick(_, ctx) {
      endChain(ctx)
    },

    onKeyDown(key, ctx) {
      if (key === 'Enter') {
        endChain(ctx)
        return true
      }
      if (key === 'Escape') {
        if (chain.anchor) {
          // drop the rubber band only; committed segments stay
          endChain(ctx)
          return true
        }
        return false // bubble to the keymap ladder (switch to select)
      }
      if (key === 'Backspace') {
        if (chain.segments > 0) {
          safeUndo()
          chain.anchor = chain.history.pop() ?? null
          chain.segments--
          if (!chain.anchor) endChain(ctx)
          return true
        }
        return chain.anchor !== null
      }
      return false
    },

    onDeactivate(ctx) {
      endChain(ctx)
    },
  }
}
