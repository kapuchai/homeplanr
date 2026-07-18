import { useEffect, useRef } from 'react'
import { getActiveLevelDoc } from '../store/levelView'
import { useUiStore } from '../store/uiStore'
import { useInteractionStore } from './session/interactionStore'
import { useViewportStore } from './viewport/viewportStore'
import { resolveWheel, screenToWorld } from './viewport/viewportMath'
import { useAppSettings } from '../store/appSettings'
import { useViewportTransform } from './viewport/useViewportTransform'
import { GridLayer } from './viewport/GridLayer'
import { WorldLayers } from './render/WorldLayers'
import { InteractionOverlay } from './render/InteractionOverlay'
import { toolContext, toolRegistry } from './tools/toolRegistry'
import { hitTestTop } from './hit/hitTest'
import { ContextMenu } from '../app/ContextMenu'
import {
  flushPendingNudge,
  handleKey,
  handleKeyUp,
  toKeyInput,
  zoomToFitContent,
} from './tools/keymap'
import { EmptyState, StatusHint } from '../app/StatusHint'
import { LevelSwitcher } from '../app/LevelSwitcher'
import { ZoomControls } from './ZoomControls'
import type { EditorPointerEvent } from './tools/toolTypes'

/**
 * 2D editor shell: viewport interactions + the tool event pipeline.
 * Order per plan: wheel/pan overrides → keymap globals → active tool.
 * Pointer moves are rAF-coalesced (latest event per frame).
 */
export function Editor2D() {
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  useViewportTransform(worldRef, gridRef)

  // the app-shared registry/context: the toolbar switches tools on the SAME
  // instances (via switchTool), so onDeactivate always sees this state
  const registry = toolRegistry
  const ctx = toolContext

  // a menu left open must not survive a 2D→3D unmount and reappear stale
  useEffect(() => () => useUiStore.getState().setContextMenu(null), [])

  // size tracking + first fit
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      useViewportStore.getState().setSize(r.width, r.height)
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    useViewportStore.getState().setSize(r.width, r.height)
    zoomToFitContent(getActiveLevelDoc())
    return () => ro.disconnect()
  }, [])

  // wheel matrix
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const vp = useViewportStore.getState()
      const action = resolveWheel(
        e,
        useAppSettings.getState().wheelMode,
        useUiStore.getState().spaceHeld,
      )
      if (action.kind === 'pan') vp.panBy(action.dx, action.dy)
      else vp.zoomAtPoint(cursor, action.factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    // WebKitGTK delivers touchpad pinch as Safari-style GESTURE events that
    // bypass wheel handlers and drive native page zoom (zooming the whole
    // window — M6 packaged-gate finding). Intercept them and feed the
    // editor zoom instead.
    interface GestureEvent extends Event {
      scale: number
      clientX: number
      clientY: number
    }
    let lastGestureScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      lastGestureScale = (e as GestureEvent).scale || 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureEvent
      const rect = el.getBoundingClientRect()
      const factor = (g.scale || 1) / lastGestureScale
      lastGestureScale = g.scale || 1
      useViewportStore.getState().zoomAtPoint(
        { x: g.clientX - rect.left, y: g.clientY - rect.top },
        Math.min(1.25, Math.max(1 / 1.25, factor)),
      )
    }
    const onGestureEnd = (e: Event) => e.preventDefault()
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    // and keep pinch anywhere else from zooming the app chrome — WebKitGTK
    // may express pinch as ctrl+wheel OUTSIDE the editor too, so guard the
    // whole window (tauri.conf zoomHotkeysEnabled:false disables the
    // native webview zoom underneath)
    const blockDocGesture = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', blockDocGesture)
    document.addEventListener('gesturechange', blockDocGesture)
    const blockCtrlWheel = (e: WheelEvent) => {
      if (e.ctrlKey && !el.contains(e.target as Node)) e.preventDefault()
    }
    window.addEventListener('wheel', blockCtrlWheel, { passive: false })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
      document.removeEventListener('gesturestart', blockDocGesture)
      document.removeEventListener('gesturechange', blockDocGesture)
      window.removeEventListener('wheel', blockCtrlWheel)
    }
  }, [])

  // pointer pipeline: pan override → active tool (rAF-coalesced moves).
  // ONE pointer owns the interaction at a time (gesture or pan): moves/ups
  // from other pointers are dropped — a hovering pen or second touch must
  // neither drive nor chord-terminate a mouse drag.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    let panning: {
      pointerId: number
      lastX: number
      lastY: number
      /** buttons bit of the initiating button — releasing it ends the pan
       * even when another button stays held (no pointerup fires then). */
      buttonBit: number
    } | null = null
    let gesturePointerId: number | null = null
    // right-button press: converts to a pan once it moves past the slop
    // (the sub-slop right CLICK is reserved for the context menu, M4)
    let rightPress: { pointerId: number; startX: number; startY: number } | null = null
    let pendingMove: PointerEvent | null = null
    let rafId = 0
    const RIGHT_DRAG_SLOP_PX = 4

    const normalize = (e: PointerEvent): EditorPointerEvent => {
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      return {
        world: screenToWorld(screen, useViewportStore.getState()),
        screen,
        mods: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
        button: e.button,
        buttons: e.buttons,
        pointerId: e.pointerId,
      }
    }
    const activeTool = () => registry.get(useUiStore.getState().activeTool)

    const onPointerDown = (e: PointerEvent) => {
      // a press invalidates any rAF-queued PRE-press hover move — delivered
      // late it would feed the tools a stale buttons=0 event that trips the
      // chord-release guard and kills the gesture it just started
      pendingMove = null
      // pointer actions act on the post-nudge doc (mirrors the keymap flush)
      flushPendingNudge()
      if (gesturePointerId !== null || panning || rightPress) return
      if (e.button === 1 || (e.button === 0 && useUiStore.getState().spaceHeld)) {
        e.preventDefault()
        panning = {
          pointerId: e.pointerId,
          lastX: e.clientX,
          lastY: e.clientY,
          buttonBit: e.button === 1 ? 4 : 1,
        }
        useInteractionStore.getState().set({ cursorHint: 'grabbing' })
        el.setPointerCapture(e.pointerId)
        return
      }
      if (e.button === 2) {
        e.preventDefault()
        rightPress = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY }
        el.setPointerCapture(e.pointerId)
        return
      }
      gesturePointerId = e.pointerId
      el.setPointerCapture(e.pointerId)
      activeTool().onPointerDown(normalize(e), ctx)
    }
    const flushMove = () => {
      rafId = 0
      if (!pendingMove) return
      const e = pendingMove
      pendingMove = null
      const n = normalize(e)
      // cursor tracking for paste targets — rAF-coalesced ⇒ ≤1 write/frame,
      // read imperatively (nothing subscribes)
      useInteractionStore.getState().set({ pointerWorld: n.world })
      if (rightPress && e.pointerId === rightPress.pointerId) {
        if ((e.buttons & 2) === 0) {
          // chorded right-release fires no pointerup — drop the ghost press
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
          rightPress = null
          return
        }
        const moved = Math.hypot(e.clientX - rightPress.startX, e.clientY - rightPress.startY)
        if (moved > RIGHT_DRAG_SLOP_PX) {
          // right-drag becomes a pan (buttons bit 2 ends it on release);
          // lastX/Y = press point, so content stays pinned under the cursor
          panning = {
            pointerId: e.pointerId,
            lastX: rightPress.startX,
            lastY: rightPress.startY,
            buttonBit: 2,
          }
          useInteractionStore.getState().set({ cursorHint: 'grabbing' })
          rightPress = null
          // fall through to the panning branch below with THIS move
        } else {
          return
        }
      }
      if (panning) {
        if (e.pointerId !== panning.pointerId) return
        if ((e.buttons & panning.buttonBit) === 0) {
          // chorded release: the initiating button lifted, another is held
          if (el.hasPointerCapture(panning.pointerId)) el.releasePointerCapture(panning.pointerId)
          panning = null
          useInteractionStore.getState().set({ cursorHint: null })
          return
        }
        useViewportStore.getState().panBy(e.clientX - panning.lastX, e.clientY - panning.lastY)
        panning.lastX = e.clientX
        panning.lastY = e.clientY
        return
      }
      if (gesturePointerId !== null && e.pointerId !== gesturePointerId) return
      activeTool().onPointerMove(n, ctx)
    }
    const onPointerMove = (e: PointerEvent) => {
      // foreign pointers are filtered at ENQUEUE time: the single coalescing
      // slot must never let a second pointer overwrite (starve) the gesture,
      // pan, or right-press pointer's queued move for that frame
      if (panning && e.pointerId !== panning.pointerId) return
      if (rightPress && e.pointerId !== rightPress.pointerId) return
      if (
        !panning &&
        !rightPress &&
        gesturePointerId !== null &&
        e.pointerId !== gesturePointerId
      ) {
        return
      }
      pendingMove = e
      if (!rafId) rafId = requestAnimationFrame(flushMove)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pendingMove) flushMove()
      if (rightPress && e.pointerId === rightPress.pointerId) {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
        rightPress = null
        // sub-slop right CLICK → context menu; the click selects its target
        // first (unless it's already part of the selection), and empty space
        // deselects so the menu shows document-level actions
        const n = normalize(e)
        const ui = useUiStore.getState()
        const hit = hitTestTop(ctx.doc(), ctx.derived(), n.world, ctx.pxToWorld(), {
          annotationsVisible: useAppSettings.getState().showAnnotations,
        })
        if (hit && !ui.selection.includes(hit.id)) ui.setSelection([hit.id])
        else if (!hit && ui.selection.length) ui.clearSelection()
        ui.setContextMenu({ x: n.screen.x, y: n.screen.y, world: n.world })
        return
      }
      if (panning) {
        if (e.pointerId !== panning.pointerId) return
        if (el.hasPointerCapture(panning.pointerId)) el.releasePointerCapture(panning.pointerId)
        panning = null
        useInteractionStore.getState().set({ cursorHint: null })
        return
      }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (gesturePointerId !== null && e.pointerId !== gesturePointerId) return
      gesturePointerId = null
      activeTool().onPointerUp(normalize(e), ctx)
    }
    const onPointerCancel = (e: PointerEvent) => {
      if (panning?.pointerId === e.pointerId) {
        panning = null
        useInteractionStore.getState().set({ cursorHint: null })
      }
      if (rightPress?.pointerId === e.pointerId) rightPress = null
      // pointercancel mid-gesture must abort (plan-pinned) — tools handle
      // Escape identically; cancels of foreign pointers don't reach the tool
      if (gesturePointerId === null || e.pointerId === gesturePointerId) {
        gesturePointerId = null
        activeTool().onKeyDown?.('Escape', ctx)
      }
    }
    const onDblClick = (e: MouseEvent) => {
      activeTool().onDoubleClick?.(normalize(e as PointerEvent), ctx)
    }
    const onPointerLeave = () => {
      useInteractionStore.getState().set({ pointerWorld: null })
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('dblclick', onDblClick)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('dblclick', onDblClick)
    }
  }, [ctx, registry])

  // keyboard + input hygiene
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handleKey(toKeyInput(e), ctx, registry)
    const onKeyUp = (e: KeyboardEvent) => handleKeyUp(e, ctx)
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target
      const editable =
        t instanceof HTMLElement &&
        (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable)
      if (!editable) e.preventDefault()
    }
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('auxclick', onAuxClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('auxclick', onAuxClick)
    }
  }, [ctx, registry])

  const spaceHeld = useUiStore((s) => s.spaceHeld)
  const activeToolId = useUiStore((s) => s.activeTool)
  const cursorHint = useInteractionStore((s) => s.cursorHint)
  const cursor = spaceHeld ? 'grab' : (cursorHint ?? registry.get(activeToolId).cursor(ctx))

  return (
    <div
      ref={rootRef}
      className="editor-viewport"
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        cursor,
      }}
    >
      <GridLayer ref={gridRef} />
      <svg
        ref={svgRef}
        className="editor-canvas"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
      >
        <g ref={worldRef}>
          <WorldLayers />
          <InteractionOverlay />
        </g>
      </svg>
      <EmptyState />
      <StatusHint />
      <ZoomControls />
      <LevelSwitcher />
      <ContextMenu />
    </div>
  )
}
