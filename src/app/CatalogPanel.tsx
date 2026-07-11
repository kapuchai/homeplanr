import { useRef } from 'react'
import { CATALOG_BY_CATEGORY, CATEGORY_ORDER, type CatalogItem } from '../catalog'
import { SymbolRenderer } from '../editor2d/render/SymbolRenderer'
import { useUiStore } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { useInteractionStore } from '../editor2d/session/interactionStore'
import { useViewportStore } from '../editor2d/viewport/viewportStore'
import { screenToWorld } from '../editor2d/viewport/viewportMath'
import type { Vec2 } from '../geometry/vec'

/** The editor canvas — NEVER a bare `svg` selector (catalog thumbnails are
 * SVGs inside .content too; that ambiguity broke drag-drop in the M3b gate). */
const editorCanvas = () => document.querySelector<SVGSVGElement>('svg.editor-canvas')

const overCanvas = (clientX: number, clientY: number): { world: Vec2 } | null => {
  const canvas = editorCanvas()
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null
  }
  return {
    world: screenToWorld(
      { x: clientX - rect.left, y: clientY - rect.top },
      useViewportStore.getState(),
    ),
  }
}

/**
 * Left catalog panel. Two placement paths (plan-pinned):
 * - DRAG a card onto the canvas (primary): pointer capture on the card,
 *   drop = place at the drop point + select + switch to select tool;
 * - CLICK a card: arms the place-furniture tool (accent ring on the card);
 *   each canvas click places and stays armed; clicking the card disarms.
 */
function ItemCard({ item }: { item: CatalogItem }) {
  const armed = useUiStore((s) => s.toolParams.catalogItemId) === item.id
  const dragRef = useRef<{ pointerId: number; started: boolean } | null>(null)

  const viewScale = 44 / Math.max(item.dims.w, item.dims.d)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { pointerId: e.pointerId, started: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    dragRef.current.started = true
    // world footprint ghost while dragging over the canvas
    const over = overCanvas(e.clientX, e.clientY)
    const interaction = useInteractionStore.getState()
    if (over) {
      const hw = item.dims.w / 2
      const hh = item.dims.d / 2
      interaction.set({
        preview: {
          kind: 'ghost',
          polygon: [
            { x: over.world.x - hw, y: over.world.y - hh },
            { x: over.world.x + hw, y: over.world.y - hh },
            { x: over.world.x + hw, y: over.world.y + hh },
            { x: over.world.x - hw, y: over.world.y + hh },
          ],
          valid: true,
        },
      })
    } else if (interaction.preview) {
      interaction.clear()
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    const ui = useUiStore.getState()
    useInteractionStore.getState().clear()
    if (!drag.started) {
      // plain click: toggle armed click-to-place
      if (armed) {
        ui.setToolParams({ catalogItemId: null })
        ui.setActiveTool('select')
      } else {
        ui.setToolParams({ catalogItemId: item.id })
        ui.setActiveTool('place-furniture')
      }
      return
    }
    // drag path: place at the drop point when it lands on the canvas
    const over = overCanvas(e.clientX, e.clientY)
    if (!over) return // dropped over chrome — cancel
    const id = useDocStore.getState().addFurniture({
      catalogItemId: item.id,
      x: over.world.x,
      y: over.world.y,
      rotation: 0,
      size: { ...item.dims },
    })
    ui.setSelection([id])
    ui.setActiveTool('select')
    ui.setToolParams({ catalogItemId: null })
  }

  return (
    <button
      type="button"
      className={`catalog-card${armed ? ' armed' : ''}`}
      title={`${item.name} — ${Math.round(item.dims.w * 100)}×${Math.round(item.dims.d * 100)} cm`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg width={52} height={52} viewBox="-26 -26 52 52" aria-hidden>
        <g transform={`scale(${viewScale})`}>
          <SymbolRenderer prims={item.symbol2d} />
        </g>
      </svg>
      <span>{item.name}</span>
    </button>
  )
}

export function CatalogPanel() {
  return (
    <aside className="catalog-panel">
      {CATEGORY_ORDER.map((cat) => {
        const items = CATALOG_BY_CATEGORY[cat]
        if (!items.length) return null
        return (
          <section key={cat}>
            <h3>{cat}</h3>
            <div className="catalog-grid">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )
      })}
    </aside>
  )
}
