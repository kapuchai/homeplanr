import { useEffect, useRef } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { getDerived } from '../store/derived'
import { useViewportStore } from './viewport/viewportStore'
import { screenToWorld, wheelZoomFactor } from './viewport/viewportMath'
import { useViewportTransform } from './viewport/useViewportTransform'
import { GridLayer } from './viewport/GridLayer'
import { WorldLayers } from './render/WorldLayers'
import { docContentBounds } from './render/bounds'
import { hitTestTop } from './hit/hitTest'
import { polygonBounds } from '../geometry/polygon'
import { isTxActive } from '../store/transactions'
import type { FurnitureId, NodeId, OpeningId, WallId } from '../model/ids'

/**
 * 2D editor shell (M2 scope): viewport interactions (wheel matrix, pan),
 * hover + click selection, Del, Esc, Shift+1 fit, and the app-shell input
 * hygiene (context menu, browser accelerators, middle-click autoscroll).
 * The full tool system (draw-wall, drags, snapping) lands in M3a.
 */
const isEditableTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t.isContentEditable
  )
}

export function Editor2D() {
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  useViewportTransform(worldRef, gridRef)

  // size tracking + first fit
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const vp = useViewportStore.getState()
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      useViewportStore.getState().setSize(r.width, r.height)
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    vp.setSize(r.width, r.height)
    // initial zoom-to-fit of the loaded document
    const doc = useDocStore.getState().doc
    const bounds = polygonBounds(docContentBounds(doc, getDerived(doc)))
    useViewportStore.getState().zoomToFit(bounds)
    return () => ro.disconnect()
  }, [])

  // wheel matrix — non-passive listener so preventDefault always works
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
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // pointer: pan (middle / Space+left), hover, click-select
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    let panning: { pointerId: number; lastX: number; lastY: number } | null = null

    const toWorld = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      return screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        useViewportStore.getState(),
      )
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && useUiStore.getState().spaceHeld)) {
        e.preventDefault()
        panning = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
        el.setPointerCapture(e.pointerId)
        return
      }
      if (e.button !== 0) return
      const ui = useUiStore.getState()
      const doc = useDocStore.getState().doc
      const vp = useViewportStore.getState()
      const hit = hitTestTop(doc, getDerived(doc), toWorld(e), 1 / vp.k)
      if (!hit) {
        ui.clearSelection()
        return
      }
      if (e.shiftKey) ui.toggleSelected(hit.id)
      else ui.setSelection([hit.id])
    }
    const onPointerMove = (e: PointerEvent) => {
      if (panning && e.pointerId === panning.pointerId) {
        useViewportStore
          .getState()
          .panBy(e.clientX - panning.lastX, e.clientY - panning.lastY)
        panning.lastX = e.clientX
        panning.lastY = e.clientY
        return
      }
      const doc = useDocStore.getState().doc
      const vp = useViewportStore.getState()
      const hit = hitTestTop(doc, getDerived(doc), toWorld(e), 1 / vp.k)
      const ui = useUiStore.getState()
      if (ui.hoveredId !== (hit?.id ?? null)) ui.setHovered(hit?.id ?? null)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (panning && e.pointerId === panning.pointerId) {
        el.releasePointerCapture(panning.pointerId)
        panning = null
      }
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  // keyboard + input hygiene (window-level)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // suppress browser accelerators everywhere (desktop app, not a page)
      if (
        e.key === 'F5' ||
        (e.ctrlKey && ['r', 'p', 'f', 'j'].includes(e.key.toLowerCase()))
      ) {
        e.preventDefault()
        return
      }
      if (isEditableTarget(e.target)) return // focus guard
      const ui = useUiStore.getState()
      if (e.key === ' ') {
        if (!ui.spaceHeld) ui.setSpaceHeld(true)
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        ui.clearSelection()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTxActive()) {
        const ids = ui.selection.filter((id) => !id.startsWith('r_')) as (
          | WallId
          | NodeId
          | OpeningId
          | FurnitureId
        )[]
        if (ids.length) useDocStore.getState().deleteEntities(ids)
        return
      }
      if (e.key === '!' || (e.shiftKey && e.key === '1')) {
        const doc = useDocStore.getState().doc
        const bounds = polygonBounds(docContentBounds(doc, getDerived(doc)))
        useViewportStore.getState().zoomToFit(bounds)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useUiStore.getState().setSpaceHeld(false)
    }
    const onContextMenu = (e: MouseEvent) => {
      if (!isEditableTarget(e.target)) e.preventDefault()
    }
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault() // no middle-click autoscroll
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
  }, [])

  const spaceHeld = useUiStore((s) => s.spaceHeld)

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        flex: 1,
        overflow: 'hidden',
        cursor: spaceHeld ? 'grab' : 'default',
        background: '#FAFAF7',
      }}
    >
      <GridLayer ref={gridRef} />
      <svg
        ref={svgRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
      >
        <g ref={worldRef}>
          <WorldLayers />
        </g>
      </svg>
    </div>
  )
}
