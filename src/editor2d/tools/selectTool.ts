import type { Tool, ToolContext } from './toolTypes'
import type { EntityRef } from '../hit/hitTest'
import { hitTestAll } from '../hit/hitTest'
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
import { beginTx, commitTx, abortTx, isTxActive } from '../../store/transactions'
import { useViewportStore } from '../viewport/viewportStore'
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
import type { FurnitureId, NodeId, OpeningId, WallId } from '../../model/ids'

/**
 * Select/move tool — drag branches per hit kind (plan-pinned):
 * furniture (single grab-offset / multi rigid), rotate handle (15° detents,
 * Ctrl free), opening slide (clamped along its wall), wall perpendicular
 * translate, node drag with drop-on-node merge, empty-space drag panning
 * the viewport. Every entity drag is one transaction ⇒ one undo entry
 * (panning opens none); Esc aborts.
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
  | { kind: 'panning'; lastScreen: Vec2 }
  | {
      kind: 'furniture'
      ids: FurnitureId[]
      grabbedId: FurnitureId
      grabOffset: Vec2
      starts: Map<FurnitureId, { x: number; y: number; rotation: number }>
      single: boolean
      lastSnap: SnapResult | null
    }
  | {
      kind: 'rotate'
      ids: FurnitureId[]
      grabbedId: FurnitureId
      startPointer: number
      starts: Map<FurnitureId, number>
      center: Vec2
    }
  | { kind: 'node'; nodeId: NodeId; lastSnap: SnapResult | null }
  | {
      kind: 'wall'
      wallId: WallId
      normal: Vec2
      startWorld: Vec2
      applied: number
      /** Measurement scope, frozen at drag-arm (topology never changes mid-drag). */
      pillWallIds: WallId[]
    }
  | { kind: 'opening'; openingId: OpeningId; wallId: WallId }

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
    beginTx()
    state = {
      kind: 'furniture',
      ids,
      grabbedId,
      grabOffset: sub({ x: grabbed.x, y: grabbed.y }, world),
      starts,
      single: ids.length === 1,
      lastSnap: null,
    }
    ctx.interaction().set({ gestureActive: true })
  }

  return {
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
          beginTx()
          state = {
            kind: 'rotate',
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
          if (!hit) {
            // empty-space drag pans the viewport — SCREEN deltas only (world
            // coords feed back under a moving viewport); no transaction, so
            // undo history stays untouched
            useViewportStore
              .getState()
              .panBy(e.screen.x - state.screen.x, e.screen.y - state.screen.y)
            state = { kind: 'panning', lastScreen: e.screen }
            ctx.interaction().set({ cursorHint: 'grabbing' })
            return
          }
          if (hit.kind === 'furniture') {
            beginFurnitureDrag(ctx, hit.id, state.world)
          } else if (hit.kind === 'node') {
            beginTx()
            state = { kind: 'node', nodeId: hit.id, lastSnap: null }
            ctx.interaction().set({ gestureActive: true })
          } else if (hit.kind === 'wall') {
            const w = doc.walls[hit.id]
            const na = w && doc.nodes[w.a]
            const nb = w && doc.nodes[w.b]
            if (!w || !na || !nb) return
            beginTx()
            state = {
              kind: 'wall',
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
            beginTx()
            state = { kind: 'opening', openingId: hit.id, wallId: op.wallId }
            ctx.interaction().set({ gestureActive: true })
          } else {
            state = { kind: 'idle' } // rooms don't drag
          }
          return
        }

        case 'panning': {
          useViewportStore
            .getState()
            .panBy(e.screen.x - state.lastScreen.x, e.screen.y - state.lastScreen.y)
          state.lastScreen = e.screen
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
            enabled: doc.settings.snapEnabled && !e.mods.ctrl,
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
              enabled: doc.settings.snapEnabled && !e.mods.ctrl,
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
        case 'panning': {
          reset(ctx) // a pan is not a click — the selection stays as it was
          return
        }
        case 'furniture': {
          // final commit pass: quantize to 1cm
          for (const id of state.ids) {
            const f = doc.furniture[id]
            if (f) ctx.actions().transformFurniture(id, { x: f.x, y: f.y })
          }
          commitTx()
          reset(ctx)
          return
        }
        case 'rotate': {
          commitTx()
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
          commitTx()
          reset(ctx)
          return
        }
        case 'wall': {
          ctx.actions().moveWall(state.wallId, { x: 0, y: 0 }, { mode: 'commit' })
          commitTx()
          reset(ctx)
          return
        }
        case 'opening': {
          const op = doc.openings[state.openingId]
          if (op) ctx.actions().updateOpening(state.openingId, { t: op.t }, { mode: 'commit' })
          commitTx()
          reset(ctx)
          return
        }
        default:
          void e
      }
    },

    onKeyDown(key, ctx) {
      if (key === 'Escape' && state.kind !== 'idle' && state.kind !== 'pressed') {
        if (isTxActive()) abortTx()
        reset(ctx)
        return true
      }
      return false
    },

    onDeactivate(ctx) {
      if (isTxActive()) abortTx()
      reset(ctx)
    },
  }
}
