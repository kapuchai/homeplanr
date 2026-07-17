import { useEffect, useReducer, useRef, useState } from 'react'
import { CATALOG, CATALOG_BY_CATEGORY, CATEGORY_ORDER, type CatalogItem } from '../catalog'
import { searchCatalog } from '../catalog/search'
import { symbolFor } from '../catalog/symbolFromParts'
import { ensureThumbnails, getThumbnail } from '../catalog/thumbnails'
import {
  openingStyleSpec,
  openingStylesFor,
  type OpeningStyleSpec,
} from '../catalog/openingStyles'
import { SymbolRenderer } from '../editor2d/render/SymbolRenderer'
import { OpeningInkGlyph } from '../editor2d/render/OpeningInkGlyph'
import { openingInk } from '../editor2d/render/planGeometry'
import { useThemeStore } from '../theme/themeStore'
import { DEFAULTS } from '../model/types'
import { useUiStore } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { switchTool } from '../editor2d/tools/toolRegistry'
import { flushPendingNudge } from '../editor2d/tools/keymap'
import { useInteractionStore } from '../editor2d/session/interactionStore'
import { useViewportStore } from '../editor2d/viewport/viewportStore'
import { screenToWorld } from '../editor2d/viewport/viewportMath'
import type { Vec2 } from '../geometry/vec'
import { t } from '../i18n'

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
/** Press-to-drag threshold — under this many px the gesture is a CLICK
 * (pointer capture delivers every 1px jitter to the card; without the
 * threshold a jittery click was silently cancelled as a chrome-drop). */
const DRAG_THRESHOLD_PX = 5

function ItemCard({ item }: { item: CatalogItem }) {
  const armed = useUiStore((s) => s.toolParams.catalogItemId) === item.id
  const dragRef = useRef<{
    pointerId: number
    started: boolean
    x0: number
    y0: number
  } | null>(null)

  const viewScale = 44 / Math.max(item.dims.w, item.dims.d)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { pointerId: e.pointerId, started: false, x0: e.clientX, y0: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    const drag = dragRef.current
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_THRESHOLD_PX) return
      drag.started = true
    }
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
          furniture: { itemId: item.id, at: over.world, rot: 0, mirrored: false },
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
      // plain click: toggle armed click-to-place. switchTool (never
      // setActiveTool): the outgoing tool must deactivate — disarming via
      // setActiveTool used to skip place-furniture's onDeactivate and leak
      // ghost rotation/mirror state into the next arming
      if (armed) {
        switchTool('select')
        ui.setToolParams({ catalogItemId: null })
      } else {
        ui.setToolParams({ catalogItemId: item.id })
        switchTool('place-furniture')
      }
      return
    }
    // drag path: place at the drop point when it lands on the canvas
    const over = overCanvas(e.clientX, e.clientY)
    if (!over) return // dropped over chrome — cancel
    flushPendingNudge() // the drop must not fold into a pending nudge entry
    const id = useDocStore.getState().addFurniture({
      catalogItemId: item.id,
      x: over.world.x,
      y: over.world.y,
      rotation: 0,
      size: { ...item.dims },
      elevation: item.defaultElevation ?? 0,
    })
    ui.setSelection([id])
    switchTool('select')
    ui.setToolParams({ catalogItemId: null })
  }

  const thumb = getThumbnail(item)

  return (
    <button
      type="button"
      className={`catalog-card${armed ? ' armed' : ''}`}
      title={t('catalog.cardTitle', {
        name: item.name,
        w: Math.round(item.dims.w * 100),
        d: Math.round(item.dims.d * 100),
      })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {thumb ? (
        <img src={thumb} width={64} height={64} alt="" draggable={false} style={{ pointerEvents: 'none' }} />
      ) : (
        <svg width={52} height={52} viewBox="-26 -26 52 52" aria-hidden>
          <g transform={`scale(${viewScale})`}>
            <SymbolRenderer prims={symbolFor(item)} />
          </g>
        </svg>
      )}
      <span>{item.name}</span>
    </button>
  )
}

/** Wall half-thickness + stub length for the style-card preview glyphs. */
const CARD_HALF = 0.075
const CARD_STUB = 0.35

/**
 * Opening style card (0.10.0) — a drawn preview through the REAL glyph
 * pipeline (openingInk + OpeningInkGlyph, non-scaling strokes), never a
 * hand-authored picture. Radio semantics: one style is always armed per
 * kind (standard by default); clicking re-arms, never disarms.
 */
function OpeningStyleCard({ spec }: { spec: OpeningStyleSpec }) {
  const theme = useThemeStore((s) => s.theme)
  const armed = useUiStore(
    (s) =>
      openingStyleSpec(
        spec.kind,
        spec.kind === 'door' ? s.toolParams.doorStyle : s.toolParams.windowStyle,
      ).id === spec.id,
  )
  const width =
    spec.defaults?.width ?? (spec.kind === 'door' ? DEFAULTS.door.width : DEFAULTS.window.width)
  const ink = openingInk(
    (u, v) => ({ x: u, y: v }),
    0,
    width,
    CARD_HALF,
    spec.kind === 'door'
      ? { kind: 'door', hinge: 'a', swing: 'front', style: spec.id }
      : { kind: 'window', style: spec.id },
  )
  // fit box over stubs + ink endpoints (the quarter arcs never leave the
  // rectangle their endpoints span)
  let minX = -CARD_STUB
  let maxX = width + CARD_STUB
  let minY = -CARD_HALF
  let maxY = CARD_HALF
  for (const p of ink) {
    const pts =
      p.kind === 'line'
        ? [
            { x: p.line.x1, y: p.line.y1 },
            { x: p.line.x2, y: p.line.y2 },
          ]
        : [p.arc.from, p.arc.to]
    for (const q of pts) {
      minX = Math.min(minX, q.x)
      maxX = Math.max(maxX, q.x)
      minY = Math.min(minY, q.y)
      maxY = Math.max(maxY, q.y)
    }
  }
  const pad = 0.06
  const scale = 44 / Math.max(maxX - minX + 2 * pad, maxY - minY + 2 * pad)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  return (
    <button
      type="button"
      className={`catalog-card${armed ? ' armed' : ''}`}
      title={spec.name}
      onClick={() =>
        useUiStore
          .getState()
          .setToolParams(spec.kind === 'door' ? { doorStyle: spec.id } : { windowStyle: spec.id })
      }
    >
      <svg width={52} height={52} viewBox="0 0 52 52" aria-hidden>
        {/* the editor renders plan y-up — the card flips the same way */}
        <g transform={`translate(26 26) scale(${scale} ${-scale}) translate(${-cx} ${-cy})`}>
          <rect
            x={-CARD_STUB}
            y={-CARD_HALF}
            width={CARD_STUB}
            height={CARD_HALF * 2}
            fill={theme.wall}
          />
          <rect x={width} y={-CARD_HALF} width={CARD_STUB} height={CARD_HALF * 2} fill={theme.wall} />
          <OpeningInkGlyph prims={ink} variant="plan" />
        </g>
      </svg>
      <span>{spec.name}</span>
    </button>
  )
}

export function CatalogPanel() {
  // isometric thumbnails warm up in idle slices; each progress tick
  // re-renders the cards so they swap from SVG symbols to renders
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [query, setQuery] = useState('')
  useEffect(() => {
    void ensureThumbnails(Object.values(CATALOG), () => bump())
  }, [])

  // mode-aware body (0.10.0): the opening tools swap the furniture grid
  // for the matching style cards; every other tool keeps the catalog
  const openingKind = useUiStore((s) =>
    s.activeTool === 'place-opening' ? s.toolParams.openingKind : null,
  )

  // ranked search (0.9.0): name-prefix > substring > keyword > category
  const matches = query.trim() ? searchCatalog(query) : null

  if (openingKind) {
    const styles = openingStylesFor(openingKind)
    return (
      <aside className="catalog-panel">
        <details open className="catalog-section">
          <summary>
            {t(openingKind === 'door' ? 'catalog.doorStyles' : 'catalog.windowStyles')}{' '}
            <span className="count">{styles.length}</span>
          </summary>
          <div className="catalog-grid">
            {styles.map((s) => (
              <OpeningStyleCard key={s.id} spec={s} />
            ))}
          </div>
        </details>
      </aside>
    )
  }

  return (
    <aside className="catalog-panel">
      <input
        type="search"
        className="catalog-search"
        placeholder={t('catalog.searchPlaceholder')}
        aria-label={t('catalog.searchAria')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {matches ? (
        matches.length ? (
          <div className="catalog-grid">
            {matches.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="hint catalog-empty">{t('catalog.noMatch', { query: query.trim() })}</p>
        )
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const items = CATALOG_BY_CATEGORY[cat]
          if (!items.length) return null
          return (
            <details key={cat} open className="catalog-section">
              <summary>
                {cat} <span className="count">{items.length}</span>
              </summary>
              <div className="catalog-grid">
                {items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>
            </details>
          )
        })
      )}
    </aside>
  )
}
