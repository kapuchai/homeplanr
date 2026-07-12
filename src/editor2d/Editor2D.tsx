import { useEffect, useMemo, useRef } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useInteractionStore } from './session/interactionStore'
import { getDerived } from '../store/derived'
import { useViewportStore } from './viewport/viewportStore'
import { screenToWorld, wheelZoomFactor } from './viewport/viewportMath'
import { useViewportTransform } from './viewport/useViewportTransform'
import { GridLayer } from './viewport/GridLayer'
import { WorldLayers } from './render/WorldLayers'
import { InteractionOverlay } from './render/InteractionOverlay'
import { docContentBounds } from './render/bounds'
import { polygonBounds } from '../geometry/polygon'
import { createToolRegistry } from './tools/toolRegistry'
import { handleKey, handleKeyUp, toKeyInput } from './tools/keymap'
import { EmptyState, StatusHint } from '../app/StatusHint'
import type { EditorPointerEvent, ToolContext } from './tools/toolTypes'

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

  const registry = useMemo(() => createToolRegistry(), [])
  const ctx = useMemo<ToolContext>(
    () => ({
      doc: () => useDocStore.getState().doc,
      derived: () => getDerived(useDocStore.getState().doc),
      actions: () => useDocStore.getState(),
      ui: () => useUiStore.getState(),
      interaction: () => useInteractionStore.getState(),
      pxToWorld: () => 1 / useViewportStore.getState().k,
    }),
    [],
  )

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
    const doc = useDocStore.getState().doc
    useViewportStore.getState().zoomToFit(polygonBounds(docContentBounds(doc, getDerived(doc))))
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
      if (e.shiftKey && !e.ctrlKey) {
        const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1
        vp.panBy(-(e.deltaY + e.deltaX) * px, 0)
        return
      }
      vp.zoomAtPoint(cursor, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey))
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

  // pointer pipeline: pan override → active tool (rAF-coalesced moves)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    let panning: { pointerId: number; lastX: number; lastY: number } | null = null
    let pendingMove: PointerEvent | null = null
    let rafId = 0

    const normalize = (e: PointerEvent): EditorPointerEvent => {
      const rect = el.getBoundingClientRect()
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      return {
        world: screenToWorld(screen, useViewportStore.getState()),
        screen,
        mods: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
        button: e.button,
        pointerId: e.pointerId,
      }
    }
    const activeTool = () => registry.get(useUiStore.getState().activeTool)

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && useUiStore.getState().spaceHeld)) {
        e.preventDefault()
        panning = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
        el.setPointerCapture(e.pointerId)
        return
      }
      el.setPointerCapture(e.pointerId)
      activeTool().onPointerDown(normalize(e), ctx)
    }
    const flushMove = () => {
      rafId = 0
      if (!pendingMove) return
      const e = pendingMove
      pendingMove = null
      if (panning && e.pointerId === panning.pointerId) {
        useViewportStore.getState().panBy(e.clientX - panning.lastX, e.clientY - panning.lastY)
        panning.lastX = e.clientX
        panning.lastY = e.clientY
        return
      }
      activeTool().onPointerMove(normalize(e), ctx)
    }
    const onPointerMove = (e: PointerEvent) => {
      pendingMove = e
      if (!rafId) rafId = requestAnimationFrame(flushMove)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pendingMove) flushMove()
      if (panning && e.pointerId === panning.pointerId) {
        el.releasePointerCapture(panning.pointerId)
        panning = null
        return
      }
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      activeTool().onPointerUp(normalize(e), ctx)
    }
    const onPointerCancel = (e: PointerEvent) => {
      panning = null
      // pointercancel mid-gesture must abort (plan-pinned) — tools handle
      // Escape identically
      activeTool().onKeyDown?.('Escape', ctx)
      void e
    }
    const onDblClick = (e: MouseEvent) => {
      activeTool().onDoubleClick?.(normalize(e as PointerEvent), ctx)
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('dblclick', onDblClick)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
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
  const cursor = spaceHeld ? 'grab' : registry.get(activeToolId).cursor(ctx)

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
    </div>
  )
}
