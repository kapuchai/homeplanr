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
import { useAppSettings } from '../../store/appSettings'
import { formatArea } from '../../format/units'
import { area, centroid } from '../../geometry/polygon'
import type { AreaDrawPreview, DimensionPill } from '../session/interactionStore'

/**
 * Area tool ('A'): click-to-trace a polygon that persists as an 'area'
 * annotation. The trace lives in TOOL STATE — the doc sees ONE addArea
 * mutation on close (one undo entry; annotations skip the pipeline, so
 * per-click commits would be undo spam — the opposite of draw-wall).
 * Close = click the first vertex (≥3 points), double-click, or Enter.
 * Backspace pops the last point; Esc clears the whole trace. Snaps like
 * draw-wall (nodes, wall points, grid, angle rays from the last point) so
 * tracing a room is one click per corner.
 */

/** Screen px within which a click on the first vertex closes the loop. */
const CLOSE_TOL_PX = 10
/** Clicks this close (px) to the previous vertex are dropped as jitter —
 * also swallows the second press of a closing double-click. */
const DUP_TOL_PX = 4

export function createDrawAreaTool(): Tool {
  let points: Vec2[] = []
  let lastSnap: SnapResult | null = null

  const snapAt = (e: EditorPointerEvent, ctx: ToolContext): SnapResult => {
    const doc = ctx.doc()
    const anchor = points[points.length - 1] ?? null
    const candidates = [
      ...nodeCandidates(doc),
      ...wallPointCandidates(doc, e.world),
      gridCandidate(doc, 1 / ctx.pxToWorld()),
      ...(anchor ? angleRayCandidates(anchor) : []),
    ]
    const result = resolveSnap(e.world, candidates, {
      pxToWorld: ctx.pxToWorld(),
      enabled: useAppSettings.getState().snapEnabled && !e.mods.ctrl,
      ...(lastSnap ? { prev: lastSnap } : {}),
    })
    lastSnap = result
    return result
  }

  const nearFirst = (p: Vec2, ctx: ToolContext): boolean =>
    points.length >= 3 && dist(p, points[0]!) <= CLOSE_TOL_PX * ctx.pxToWorld()

  const publish = (ctx: ToolContext, snap: SnapResult, cursor: Vec2 | null): void => {
    const preview: AreaDrawPreview = {
      kind: 'areaDraw',
      points: [...points],
      cursor,
      closeHint: cursor !== null && nearFirst(cursor, ctx),
    }
    // live readout: the polygon the NEXT click would build
    const pills: DimensionPill[] = []
    if (cursor && points.length >= 2) {
      const poly = [...points, cursor]
      const a = area(poly)
      if (a > 0.005) {
        pills.push({
          at: centroid(poly),
          text: formatArea(a, useAppSettings.getState().units),
          tone: 'measure',
        })
      }
    }
    ctx.interaction().set({ preview, snap, pills })
  }

  const reset = (ctx: ToolContext): void => {
    points = []
    lastSnap = null
    ctx.interaction().clear()
  }

  /** One mutation on close; selects the annotation and un-hides the layer. */
  const closeTrace = (ctx: ToolContext): void => {
    const id = ctx.actions().addArea(points)
    if (id) {
      ctx.ui().setSelection([id])
      // closing into a hidden layer would look like the trace vanished —
      // creating an annotation re-enables visibility (0.7.0)
      const settings = useAppSettings.getState()
      if (!settings.showAnnotations) settings.setShowAnnotations(true)
    }
    // a degenerate (rejected) trace is consumed too — the tool never traps
    reset(ctx)
  }

  return {
    id: 'draw-area',
    cursor: () => 'crosshair',

    onPointerMove(e, ctx) {
      const snap = snapAt(e, ctx)
      publish(ctx, snap, snap.point)
    },

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      const snap = snapAt(e, ctx)
      if (nearFirst(snap.point, ctx)) {
        closeTrace(ctx)
        return
      }
      const last = points[points.length - 1]
      if (last && dist(last, snap.point) <= DUP_TOL_PX * ctx.pxToWorld()) return
      points.push(snap.point)
      publish(ctx, snap, snap.point)
    },

    onPointerUp() {},

    onDoubleClick(e, ctx) {
      // the double-click's presses were deduped above — close what stands
      if (points.length >= 3) closeTrace(ctx)
      void e
    },

    onKeyDown(key, ctx) {
      if (key === 'Enter') {
        if (points.length >= 3) {
          closeTrace(ctx)
          return true
        }
        return false
      }
      if (key === 'Backspace') {
        if (points.length) {
          points.pop()
          ctx.interaction().set({
            preview: { kind: 'areaDraw', points: [...points], cursor: null, closeHint: false },
            pills: [],
          })
          return true
        }
        return false
      }
      if (key === 'Escape') {
        if (points.length) {
          reset(ctx)
          return true
        }
        return false // bubble to the keymap ladder (switch to select)
      }
      return false
    },

    onDeactivate(ctx) {
      reset(ctx)
    },
  }
}
