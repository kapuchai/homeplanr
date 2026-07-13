import type { Tool, ToolContext } from './toolTypes'
import type { EntityRef } from '../hit/hitTest'
import { hitTestAll, hitTestRect } from '../hit/hitTest'
import type { Vec2 } from '../../geometry/vec'
import { add, dist, dot, normalize, perp, scale, sub } from '../../geometry/vec'
import { closestPointOnSegment } from '../../geometry/segment'
import { resolveSnap, type SnapResult } from '../../geometry/snapping'
import {
  alignmentGuideCandidates,
  gridCandidate,
  nodeCandidates,
  wallPointCandidates,
  wallBackCandidate,
} from '../snap/candidates'
import { beginTx, commitTx, abortTx, type TxToken } from '../../store/transactions'
import { useAppSettings } from '../../store/appSettings'
import { CATALOG } from '../../catalog'
import { rotateHandlePos, HANDLE_RADIUS_PX } from './handles'
import {
  furnitureDragPills,
  incidentWallIds,
  openingDragPills,
  wallLengthPills,
  type MeasureInput,
} from '../measure/liveMeasurements'
import type { AnnotationId, FurnitureId, NodeId, OpeningId, WallId } from '../../model/ids'

/**
 * Select/move tool — drag branches per hit kind (plan-pinned):
 * furniture (single grab-offset / multi rigid), rotate handle (15° detents,
 * Ctrl free), opening slide (clamped along its wall), wall perpendicular
 * translate, node drag with drop-on-node merge, empty-space drag = MARQUEE
 * select (0.3.0 — panning lives on Space/middle/right-drag in Editor2D).
 * Every entity drag is one transaction ⇒ one undo entry (marquee opens
 * none); Esc aborts (marquee Esc restores the prior selection).
 */
const SLOP_PX = 4

type DragState =
  | { kind: 'idle' }
  | {
      kind: 'pressed'
      hit: EntityRef | null
      screen: Vec2
      world: Vec2
      additive: boolean
    }
  | {
      kind: 'marquee'
      origin: Vec2
      /** Selection to restore on Esc-cancel. */
      prev: string[]
      /** Union base for additive (Shift) marquees; [] otherwise. */
      base: string[]
    }
  | {
      kind: 'furniture'
      tx: TxToken
      ids: FurnitureId[]
      grabbedId: FurnitureId
      grabOffset: Vec2
      starts: Map<FurnitureId, { x: number; y: number; rotation: number }>
      single: boolean
      lastSnap: SnapResult | null
    }
  | {
      kind: 'rotate'
      tx: TxToken
      ids: FurnitureId[]
      grabbedId: FurnitureId
      startPointer: number
      starts: Map<FurnitureId, number>
      center: Vec2
    }
  | { kind: 'node'; tx: TxToken; nodeId: NodeId; lastSnap: SnapResult | null }
  | {
      kind: 'wall'
      tx: TxToken
      wallId: WallId
      normal: Vec2
      startWorld: Vec2
      applied: number
      /** Measurement scope, frozen at drag-arm (topology never changes mid-drag). */
      pillWallIds: WallId[]
    }
  | { kind: 'opening'; tx: TxToken; openingId: OpeningId; wallId: WallId }
  | { kind: 'annotation-label'; tx: TxToken; id: AnnotationId; grabOffset: Vec2 }
  | {
      kind: 'annotation-dim'
      tx: TxToken
      id: AnnotationId
      /** +perp(a→b) at drag start — offset = dot(world − a, n) + off0. */
      n: Vec2
      a: Vec2
      /** Grab compensation: where in the tolerance band the press landed. */
      off0: number
    }

export function createSelectTool(): Tool {
  let state: DragState = { kind: 'idle' }
  let cycle: { screen: Vec2; index: number } | null = null

  const reset = (ctx: ToolContext) => {
    state = { kind: 'idle' }
    ctx.interaction().clear()
  }

  const selectedFurnitureIds = (ctx: ToolContext): FurnitureId[] =>
    ctx
      .ui()
      .selection.filter((id) => ctx.doc().furniture[id as FurnitureId]) as FurnitureId[]

  // pills must measure the POST-mutation doc — snapshot AFTER the move applies
  // (the destructures at the top of onPointerMove are stale by then)
  const measureInput = (ctx: ToolContext): MeasureInput => ({
    doc: ctx.doc(),
    derived: ctx.derived(),
    pxToWorld: ctx.pxToWorld(),
    units: useAppSettings.getState().units,
  })

  const beginFurnitureDrag = (
    ctx: ToolContext,
    grabbedId: FurnitureId,
    world: Vec2,
  ): void => {
    const doc = ctx.doc()
    let ids = selectedFurnitureIds(ctx)
    if (!ids.includes(grabbedId)) ids = [grabbedId]
    const starts = new Map<FurnitureId, { x: number; y: number; rotation: number }>()
    for (const id of ids) {
      const f = doc.furniture[id]!
      starts.set(id, { x: f.x, y: f.y, rotation: f.rotation })
    }
    const grabbed = doc.furniture[grabbedId]!
    state = {
      kind: 'furniture',
      tx: beginTx(),
      ids,
      grabbedId,
      grabOffset: sub({ x: grabbed.x, y: grabbed.y }, world),
      starts,
      single: ids.length === 1,
      lastSnap: null,
    }
    ctx.interaction().set({ gestureActive: true })
  }

  const tool: Tool = {
    id: 'select',
    cursor: (ctx) => (ctx.ui().spaceHeld ? 'grab' : 'default'),

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      const doc = ctx.doc()
      const ui = ctx.ui()
      const px = ctx.pxToWorld()

      // 1. rotate handle of a single selected furniture item
      const selFurn = selectedFurnitureIds(ctx)
      if (selFurn.length >= 1) {
        const grabbed = selFurn
          .map((id) => doc.furniture[id]!)
          .find((f) => dist(e.world, rotateHandlePos(f, px)) <= HANDLE_RADIUS_PX * px)
        if (grabbed) {
          const starts = new Map<FurnitureId, number>()
          for (const id of selFurn) starts.set(id, doc.furniture[id]!.rotation)
          state = {
            kind: 'rotate',
            tx: beginTx(),
            ids: selFurn,
            grabbedId: grabbed.id,
            startPointer: Math.atan2(e.world.y - grabbed.y, e.world.x - grabbed.x),
            starts,
            center: { x: grabbed.x, y: grabbed.y },
          }
          ctx.interaction().set({ gestureActive: true })
          return
        }
      }

      // 2. hit-test (nodes eligible when their walls/self are selected)
      const nodeCands = new Set<NodeId>()
      for (const id of ui.selection) {
        const w = doc.walls[id as WallId]
        if (w) {
          nodeCands.add(w.a)
          nodeCands.add(w.b)
        }
        if (doc.nodes[id as NodeId]) nodeCands.add(id as NodeId)
      }
      const hits = hitTestAll(doc, ctx.derived(), e.world, px, { nodeCandidates: nodeCands })

      // alt+click cycles immediately (deliberate gesture); same-spot-click
      // cycling advances on POINTER-UP only — a drag starting at the same
      // spot must never be hijacked by stale cycle state
      let hit = hits[0] ?? null
      if (e.mods.alt && hits.length > 1) {
        const index = ((cycle && dist(cycle.screen, e.screen) < SLOP_PX ? cycle.index : 0) + 1) % hits.length
        hit = hits[index]!
        cycle = { screen: e.screen, index }
      }

      // selection updates at pointerdown (standard: drag applies to selection)
      if (hit) {
        if (e.mods.shift) ui.toggleSelected(hit.id)
        else if (!ui.selection.includes(hit.id)) ui.setSelection([hit.id])
      }
      state = { kind: 'pressed', hit, screen: e.screen, world: e.world, additive: e.mods.shift }
    },

    onPointerMove(e, ctx) {
      // chorded release: pointerup only fires when the LAST button lifts —
      // if the primary button is no longer down mid-gesture, finish now
      // (buttons is optional so scripted tests default to "primary held")
      if (state.kind !== 'idle' && e.buttons !== undefined && (e.buttons & 1) === 0) {
        tool.onPointerUp(e, ctx)
        return
      }
      const doc = ctx.doc()
      const ui = ctx.ui()
      const px = ctx.pxToWorld()

      switch (state.kind) {
        case 'idle': {
          const nodeCands = new Set<NodeId>()
          for (const id of ui.selection) {
            const w = doc.walls[id as WallId]
            if (w) {
              nodeCands.add(w.a)
              nodeCands.add(w.b)
            }
            if (doc.nodes[id as NodeId]) nodeCands.add(id as NodeId)
          }
          const hit = hitTestAll(doc, ctx.derived(), e.world, px, {
            nodeCandidates: nodeCands,
          })[0]
          if (ui.hoveredId !== (hit?.id ?? null)) ui.setHovered(hit?.id ?? null)
          return
        }

        case 'pressed': {
          if (dist(state.screen, e.screen) < SLOP_PX) return
          cycle = null // an engaged drag ends any click-cycling sequence
          const hit = state.hit
          const startMarquee = (origin: Vec2, additive: boolean) => {
            // empty-space (or room-floor) drag = marquee select (0.3.0;
            // panning moved to Space/middle/right-drag). No transaction —
            // selection is not undoable, history stays untouched.
            const prev = [...ui.selection]
            state = { kind: 'marquee', origin, prev, base: additive ? prev : [] }
            tool.onPointerMove(e, ctx) // apply THIS move to the fresh marquee
          }
          if (!hit) {
            startMarquee(state.world, state.additive)
            return
          }
          if (hit.kind === 'furniture') {
            beginFurnitureDrag(ctx, hit.id, state.world)
          } else if (hit.kind === 'node') {
            state = { kind: 'node', tx: beginTx(), nodeId: hit.id, lastSnap: null }
            ctx.interaction().set({ gestureActive: true })
          } else if (hit.kind === 'wall') {
            const w = doc.walls[hit.id]
            const na = w && doc.nodes[w.a]
            const nb = w && doc.nodes[w.b]
            if (!w || !na || !nb) return
            state = {
              kind: 'wall',
              tx: beginTx(),
              wallId: hit.id,
              normal: perp(normalize(sub(nb, na))),
              startWorld: state.world,
              applied: 0,
              pillWallIds: [
                ...new Set([hit.id, ...incidentWallIds(doc, w.a), ...incidentWallIds(doc, w.b)]),
              ],
            }
            ctx.interaction().set({ gestureActive: true })
          } else if (hit.kind === 'opening') {
            const op = doc.openings[hit.id]
            if (!op) return
            state = { kind: 'opening', tx: beginTx(), openingId: hit.id, wallId: op.wallId }
            ctx.interaction().set({ gestureActive: true })
          } else if (hit.kind === 'annotation') {
            const ann = doc.annotations[hit.id]
            if (!ann) return
            if (ann.kind === 'label') {
              state = {
                kind: 'annotation-label',
                tx: beginTx(),
                id: hit.id,
                grabOffset: sub({ x: ann.x, y: ann.y }, state.world),
              }
            } else {
              // dimensions slide along their normal ONLY — a rigid translate
              // would silently falsify what the dimension measures
              const n = perp(normalize(sub(ann.b, ann.a)))
              state = {
                kind: 'annotation-dim',
                tx: beginTx(),
                id: hit.id,
                n,
                a: { ...ann.a },
                off0: ann.offset - dot(sub(state.world, ann.a), n),
              }
            }
            ctx.interaction().set({ gestureActive: true })
          } else {
            // rooms don't drag — a drag STARTING on a room floor is the
            // marquee (boxing furniture inside a room must work; a sub-slop
            // click still selects the room via the pointer-up path)
            startMarquee(state.world, state.additive)
          }
          return
        }

        case 'marquee': {
          // live-updating selection: what you see boxed is what you get
          const hits = hitTestRect(doc, ctx.derived(), state.origin, e.world, px)
          const ids = new Set(state.base)
          for (const h of hits) ids.add(h.id)
          const next = [...ids]
          const cur = ui.selection
          // hit order is deterministic — skip the store write (and the
          // per-frame re-render of every selection subscriber) when equal
          if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) {
            ui.setSelection(next)
          }
          ctx.interaction().set({
            preview: { kind: 'marquee', a: state.origin, b: e.world },
          })
          return
        }

        case 'furniture': {
          const grabbedStart = state.starts.get(state.grabbedId)!
          const rawCenter = add(e.world, state.grabOffset)
          const item = doc.furniture[state.grabbedId]
          if (!item) return
          const catalogItem = CATALOG[item.catalogItemId]
          const quarter = Math.round(item.rotation / (Math.PI / 2)) % 2 !== 0
          const candidates = [
            ...alignmentGuideCandidates(
              doc,
              {
                hw: (quarter ? item.size.d : item.size.w) / 2,
                hh: (quarter ? item.size.w : item.size.d) / 2,
                rotation: item.rotation,
              },
              new Set(state.ids),
            ),
            ...(state.single && catalogItem?.wallSnap
              ? [wallBackCandidate(doc, ctx.derived(), rawCenter, item.size.d)].filter(
                  (c): c is NonNullable<typeof c> => c !== null,
                )
              : []),
          ]
          const snap = resolveSnap(rawCenter, candidates, {
            pxToWorld: px,
            enabled: useAppSettings.getState().snapEnabled && !e.mods.ctrl,
            ...(state.lastSnap ? { prev: state.lastSnap } : {}),
          })
          state.lastSnap = snap
          const delta = sub(snap.point, { x: grabbedStart.x, y: grabbedStart.y })
          for (const id of state.ids) {
            const s = state.starts.get(id)!
            ctx.actions().transformFurniture(
              id,
              {
                x: s.x + delta.x,
                y: s.y + delta.y,
                // wall-capture auto-rotation: single drags only (plan)
                ...(state.single && snap.rotation !== undefined
                  ? { rotation: snap.rotation }
                  : {}),
              },
              { quantize: false },
            )
          }
          ctx.interaction().set({
            snap,
            gestureActive: true,
            // group drags measure the grabbed item only (matches guide behavior)
            pills: furnitureDragPills(measureInput(ctx), state.grabbedId),
          })
          return
        }

        case 'rotate': {
          const angle = Math.atan2(e.world.y - state.center.y, e.world.x - state.center.x)
          let delta = angle - state.startPointer
          if (!e.mods.ctrl) {
            // detents: snap the GRABBED item's absolute angle to 15° steps
            const target = state.starts.get(state.grabbedId)! + delta
            const step = Math.PI / 12
            const snapped = Math.round(target / step) * step
            if (Math.abs(snapped - target) < (3 * Math.PI) / 180) {
              delta = snapped - state.starts.get(state.grabbedId)!
            }
          }
          for (const id of state.ids) {
            ctx.actions().transformFurniture(
              id,
              { rotation: state.starts.get(id)! + delta },
              { quantize: false },
            )
          }
          // live angle readout — the 15° detents were invisible without it
          const grabbed = ctx.doc().furniture[state.grabbedId]
          if (grabbed) {
            const deg =
              Math.round((((grabbed.rotation * 180) / Math.PI) % 360) + 360) % 360
            ctx.interaction().set({
              pills: [{ at: rotateHandlePos(grabbed, px), text: `${deg}°` }],
            })
          }
          return
        }

        case 'node': {
          const node = doc.nodes[state.nodeId]
          if (!node) return
          const incident = new Set(incidentWallIds(doc, state.nodeId))
          const snap = resolveSnap(
            e.world,
            [
              ...nodeCandidates(doc, new Set([state.nodeId])),
              ...wallPointCandidates(doc, e.world, incident),
              gridCandidate(doc, 1 / px),
            ],
            {
              pxToWorld: px,
              enabled: useAppSettings.getState().snapEnabled && !e.mods.ctrl,
              ...(state.lastSnap ? { prev: state.lastSnap } : {}),
            },
          )
          state.lastSnap = snap
          ctx.actions().moveNode(state.nodeId, snap.point, { mode: 'live' })
          const mi = measureInput(ctx)
          ctx.interaction().set({
            snap,
            gestureActive: true,
            pills: wallLengthPills(mi, incidentWallIds(mi.doc, state.nodeId)),
          })
          return
        }

        case 'wall': {
          const target = dot(sub(e.world, state.startWorld), state.normal)
          const step = target - state.applied
          if (Math.abs(step) > 1e-9) {
            ctx.actions().moveWall(state.wallId, scale(state.normal, step), { mode: 'live' })
            state.applied = target
          }
          ctx.interaction().set({
            pills: wallLengthPills(measureInput(ctx), state.pillWallIds),
          })
          return
        }

        case 'opening': {
          const op = doc.openings[state.openingId]
          const wall = op && doc.walls[op.wallId]
          const na = wall && doc.nodes[wall.a]
          const nb = wall && doc.nodes[wall.b]
          if (!op || !wall || !na || !nb) return
          const { t } = closestPointOnSegment(e.world, na, nb)
          ctx.actions().updateOpening(state.openingId, { t }, { mode: 'live' })
          ctx.interaction().set({
            pills: openingDragPills(measureInput(ctx), state.openingId, e.world),
          })
          return
        }

        case 'annotation-label': {
          const p = add(e.world, state.grabOffset)
          ctx.actions().updateAnnotation(state.id, { x: p.x, y: p.y })
          return
        }

        case 'annotation-dim': {
          ctx.actions().updateAnnotation(state.id, {
            offset: dot(sub(e.world, state.a), state.n) + state.off0,
          })
          return
        }
      }
    },

    onPointerUp(e, ctx) {
      const doc = ctx.doc()
      switch (state.kind) {
        case 'pressed': {
          if (!state.hit && !state.additive) {
            // plain click on nothing clears the selection
            ctx.ui().clearSelection()
            cycle = null
          } else if (state.hit && !state.additive && !e.mods.alt) {
            // same-spot repeat CLICKS cycle the overlap stack (WM-independent
            // fallback for Alt+click, which Linux WMs often grab)
            const px = ctx.pxToWorld()
            const hits = hitTestAll(doc, ctx.derived(), e.world, px)
            const samePlace = cycle && dist(cycle.screen, e.screen) < SLOP_PX
            if (samePlace && hits.length > 1) {
              const index = (cycle!.index + 1) % hits.length
              ctx.ui().setSelection([hits[index]!.id])
              cycle = { screen: e.screen, index }
            } else {
              cycle = { screen: e.screen, index: 0 }
            }
          }
          state = { kind: 'idle' }
          return
        }
        case 'marquee': {
          reset(ctx) // selection was applied live; just drop the preview
          return
        }
        case 'furniture': {
          // final commit pass: quantize to 1cm
          for (const id of state.ids) {
            const f = doc.furniture[id]
            if (f) ctx.actions().transformFurniture(id, { x: f.x, y: f.y })
          }
          commitTx(state.tx)
          reset(ctx)
          return
        }
        case 'rotate': {
          commitTx(state.tx)
          reset(ctx)
          return
        }
        case 'node': {
          const snap = state.lastSnap
          if (snap?.primary?.kind === 'node') {
            // drop-on-node ⇒ merge (survivor = the drop target)
            ctx.actions().mergeNodes(snap.primary.nodeId, state.nodeId)
          } else {
            const n = doc.nodes[state.nodeId]
            if (n) ctx.actions().moveNode(state.nodeId, { x: n.x, y: n.y }, { mode: 'commit' })
          }
          commitTx(state.tx)
          reset(ctx)
          return
        }
        case 'wall': {
          ctx.actions().moveWall(state.wallId, { x: 0, y: 0 }, { mode: 'commit' })
          commitTx(state.tx)
          reset(ctx)
          return
        }
        case 'opening': {
          const op = doc.openings[state.openingId]
          if (op) ctx.actions().updateOpening(state.openingId, { t: op.t }, { mode: 'commit' })
          commitTx(state.tx)
          reset(ctx)
          return
        }
        case 'annotation-label':
        case 'annotation-dim': {
          commitTx(state.tx) // annotations skip the pipeline — nothing to re-run
          reset(ctx)
          return
        }
        default:
          void e
      }
    },

    onKeyDown(key, ctx) {
      if (key === 'Escape' && state.kind !== 'idle') {
        // covers 'pressed' too: a pointercancel (dispatched as Escape) while
        // pressed must not leave a stuck press that later fires a phantom
        // click. Abort only a tx THIS gesture owns — never a foreign one
        // (e.g. a pending arrow-nudge run).
        if (state.kind === 'marquee') ctx.ui().setSelection(state.prev) // cancel = restore
        if ('tx' in state) abortTx(state.tx)
        reset(ctx)
        return true
      }
      return false
    },

    onDeactivate(ctx) {
      if ('tx' in state) abortTx(state.tx)
      reset(ctx)
    },
  }

  return tool
}
