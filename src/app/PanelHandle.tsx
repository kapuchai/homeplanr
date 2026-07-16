import { useRef, useState } from 'react'
import { PANEL_LIMITS, useAppSettings } from '../store/appSettings'
import { t } from '../i18n'

/**
 * Vertical splitter between a side panel and the editor (M4, 0.4.0).
 * - drag resizes (pointer capture; live width via useAppSettings.setState —
 *   the persisting setter runs once on pointer-up, not per move);
 * - double-click resets the default width;
 * - keyboard: focusable separator, ←/→ resize by 16px, Home/End min/max
 *   (events stop before the window keymap — arrows must not nudge the
 *   canvas selection);
 * - the chevron button collapses/expands the panel (the handle stays).
 */
const KEY_STEP = 16

export function PanelHandle({ panel }: { panel: 'catalog' | 'props' }) {
  const lim = PANEL_LIMITS[panel]
  const widthKey = panel === 'catalog' ? 'catalogPanelWidth' : 'propsPanelWidth'
  const width = useAppSettings((s) => s[widthKey])
  const collapsed = useAppSettings((s) =>
    panel === 'catalog' ? s.catalogPanelCollapsed : s.propsPanelCollapsed,
  )
  const setPanelWidth = useAppSettings((s) => s.setPanelWidth)
  const setPanelCollapsed = useAppSettings((s) => s.setPanelCollapsed)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointerId: number; x0: number; w0: number } | null>(null)

  // the props panel sits RIGHT of the editor: dragging left grows it
  const sign = panel === 'catalog' ? 1 : -1
  const clamp = (w: number) => Math.min(lim.max, Math.max(lim.min, Math.round(w)))

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || collapsed) return
    drag.current = { pointerId: e.pointerId, x0: e.clientX, w0: width }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    useAppSettings.setState({ [widthKey]: clamp(d.w0 + sign * (e.clientX - d.x0)) })
  }
  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    setPanelWidth(panel, useAppSettings.getState()[widthKey]) // persist once
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (collapsed) return
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width - sign * KEY_STEP
    else if (e.key === 'ArrowRight') next = width + sign * KEY_STEP
    else if (e.key === 'Home') next = lim.min
    else if (e.key === 'End') next = lim.max
    if (next === null) return
    e.preventDefault()
    e.stopPropagation() // keep arrows away from the canvas nudge keymap
    setPanelWidth(panel, next)
  }

  const label = panel === 'catalog' ? t('panel.catalog') : t('panel.props')
  // chevron points toward the panel it would collapse; flips when collapsed
  const towardPanel = panel === 'catalog' ? '‹' : '›'
  const awayFromPanel = panel === 'catalog' ? '›' : '‹'

  return (
    <div
      className={`panel-handle${dragging ? ' dragging' : ''}${collapsed ? ' collapsed' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('panel.resize', { label })}
      aria-valuenow={collapsed ? lim.min : width}
      aria-valuemin={lim.min}
      aria-valuemax={lim.max}
      tabIndex={collapsed ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        if (!collapsed) setPanelWidth(panel, lim.def) // inert while collapsed
      }}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="panel-collapse"
        title={collapsed ? t('panel.show', { label }) : t('panel.hide', { label })}
        aria-expanded={!collapsed}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => setPanelCollapsed(panel, !collapsed)}
      >
        {collapsed ? awayFromPanel : towardPanel}
      </button>
    </div>
  )
}
