import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useAppSettings } from '../store/appSettings'
import { formatArea, fromDisplayLength, lengthUnitLabel, toDisplayLength } from '../format/units'
import { getDerived } from '../store/derived'
import { dist } from '../geometry/vec'
import { FLOOR_MATERIALS, WALL_PAINTS } from '../catalog/palette'
import { CATALOG } from '../catalog'
import { beginTx, commitTx, isTxActive } from '../store/transactions'
import type { WallFinishId } from '../model/types'
import type { FurnitureId, OpeningId, RoomId, WallId } from '../model/ids'

/**
 * Right properties panel. Inputs are DRAFT-BUFFERED (plan-pinned): typing
 * never mutates; commit on Enter or blur as ONE mutation (one undo entry);
 * invalid drafts revert on blur; Esc reverts + blurs (keymap handles it —
 * shortcuts never fire while an input has focus).
 */
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

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'))
    if (Number.isFinite(parsed)) onCommit(fromDisplay(parsed))
    else setDraft(String(display))
  }

  return (
    <label className="prop-field">
      <span>{label}</span>
      <span className="prop-input">
        <input
          type="number"
          value={draft}
          step={step ?? 0.01}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
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
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])
  return (
    <label className="prop-field">
      <span>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false)
          onCommit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="prop-row">{children}</div>
}

const WALL_FINISHES: readonly [WallFinishId, string][] = [
  ['paint', 'Paint'],
  ['brick', 'Brick'],
  ['concrete', 'Concrete'],
  ['tile', 'Tile'],
]

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
          title="Default"
          className={`swatch swatch-none${current === undefined ? ' active' : ''}`}
          onClick={() => onPick(undefined)}
        />
        {WALL_PAINTS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.name}
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
    const shared = <K extends 'thickness' | 'height' | 'finish' | 'paintFront' | 'paintBack'>(
      k: K,
    ) => (wallIds.every((id) => doc.walls[id]![k] === first[k]) ? first[k] : null)
    const sharedFinish = shared('finish')
    return (
      <aside className="props-panel">
        <h3>{wallIds.length} walls</h3>
        <LengthField
          label="Thickness"
          value={first.thickness}
          onCommit={(v) => batch(() => wallIds.forEach((id) => a.updateWall(id, { thickness: v })))}
        />
        <LengthField
          label="Height"
          value={first.height}
          onCommit={(v) => batch(() => wallIds.forEach((id) => a.updateWall(id, { height: v })))}
        />
        <Row>
          <span>Finish</span>
          <div className="segmented small finish-seg">
            {WALL_FINISHES.map(([f, name]) => (
              <button
                key={f}
                type="button"
                className={(sharedFinish ?? '') === f || (sharedFinish === undefined && f === 'paint') ? 'active' : ''}
                onClick={() => batch(() => wallIds.forEach((id) => a.updateWall(id, { finish: f })))}
              >
                {name}
              </button>
            ))}
          </div>
        </Row>
        <PaintSwatchRow
          label="Paint · front"
          current={shared('paintFront')}
          hoverSide="front"
          onPick={(pid) => batch(() => wallIds.forEach((id) => a.updateWall(id, { paintFront: pid })))}
        />
        <PaintSwatchRow
          label="Paint · back"
          current={shared('paintBack')}
          hoverSide="back"
          onPick={(pid) => batch(() => wallIds.forEach((id) => a.updateWall(id, { paintBack: pid })))}
        />
        <p className="hint">Values apply to every selected wall · Del deletes</p>
      </aside>
    )
  }

  if (furnitureIds.length === selection.length && furnitureIds.length > 0) {
    const first = doc.furniture[furnitureIds[0]!]!
    return (
      <aside className="props-panel">
        <h3>{furnitureIds.length} items</h3>
        <NumField
          label="Rotation"
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
          label="Elevation"
          value={first.elevation}
          onCommit={(v) =>
            batch(() => furnitureIds.forEach((id) => a.transformFurniture(id, { elevation: v })))
          }
        />
        <Row>
          <span>Mirror</span>
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
              Flip each
            </button>
          </div>
        </Row>
        <p className="hint">Drag moves all · R rotates each · Ctrl+D duplicates · Del deletes</p>
      </aside>
    )
  }

  if (openingIds.length === selection.length && openingIds.length > 0) {
    const first = doc.openings[openingIds[0]!]!
    return (
      <aside className="props-panel">
        <h3>{openingIds.length} openings</h3>
        <LengthField
          label="Width"
          value={first.width}
          onCommit={(v) => batch(() => openingIds.forEach((id) => a.updateOpening(id, { width: v })))}
        />
        <LengthField
          label="Height"
          value={first.height}
          onCommit={(v) => batch(() => openingIds.forEach((id) => a.updateOpening(id, { height: v })))}
        />
        <p className="hint">Each opening re-clamps into its wall · Del deletes</p>
      </aside>
    )
  }

  const parts = [
    wallIds.length && `${wallIds.length} wall${wallIds.length > 1 ? 's' : ''}`,
    openingIds.length && `${openingIds.length} opening${openingIds.length > 1 ? 's' : ''}`,
    furnitureIds.length && `${furnitureIds.length} item${furnitureIds.length > 1 ? 's' : ''}`,
  ].filter(Boolean)
  return (
    <aside className="props-panel">
      <h3>{selection.length} selected</h3>
      {parts.length > 0 && <p className="hint">{parts.join(' · ')}</p>}
      <p className="hint">Drag moves items · Del deletes · Esc deselects</p>
    </aside>
  )
}

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection)
  const doc = useDocStore((s) => s.doc)
  const units = useAppSettings((s) => s.units)
  const a = useDocStore.getState()

  if (selection.length > 1) {
    return <MultiPanel selection={selection} />
  }

  const id = selection[0]
  const wall = id ? doc.walls[id as WallId] : undefined
  const opening = id ? doc.openings[id as OpeningId] : undefined
  const furniture = id ? doc.furniture[id as FurnitureId] : undefined
  const room = id ? doc.rooms[id as RoomId] : undefined

  if (wall) {
    const na = doc.nodes[wall.a]!
    const nb = doc.nodes[wall.b]!
    const length = dist(na, nb)
    return (
      <aside className="props-panel">
        <h3>Wall</h3>
        <LengthField label="Length" value={length} onCommit={(v) => a.setWallLength(wall.id, v)} />
        <LengthField
          label="Thickness"
          value={wall.thickness}
          onCommit={(v) => a.updateWall(wall.id, { thickness: v })}
        />
        <LengthField
          label="Height"
          value={wall.height}
          onCommit={(v) => a.updateWall(wall.id, { height: v })}
        />
        <Row>
          <span>Finish</span>
          <div className="segmented small finish-seg">
            {WALL_FINISHES.map(([f, name]) => (
              <button
                key={f}
                type="button"
                className={(wall.finish ?? 'paint') === f ? 'active' : ''}
                onClick={() => a.updateWall(wall.id, { finish: f })}
              >
                {name}
              </button>
            ))}
          </div>
        </Row>
        <PaintSwatchRow
          label="Paint · front"
          current={wall.paintFront}
          hoverSide="front"
          onPick={(id) => a.updateWall(wall.id, { paintFront: id })}
        />
        <PaintSwatchRow
          label="Paint · back"
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
      <aside className="props-panel">
        <h3>{opening.kind === 'door' ? 'Door' : 'Window'}</h3>
        <LengthField
          label="Width"
          value={opening.width}
          onCommit={(v) => a.updateOpening(opening.id, { width: v })}
        />
        <LengthField
          label="Height"
          value={opening.height}
          onCommit={(v) => a.updateOpening(opening.id, { height: v })}
        />
        {opening.kind === 'window' && (
          <LengthField
            label="Sill height"
            value={opening.sillHeight}
            onCommit={(v) => a.updateOpening(opening.id, { sillHeight: v })}
          />
        )}
        {opening.kind === 'door' && (
          <>
            <Row>
              <span>Hinge</span>
              <div className="segmented small">
                <button
                  type="button"
                  className={opening.hinge === 'a' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { hinge: 'a' })}
                >
                  A-side
                </button>
                <button
                  type="button"
                  className={opening.hinge === 'b' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { hinge: 'b' })}
                >
                  B-side
                </button>
              </div>
            </Row>
            <Row>
              <span>Swing</span>
              <div className="segmented small">
                <button
                  type="button"
                  className={opening.swing === 'front' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { swing: 'front' })}
                >
                  Front
                </button>
                <button
                  type="button"
                  className={opening.swing === 'back' ? 'active' : ''}
                  onClick={() => a.updateOpening(opening.id, { swing: 'back' })}
                >
                  Back
                </button>
              </div>
            </Row>
          </>
        )}
        {L > 0 && (
          <>
            <LengthField
              label="From end A"
              value={u - opening.width / 2}
              onCommit={(v) => a.updateOpening(opening.id, { t: (v + opening.width / 2) / L })}
            />
            <LengthField
              label="From end B"
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
      <aside className="props-panel">
        <h3>{item?.name ?? furniture.catalogItemId}</h3>
        <TextField
          label="Name"
          value={furniture.name ?? ''}
          {...(item ? { placeholder: item.name } : {})}
          onCommit={(v) => a.renameFurniture(furniture.id, v)}
        />
        <LengthField label="X" value={furniture.x} onCommit={(v) => a.transformFurniture(furniture.id, { x: v })} />
        <LengthField label="Y" value={furniture.y} onCommit={(v) => a.transformFurniture(furniture.id, { y: v })} />
        <NumField
          label="Rotation"
          value={furniture.rotation}
          unit="°"
          step={5}
          toDisplay={(v) => (v * 180) / Math.PI}
          fromDisplay={(v) => (v * Math.PI) / 180}
          onCommit={(v) => a.transformFurniture(furniture.id, { rotation: v })}
        />
        <Row>
          <span>Mirror</span>
          <div className="segmented small">
            <button
              type="button"
              className={furniture.mirrored ? 'active' : ''}
              onClick={() =>
                a.transformFurniture(furniture.id, { mirrored: !furniture.mirrored })
              }
            >
              Flip
            </button>
          </div>
        </Row>
        <LengthField label="Width" value={furniture.size.w} onCommit={(v) => a.resizeFurniture(furniture.id, { w: v })} />
        <LengthField label="Depth" value={furniture.size.d} onCommit={(v) => a.resizeFurniture(furniture.id, { d: v })} />
        <LengthField label="Height" value={furniture.size.h} onCommit={(v) => a.resizeFurniture(furniture.id, { h: v })} />
        <LengthField
          label="Elevation"
          value={furniture.elevation}
          onCommit={(v) => a.transformFurniture(furniture.id, { elevation: v })}
        />
      </aside>
    )
  }

  if (room) {
    const derived = getDerived(doc)
    const dr = derived.rooms[room.id]
    return (
      <aside className="props-panel">
        <h3>Room</h3>
        <TextField
          label="Name"
          value={room.name ?? ''}
          placeholder="Room"
          onCommit={(v) => a.renameRoom(room.id, v)}
        />
        <Row>
          <span>Floor</span>
          <div className="swatches">
            {FLOOR_MATERIALS.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.name}
                className={`swatch${(room.floorMaterialId ?? 'woodFloor') === f.id ? ' active' : ''}`}
                style={{ background: f.color }}
                onClick={() => a.setRoomFloorMaterial(room.id, f.id)}
              />
            ))}
          </div>
        </Row>
        <PaintSwatchRow
          label="Wall paint"
          current={null}
          onPick={(id) => a.paintRoomWalls(room.id, id)}
        />
        {dr && (
          <Row>
            <span>Area</span>
            <span className="readonly">{formatArea(dr.areaM2, units)}</span>
          </Row>
        )}
      </aside>
    )
  }

  // no selection: project settings
  const s = doc.settings
  return (
    <aside className="props-panel">
      <h3>Project</h3>
      <LengthField label="Grid size" value={s.gridSize} onCommit={(v) => a.updateSettings({ gridSize: v })} />
      <Row>
        <span>Snapping</span>
        <div className="segmented small">
          <button
            type="button"
            className={s.snapEnabled ? 'active' : ''}
            onClick={() => a.updateSettings({ snapEnabled: true })}
          >
            On
          </button>
          <button
            type="button"
            className={!s.snapEnabled ? 'active' : ''}
            onClick={() => a.updateSettings({ snapEnabled: false })}
          >
            Off
          </button>
        </div>
      </Row>
      <LengthField
        label="Wall thickness"
        value={s.defaultWallThickness}
        onCommit={(v) => a.updateSettings({ defaultWallThickness: v })}
      />
      <LengthField
        label="Wall height"
        value={s.defaultWallHeight}
        onCommit={(v) => a.updateSettings({ defaultWallHeight: v })}
      />
      <p className="hint">
        W draw · D door · N window · M measure · V select · Del delete · Ctrl+Z undo · Space pan ·
        Shift+1 fit
      </p>
    </aside>
  )
}
