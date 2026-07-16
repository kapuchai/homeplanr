import type { EditorPointerEvent, Tool, ToolContext } from './toolTypes'
import type { Vec2 } from '../../geometry/vec'
import { add, dist, lerp, normalize, perp, scale, sub } from '../../geometry/vec'
import { resolveSnap, type SnapResult } from '../../geometry/snapping'
import {
  angleRayCandidates,
  gridCandidate,
  nodeCandidates,
  wallPointCandidates,
} from '../snap/candidates'
import { useAppSettings } from '../../store/appSettings'
import { formatLength } from '../../format/units'
import { PILL_OFFSET_PX } from '../measure/liveMeasurements'
import type { DimensionPill } from '../session/interactionStore'

/**
 * Tape measure: click two points for a read-only measurement pill; the next
 * click starts a fresh one. Snaps like draw-wall (nodes, wall points, grid,
 * angle rays from the first point). NEVER opens a transaction or touches the
 * document — Esc clears the pending point, then the frozen result.
 */
interface MeasureState {
  a: Vec2 | null
  b: Vec2 | null
  lastSnap: SnapResult | null
}

const fresh = (): MeasureState => ({ a: null, b: null, lastSnap: null })

export function createMeasureTool(): Tool {
  let state = fresh()

  const snapAt = (e: EditorPointerEvent, ctx: ToolContext): SnapResult => {
    const doc = ctx.doc()
    const anchor = state.b === null ? state.a : null // rays only while pending
    const candidates = [
      ...nodeCandidates(doc),
      ...wallPointCandidates(doc, e.world),
      gridCandidate(doc, 1 / ctx.pxToWorld()),
      ...(anchor ? angleRayCandidates(anchor) : []),
    ]
    const result = resolveSnap(e.world, candidates, {
      pxToWorld: ctx.pxToWorld(),
      enabled: useAppSettings.getState().snapEnabled && !e.mods.ctrl,
      ...(state.lastSnap ? { prev: state.lastSnap } : {}),
    })
    state.lastSnap = result
    return result
  }

  const pill = (a: Vec2, b: Vec2, ctx: ToolContext): DimensionPill | null => {
    const len = dist(a, b)
    if (len < 0.01) return null
    const off = scale(perp(normalize(sub(b, a))), PILL_OFFSET_PX * ctx.pxToWorld())
    return {
      at: add(lerp(a, b, 0.5), off),
      text: formatLength(len, useAppSettings.getState().units),
      from: a,
      to: b,
      tone: 'measure',
    }
  }

  const reset = (ctx: ToolContext) => {
    state = fresh()
    ctx.interaction().clear()
  }

  return {
    id: 'measure',
    cursor: () => 'crosshair',

    onPointerMove(e, ctx) {
      const snap = snapAt(e, ctx)
      if (state.a && !state.b) {
        const live = pill(state.a, snap.point, ctx)
        ctx.interaction().set({ snap, pills: live ? [live] : [] })
        return
      }
      // idle or frozen: hover snap only — a frozen pill stays as published
      ctx.interaction().set({ snap })
    },

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      const snap = snapAt(e, ctx)
      if (state.a && !state.b) {
        // 2nd click freezes the measurement
        state.b = snap.point
        const frozen = pill(state.a, state.b, ctx)
        ctx.interaction().set({ snap, pills: frozen ? [frozen] : [] })
        return
      }
      // 1st click — or a 3rd starting fresh over a frozen result
      state.a = snap.point
      state.b = null
      ctx.interaction().set({ snap, pills: [] })
    },

    onPointerUp() {},

    onKeyDown(key, ctx) {
      if (key === 'Enter') {
        // freeze → persist: the measurement becomes a dimension annotation
        // (offset 0 — the line stays where the tape was), selected for
        // immediate offset-drag or delete
        if (state.a && state.b) {
          const id = ctx.actions().addDimension(state.a, state.b, 0)
          if (id) {
            ctx.ui().setSelection([id])
            // persisting into a hidden layer would look like a dead Enter —
            // creating an annotation re-enables visibility (0.7.0)
            const settings = useAppSettings.getState()
            if (!settings.showAnnotations) settings.setShowAnnotations(true)
          }
          reset(ctx) // even a sub-cm (rejected) freeze is consumed
          return true
        }
        return false
      }
      if (key === 'Escape') {
        if (state.a) {
          // pending point or frozen measurement — either way, wipe it
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
