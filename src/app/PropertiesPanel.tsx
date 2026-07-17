import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useAppSettings } from '../store/appSettings'
import { formatArea, formatLength, fromDisplayLength, lengthUnitLabel, toDisplayLength } from '../format/units'
import { getDerived } from '../store/derived'
import { dist } from '../geometry/vec'
import { area } from '../geometry/polygon'
import { FLOOR_GROUPS, FLOOR_MATERIALS, PALETTE, WALL_FINISHES, WALL_PAINTS } from '../catalog/palette'
import type { MaterialId } from '../catalog/types'
import { ROOM_TYPES, roomTypeSpec } from '../catalog/roomTypes'
import { CATALOG } from '../catalog'
import { beginTx, commitTx, isTxActive } from '../store/transactions'
import { usePersistStore } from '../store/persistence/controller'
import { ingestImage } from '../store/persistence/imageIngest'
import { LABEL_PLACEHOLDER } from '../editor2d/tools/annotateTextTool'
import { DEFAULTS } from '../model/types'
import type { AnnotationId, FurnitureId, OpeningId, RoomId, WallId } from '../model/ids'
import { t } from '../i18n'

/**
 * Right properties panel. Inputs are DRAFT-BUFFERED (plan-pinned): typing
 * never mutates; commit on Enter or blur as ONE mutation (one undo entry);
 * invalid drafts revert on blur; Esc reverts + blurs WITHOUT committing
 * (handled here — the keymap's Esc-blur is only the net for other fields).
 */

/**
 * Commit-safety for draft-buffered fields (B1, 0.5.0): the commit callback
 * is CAPTURED when the field gains focus. Selection swaps at pointerdown
 * re-render the panel with the NEW entity's onCommit closure BEFORE blur
 * fires — an uncaptured blur-commit writes the typed value into whatever
 * was just clicked. And because entity branches are keyed by id, a swap
 * unmounts the focused input with NO blur at all — the effect cleanup
 * commits the draft through the same capture (mutations no-op on deleted
 * ids). take() clears the capture so blur/unmount can never double-commit;
 * Esc clears it first so nothing commits.
 */
/** Wall-art upload: pick → ingest (downscale/cap) → ONE store mutation.
 * A null ingest (undecodable / won't fit the byte budget) surfaces through
 * the adapter's native message — never silently. */
async function uploadFurnitureImage(id: FurnitureId): Promise<void> {
  const adapter = usePersistStore.getState().adapter
  if (!adapter) return
  const picked = await adapter.openImageDialog()
  if (!picked) return
  const content = await ingestImage(picked.dataUrl)
  if (!content) {
    await adapter.message(t('props.imageFailed.title'), t('props.imageFailed.body'))
    return
  }
  useDocStore.getState().setFurnitureImage(id, content)
}

/** Effective slot color for the picker input: hex override wins, then a
 * PALETTE-id override's color, then the slot default. Always a 6-digit hex
 * (input[type=color] rejects anything else); 3-digit overrides expand. */
function effectiveSlotColor(defaultId: MaterialId, override: string | undefined): string {
  const expand = (h: string) =>
    h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h
  if (override) {
    if (/^#[0-9a-fA-F]{3}$/.test(override) || /^#[0-9a-fA-F]{6}$/.test(override)) {
      return expand(override).toLowerCase()
    }
    const spec = PALETTE[override as MaterialId]
    if (spec) return spec.color
  }
  return PALETTE[defaultId].color
}

function useFocusCommit(draft: string) {
  const capture = useRef<((raw: string) => void) | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const take = useCallback(() => {
    const commit = capture.current
    capture.current = null
    return commit
  }, [])
  useEffect(() => () => take()?.(draftRef.current), [take])
  return { capture, take }
}

function NumField({
  label,
  value,
  onCommit,
  unit = 'm',
  toDisplay = (v: number) => v,
  fromDisplay = (v: number) => v,
  step,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  unit?: string
  toDisplay?: (v: number) => number
  fromDisplay?: (v: number) => number
  step?: number
}) {
  const display = +toDisplay(value).toFixed(3)
  const [draft, setDraft] = useState(String(display))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(String(display))
  }, [display, focused])
  const { capture, take } = useFocusCommit(draft)

  return (
    <label className="prop-field">
      <span>{label}</span>
      <span className="prop-input">
        <input
          type="number"
          value={draft}
          step={step ?? 0.01}
          onFocus={() => {
            setFocused(true)
            capture.current = (raw) => {
              const parsed = Number(raw.replace(',', '.'))
              if (Number.isFinite(parsed)) onCommit(fromDisplay(parsed))
            }
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // invalid drafts revert via the !focused re-sync effect
            setFocused(false)
            take()?.(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              capture.current = null // revert, never commit
              setDraft(String(display))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}

/** NumField in the user's length unit; model values stay meters. */
function LengthField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
}) {
  const units = useAppSettings((s) => s.units)
  return (
    <NumField
      label={label}
      value={value}
      onCommit={onCommit}
      unit={lengthUnitLabel(units)}
      toDisplay={(v) => toDisplayLength(v, units)}
      fromDisplay={(v) => fromDisplayLength(v, units)}
      step={units === 'cm' ? 1 : 0.01}
    />
  )
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
  autoFocus,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (v: string) => void
  /** Focus + select on mount (fresh text labels: click → type). */
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  const { capture, take } = useFocusCommit(draft)
  return (
    <label className="prop-field">
      <span>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => {
          setFocused(true)
          capture.current = (raw) => onCommit(raw)
          if (autoFocus) e.target.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false)
          take()?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            capture.current = null // revert, never commit
            setDraft(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="prop-row">{children}</div>
}


/**
 * One ∅-default swatch + the 14 WALL_PAINTS presets.
 * `current`: a paint id → that swatch active; undefined → ∅ active (field
 * absent); null → nothing active (room row — walls may differ).
 * `hoverSide` (wall rows only): row hover previews the side on the 2D badge.
 */
function PaintSwatchRow({
  label,
  current,
  onPick,
  hoverSide,
}: {
  label: string
  current: string | null | undefined
  onPick: (id: string | undefined) => void
  hoverSide?: 'front' | 'back'
}) {
  const setHighlight = useUiStore((s) => s.setHighlightWallSide)
  useEffect(() => {
    if (!hoverSide) return undefined
    return () => setHighlight(null) // clear a stuck highlight on unmount
  }, [hoverSide, setHighlight])
  return (
    <div
      className="prop-row paint-row"
      onMouseEnter={hoverSide ? () => setHighlight(hoverSide) : undefined}
      onMouseLeave={hoverSide ? () => setHighlight(null) : undefined}
    >
      <span>{label}</span>
      <div className="swatches">
        <button
          type="button"
          title={t('props.paintDefault')}
          aria-label={t('props.paintDefault')}
          aria-pressed={current === undefined}
          className={`swatch swatch-none${current === undefined ? ' active' : ''}`}
          onClick={() => onPick(undefined)}
        />
        {WALL_PAINTS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.name}
            aria-label={p.name}
            aria-pressed={current === p.id}
            className={`swatch${current === p.id ? ' active' : ''}`}
            style={{ background: p.color }}
            onClick={() => onPick(p.id)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Per-side finish row (v5, registry-driven since 0.8.0 M6): one ∅ swatch
 * (plain paint = field absent) + a WALL_FINISHES swatch per spec.
 * `current` null = mixed (multi rows), unknown ids show no active swatch.
 * Row hover previews the side on the 2D badge, like the paint rows.
 */
function FinishSwatchRow({
  label,
  current,
  onPick,
  hoverSide,
}: {
  label: string
  current: string | null | undefined
  onPick: (id: string | undefined) => void
  hoverSide: 'front' | 'back'
}) {
  const setHighlight = useUiStore((s) => s.setHighlightWallSide)
  useEffect(() => () => setHighlight(null), [setHighlight])
  return (
    <div
      className="prop-row paint-row"
      onMouseEnter={() => setHighlight(hoverSide)}
      onMouseLeave={() => setHighlight(null)}
    >
      <span>{label}</span>
      <div className="swatches">
        <button
          type="button"
          title={t('props.finishDefault')}
          aria-label={t('props.finishDefault')}
          aria-pressed={current === undefined}
          className={`swatch swatch-none${current === undefined ? ' active' : ''}`}
          onClick={() => onPick(undefined)}
        />
        {WALL_FINISHES.map((f) => (
          <button
            key={f.id}
            type="button"
            title={f.name}
            aria-label={f.name}
            aria-pressed={current === f.id}
            className={`swatch${current === f.id ? ' active' : ''}`}
            style={{ background: f.swatch }}
            onClick={() => onPick(f.id)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Homogeneous multi-selections (M4) edit shared fields — each apply loops
 * the mutation inside ONE transaction ⇒ one undo entry. Displayed values
 * come from the first item; mixed paint/finish states show no active swatch.
 */
function MultiPanel({ selection }: { selection: string[] }) {
  const doc = useDocStore((s) => s.doc)
  const a = useDocStore.getState()

  const wallIds = selection.filter((id) => doc.walls[id as WallId]) as WallId[]
  const openingIds = selection.filter((id) => doc.openings[id as OpeningId]) as OpeningId[]
  const furnitureIds = selection.filter((id) => doc.furniture[id as FurnitureId]) as FurnitureId[]

  const batch = (fn: () => void) => {
    // a live canvas gesture owns the tx (e.g. an input blur firing after a
    // rotate-handle pointerdown) — preempt-aborting it would resume undo
    // recording mid-drag
    if (isTxActive()) return
    const tx = beginTx()
    fn()
    commitTx(tx)
  }

  if (wallIds.length === selection.length && wallIds.length > 0) {
    const first = doc.walls[wallIds[0]!]!
    const shared = <
      K extends 'thickness' | 'height' | 'finishFront' | 'finishBack' | 'paintFront' | 'paintBack',
    >(
      k: K,
    ) => (wallIds.every((id) => doc.walls[id]![k] === first[k]) ? first[k] : null)
    return (
      // keyed by the id set: a different multi-selection remounts the panel
      // so no focused draft can survive the swap (B1)
      <aside className="props-panel" key={`walls:${wallIds.join()}`}>
        <h3>{t('props.countWalls', { count: wallIds.length })}</h3>
        <LengthField
          label={t('props.thickness')}
          value={first.thickness}
          onCommit={(v) => batch(() => wallIds.forEach((id) => a.updateWall(id, { thickness: v })))}
        />
        <LengthField
          label={t('props.height')}
          value={first.height}
          onCommit={(v) => batch(() => wallIds.forEach((id) => a.updateWall(id, { height: v })))}
        />
        <FinishSwatchRow
          label={t('props.finishFront')}
          current={shared('finishFront')}
          hoverSide="front"
          onPick={(f) =>
            batch(() => wallIds.forEach((id) => a.updateWall(id, { finishFront: f })))
          }
        />
        <FinishSwatchRow
          label={t('props.finishBack')}
          current={shared('finishBack')}
          hoverSide="back"
          onPick={(f) =>
            batch(() => wallIds.forEach((id) => a.updateWall(id, { finishBack: f })))
          }
        />
        <PaintSwatchRow
          label={t('props.paintFront')}
          current={shared('paintFront')}
          hoverSide="front"
          onPick={(pid) => batch(() => wallIds.forEach((id) => a.updateWall(id, { paintFront: pid })))}
        />
        <PaintSwatchRow
          label={t('props.paintBack')}
          current={shared('paintBack')}
          hoverSide="back"
          onPick={(pid) => batch(() => wallIds.forEach((id) => a.updateWall(id, { paintBack: pid })))}
        />
        <p className="hint">{t('props.hint.multiWalls')}</p>
      </aside>
    )
  }

  if (furnitureIds.length === selection.length && furnitureIds.length > 0) {
    const first = doc.furniture[furnitureIds[0]!]!
    return (
      <aside className="props-panel" key={`items:${furnitureIds.join()}`}>
        <h3>{t('props.countItems', { count: furnitureIds.length })}</h3>
        <NumField
          label={t('props.rotation')}
          value={first.rotation}
          unit="°"
          step={5}
          toDisplay={(v) => (v * 180) / Math.PI}
          fromDisplay={(v) => (v * Math.PI) / 180}
          onCommit={(v) =>
            batch(() => furnitureIds.forEach((id) => a.transformFurniture(id, { rotation: v })))
          }
        />
        <LengthField
          label={t('props.elevation')}
          value={first.elevation}
          onCommit={(v) =>
            batch(() => furnitureIds.forEach((id) => a.transformFurniture(id, { elevation: v })))
          }
        />
        <Row>
          <span>{t('props.mirror')}</span>
          <div className="segmented small">
            <button
              type="button"
              onClick={() =>
                batch(() =>
                  furnitureIds.forEach((id) =>
                    a.transformFurniture(id, { mirrored: !doc.furniture[id]!.mirrored }),
                  ),
                )
              }
            >
              {t('props.flipEach')}
            </button>
          </div>
        </Row>
        <p className="hint">{t('props.hint.multiItems')}</p>
      </aside>
    )
  }

  if (openingIds.length === selection.length && openingIds.length > 0) {
    const first = doc.openings[openingIds[0]!]!
    return (
      <aside className="props-panel" key={`openings:${openingIds.join()}`}>
        <h3>{t('props.countOpenings', { count: openingIds.length })}</h3>
        <LengthField
          label={t('props.width')}
          value={first.width}
          onCommit={(v) => batch(() => openingIds.forEach((id) => a.updateOpening(id, { width: v })))}
        />
        <LengthField
          label={t('props.height')}
          value={first.height}
          onCommit={(v) => batch(() => openingIds.forEach((id) => a.updateOpening(id, { height: v })))}
        />
        <p className="hint">{t('props.hint.multiOpenings')}</p>
      </aside>
    )
  }

  const parts = [
    wallIds.length &&
      t(wallIds.length > 1 ? 'props.countWalls' : 'props.countWall', { count: wallIds.length }),
    openingIds.length &&
      t(openingIds.length > 1 ? 'props.countOpenings' : 'props.countOpening', {
        count: openingIds.length,
      }),
    furnitureIds.length &&
      t(furnitureIds.length > 1 ? 'props.countItems' : 'props.countItem', {
        count: furnitureIds.length,
      }),
  ].filter(Boolean)
  return (
    <aside className="props-panel">
      <h3>{t('props.multiSelected', { count: selection.length })}</h3>
      {parts.length > 0 && <p className="hint">{parts.join(' · ')}</p>}
      <p className="hint">{t('props.hint.multiMixed')}</p>
    </aside>
  )
}

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection)
  const doc = useDocStore((s) => s.doc)
  const units = useAppSettings((s) => s.units)
  const snapEnabled = useAppSettings((s) => s.snapEnabled)
  const setSnapEnabled = useAppSettings((s) => s.setSnapEnabled)
  const a = useDocStore.getState()

  if (selection.length > 1) {
    return <MultiPanel selection={selection} />
  }

  const id = selection[0]
  const wall = id ? doc.walls[id as WallId] : undefined
  const opening = id ? doc.openings[id as OpeningId] : undefined
  const furniture = id ? doc.furniture[id as FurnitureId] : undefined
  const room = id ? doc.rooms[id as RoomId] : undefined
  const annotation = id ? doc.annotations[id as AnnotationId] : undefined

  if (annotation) {
    if (annotation.kind === 'dimension') {
      const len = dist(annotation.a, annotation.b)
      return (
        <aside className="props-panel" key={annotation.id}>
          <h3>{t('props.dimension')}</h3>
          <Row>
            <span>{t('props.length')}</span>
            <span className="readonly">{formatLength(len, units)}</span>
          </Row>
          <LengthField
            label={t('props.offset')}
            value={annotation.offset}
            onCommit={(v) => a.updateAnnotation(annotation.id, { offset: v })}
          />
          <p className="hint">{t('props.hint.dimension')}</p>
        </aside>
      )
    }
    if (annotation.kind === 'area') {
      const pts = annotation.points
      const perimeter = pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]!), 0)
      return (
        <aside className="props-panel" key={annotation.id}>
          <h3>{t('props.area')}</h3>
          <Row>
            <span>{t('props.areaValue')}</span>
            <span className="readonly">{formatArea(area(pts), units)}</span>
          </Row>
          <Row>
            <span>{t('props.perimeter')}</span>
            <span className="readonly">{formatLength(perimeter, units)}</span>
          </Row>
          <Row>
            <span>{t('props.vertices')}</span>
            <span className="readonly">{pts.length}</span>
          </Row>
          <p className="hint">{t('props.hint.area')}</p>
        </aside>
      )
    }
    return (
      // key: label→label selection changes REMOUNT the panel — autoFocus
      // only fires on mount, and the click→type flow depends on it
      <aside className="props-panel" key={annotation.id}>
        <h3>{t('props.text')}</h3>
        <TextField
          label={t('props.text')}
          value={annotation.text}
          autoFocus={annotation.text === LABEL_PLACEHOLDER}
          onCommit={(v) => a.updateAnnotation(annotation.id, { text: v })}
        />
        <NumField
          label={t('props.rotation')}
          value={annotation.rotation ?? 0}
          unit="°"
          step={15}
          toDisplay={(v) => (v * 180) / Math.PI}
          fromDisplay={(v) => (v * Math.PI) / 180}
          onCommit={(v) => a.updateAnnotation(annotation.id, { rotation: v })}
        />
        <LengthField
          label={t('props.size')}
          value={annotation.fontSize ?? DEFAULTS.labelFontSize}
          onCommit={(v) => a.updateAnnotation(annotation.id, { fontSize: v })}
        />
        <p className="hint">{t('props.hint.text')}</p>
      </aside>
    )
  }

  if (wall) {
    const na = doc.nodes[wall.a]!
    const nb = doc.nodes[wall.b]!
    const length = dist(na, nb)
    return (
      // key: entity swaps REMOUNT the panel so a focused draft can never
      // meet another entity's closures (B1) — same pattern as annotations
      <aside className="props-panel" key={wall.id}>
        <h3>{t('props.wall')}</h3>
        <LengthField label={t('props.length')} value={length} onCommit={(v) => a.setWallLength(wall.id, v)} />
        <LengthField
          label={t('props.thickness')}
          value={wall.thickness}
          onCommit={(v) => a.updateWall(wall.id, { thickness: v })}
        />
        <LengthField
          label={t('props.height')}
          value={wall.height}
          onCommit={(v) => a.updateWall(wall.id, { height: v })}
        />
        <FinishSwatchRow
          label={t('props.finishFront')}
          current={wall.finishFront}
          hoverSide="front"
          onPick={(f) => a.updateWall(wall.id, { finishFront: f })}
        />
        <FinishSwatchRow
          label={t('props.finishBack')}
          current={wall.finishBack}
          hoverSide="back"
          onPick={(f) => a.updateWall(wall.id, { finishBack: f })}
        />
        <PaintSwatchRow
          label={t('props.paintFront')}
          current={wall.paintFront}
          hoverSide="front"
          onPick={(id) => a.updateWall(wall.id, { paintFront: id })}
        />
        <PaintSwatchRow
          label={t('props.paintBack')}
          current={wall.paintBack}
          hoverSide="back"
          onPick={(id) => a.updateWall(wall.id, { paintBack: id })}
        />
      </aside>
    )
  }

  if (opening) {
    const host = doc.walls[opening.wallId]
    const na = host && doc.nodes[host.a]
    const nb = host && doc.nodes[host.b]
    const L = na && nb ? dist(na, nb) : 0
    const u = opening.t * L
    return (
      <aside className="props-panel" key={opening.id}>
        <h3>{t(opening.kind === 'door' ? 'props.door' : 'props.window')}</h3>
        <LengthField
          label={t('props.width')}
          value={opening.width}
          onCommit={(v) => a.updateOpening(opening.id, { width: v })}
        />
        <LengthField
          label={t('props.height')}
          value={opening.height}
          onCommit={(v) => a.updateOpening(opening.id, { height: v })}
        />
        {opening.kind === 'window' && (
          <LengthField
            label={t('props.sillHeight')}
            value={opening.sillHeight}
            onCommit={(v) => a.updateOpening(opening.id, { sillHeight: v })}
          />
        )}
        {opening.kind === 'door' && (
          <>
            <Row>
              <span>{t('props.hinge')}</span>
              <div className="segmented small">
                <button
                  type="button"
                  className={opening.hinge === 'a' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { hinge: 'a' })}
                >
                  {t('props.hingeA')}
                </button>
                <button
                  type="button"
                  className={opening.hinge === 'b' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { hinge: 'b' })}
                >
                  {t('props.hingeB')}
                </button>
              </div>
            </Row>
            <Row>
              <span>{t('props.swing')}</span>
              <div className="segmented small">
                <button
                  type="button"
                  className={opening.swing === 'front' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { swing: 'front' })}
                >
                  {t('props.swingFront')}
                </button>
                <button
                  type="button"
                  className={opening.swing === 'back' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { swing: 'back' })}
                >
                  {t('props.swingBack')}
                </button>
              </div>
            </Row>
          </>
        )}
        {L > 0 && (
          <>
            <LengthField
              label={t('props.fromEndA')}
              value={u - opening.width / 2}
              onCommit={(v) => a.updateOpening(opening.id, { t: (v + opening.width / 2) / L })}
            />
            <LengthField
              label={t('props.fromEndB')}
              value={L - u - opening.width / 2}
              onCommit={(v) =>
                a.updateOpening(opening.id, { t: (L - v - opening.width / 2) / L })
              }
            />
          </>
        )}
      </aside>
    )
  }

  if (furniture) {
    const item = CATALOG[furniture.catalogItemId]
    return (
      <aside className="props-panel" key={furniture.id}>
        <h3>{item?.name ?? furniture.catalogItemId}</h3>
        <TextField
          label={t('props.name')}
          value={furniture.name ?? ''}
          {...(item ? { placeholder: item.name } : {})}
          onCommit={(v) => a.renameFurniture(furniture.id, v)}
        />
        <LengthField label={t('props.x')} value={furniture.x} onCommit={(v) => a.transformFurniture(furniture.id, { x: v })} />
        <LengthField label={t('props.y')} value={furniture.y} onCommit={(v) => a.transformFurniture(furniture.id, { y: v })} />
        <NumField
          label={t('props.rotation')}
          value={furniture.rotation}
          unit="°"
          step={5}
          toDisplay={(v) => (v * 180) / Math.PI}
          fromDisplay={(v) => (v * Math.PI) / 180}
          onCommit={(v) => a.transformFurniture(furniture.id, { rotation: v })}
        />
        <Row>
          <span>{t('props.mirror')}</span>
          <div className="segmented small">
            <button
              type="button"
              className={furniture.mirrored ? 'active' : ''}
              onClick={() =>
                a.transformFurniture(furniture.id, { mirrored: !furniture.mirrored })
              }
            >
              {t('props.flip')}
            </button>
          </div>
        </Row>
        <LengthField label={t('props.width')} value={furniture.size.w} onCommit={(v) => a.resizeFurniture(furniture.id, { w: v })} />
        <LengthField label={t('props.depth')} value={furniture.size.d} onCommit={(v) => a.resizeFurniture(furniture.id, { d: v })} />
        <LengthField label={t('props.height')} value={furniture.size.h} onCommit={(v) => a.resizeFurniture(furniture.id, { h: v })} />
        <LengthField
          label={t('props.elevation')}
          value={furniture.elevation}
          onCommit={(v) => a.transformFurniture(furniture.id, { elevation: v })}
        />
        {furniture.attachedOpeningId ? (
          <Row>
            <span>{t('props.attachedWindow')}</span>
            <div className="segmented small">
              <button type="button" onClick={() => a.detachFurniture(furniture.id)}>
                {t('props.detach')}
              </button>
            </div>
          </Row>
        ) : null}
        {item?.imageSlot ? (
          <Row>
            <span>{t('props.image')}</span>
            <div className="segmented small">
              <button type="button" onClick={() => void uploadFurnitureImage(furniture.id)}>
                {furniture.assetId ? t('props.imageReplace') : t('props.imageUpload')}
              </button>
              {furniture.assetId ? (
                <button type="button" onClick={() => a.setFurnitureImage(furniture.id, null)}>
                  {t('props.imageRemove')}
                </button>
              ) : null}
            </div>
          </Row>
        ) : null}
        {item ? (
          <>
            <h4>{t('props.colors')}</h4>
            {Object.entries(item.materials).map(([slot, defId]) => {
              const override = furniture.materialOverrides?.[slot]
              return (
                <Row key={slot}>
                  <span>{slot.charAt(0).toUpperCase() + slot.slice(1)}</span>
                  <div className="color-slot">
                    <input
                      type="color"
                      value={effectiveSlotColor(defId, override)}
                      aria-label={t('props.colorFor', { slot })}
                      onChange={(e) =>
                        a.setMaterialOverride(furniture.id, slot, e.target.value)
                      }
                    />
                    {override ? (
                      <button
                        type="button"
                        className="swatch swatch-none"
                        title={t('props.colorReset')}
                        aria-label={t('props.colorReset')}
                        onClick={() => a.setMaterialOverride(furniture.id, slot, undefined)}
                      />
                    ) : null}
                  </div>
                </Row>
              )
            })}
          </>
        ) : null}
      </aside>
    )
  }

  if (room) {
    const derived = getDerived(doc)
    const dr = derived.rooms[room.id]
    return (
      <aside className="props-panel" key={room.id}>
        <h3>{t('props.room')}</h3>
        <TextField
          label={t('props.name')}
          value={room.name ?? ''}
          placeholder={t('props.roomNamePlaceholder')}
          onCommit={(v) => a.renameRoom(room.id, v)}
        />
        <div className="prop-row chip-row">
          <span>{t('props.roomType')}</span>
          <div className="chips">
            <button
              type="button"
              className={`chip${room.roomType === undefined ? ' active' : ''}`}
              onClick={() => a.setRoomType(room.id, undefined)}
            >
              {t('props.roomTypeNone')}
            </button>
            {ROOM_TYPES.map((rt) => (
              <button
                key={rt.id}
                type="button"
                className={`chip${room.roomType === rt.id ? ' active' : ''}`}
                onClick={() => a.setRoomType(room.id, rt.id)}
              >
                {rt.name}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row floor-picker">
          <span>{t('props.floor')}</span>
          <div className="floor-groups">
            {FLOOR_GROUPS.map((g) => (
              // grouped sections (the CatalogPanel details/summary pattern) —
              // the flat 11-swatch row stopped scaling at 17 materials
              <details key={g.id} open>
                <summary>{g.name}</summary>
                <div className="swatches">
                  {FLOOR_MATERIALS.filter((f) => f.group === g.id).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      title={f.name}
                      aria-label={f.name}
                      aria-pressed={(room.floorMaterialId ?? 'woodFloor') === f.id}
                      className={`swatch${(room.floorMaterialId ?? 'woodFloor') === f.id ? ' active' : ''}`}
                      style={{ background: f.color }}
                      onClick={() => a.setRoomFloorMaterial(room.id, f.id)}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
        <PaintSwatchRow
          label={t('props.wallPaint')}
          current={null}
          onPick={(id) => a.paintRoomWalls(room.id, id)}
        />
        {dr && (
          <Row>
            <span>{t('props.area')}</span>
            <span className="readonly">{formatArea(dr.areaM2, units)}</span>
          </Row>
        )}
      </aside>
    )
  }

  // no selection: project settings (keyed too — deselecting while a field
  // is focused must remount, not reuse the input at the same tree position)
  const s = doc.settings
  return (
    <aside className="props-panel" key="project">
      <h3>{t('props.project')}</h3>
      <LengthField label={t('props.gridSize')} value={s.gridSize} onCommit={(v) => a.updateSettings({ gridSize: v })} />
      <Row>
        <span>{t('props.snapping')}</span>
        {/* device preference since v3 — toggling never dirties the file */}
        <div className="segmented small">
          <button
            type="button"
            className={snapEnabled ? 'active' : ''}
            onClick={() => setSnapEnabled(true)}
          >
            {t('common.on')}
          </button>
          <button
            type="button"
            className={!snapEnabled ? 'active' : ''}
            onClick={() => setSnapEnabled(false)}
          >
            {t('common.off')}
          </button>
        </div>
      </Row>
      <LengthField
        label={t('props.newWallThickness')}
        value={s.defaultWallThickness}
        onCommit={(v) => a.updateSettings({ defaultWallThickness: v })}
      />
      <LengthField
        label={t('props.newWallHeight')}
        value={s.defaultWallHeight}
        onCommit={(v) => a.updateSettings({ defaultWallHeight: v })}
      />
      {(() => {
        // plan statistics (0.8.0 roomType semantics): per-type areas in the
        // registry order + an unspecified bucket; total from derived areas
        const drs = Object.values(getDerived(doc).rooms)
        if (!drs.length) return null
        const total = drs.reduce((acc, r) => acc + r.areaM2, 0)
        const byType = new Map<string, { count: number; area: number }>()
        for (const r of drs) {
          const key = roomTypeSpec(r.room.roomType)?.id ?? ''
          const e = byType.get(key) ?? { count: 0, area: 0 }
          e.count += 1
          e.area += r.areaM2
          byType.set(key, e)
        }
        const rows = [
          ...ROOM_TYPES.filter((rt) => byType.has(rt.id)).map((rt) => ({
            label: rt.name,
            ...byType.get(rt.id)!,
          })),
          ...(byType.has('')
            ? [{ label: t('props.statsUnspecified'), ...byType.get('')! }]
            : []),
        ]
        return (
          <div className="plan-stats">
            <h4>{t('props.stats')}</h4>
            <Row>
              <span>{t('props.statsRooms', { count: drs.length })}</span>
              <span className="readonly">{formatArea(total, units)}</span>
            </Row>
            {rows.map((row) => (
              <div className="prop-row stat-row" key={row.label}>
                <span>{row.count > 1 ? `${row.label} × ${row.count}` : row.label}</span>
                <span className="readonly">{formatArea(row.area, units)}</span>
              </div>
            ))}
          </div>
        )
      })()}
      <p className="hint">{t('props.hint.project')}</p>
    </aside>
  )
}
