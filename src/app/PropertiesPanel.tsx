import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useAppSettings } from '../store/appSettings'
import { formatArea, fromDisplayLength, lengthUnitLabel, toDisplayLength } from '../format/units'
import { getDerived } from '../store/derived'
import { dist } from '../geometry/vec'
import { FLOOR_MATERIALS, SCENE_MATERIALS, type FloorMaterialId } from '../catalog/palette'
import { CATALOG } from '../catalog'
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

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection)
  const doc = useDocStore((s) => s.doc)
  const units = useAppSettings((s) => s.units)
  const a = useDocStore.getState()

  if (selection.length > 1) {
    return (
      <aside className="props-panel">
        <h3>{selection.length} items</h3>
        <p className="hint">Drag moves all · R rotates each · Ctrl+D duplicates · Del deletes</p>
      </aside>
    )
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
            {FLOOR_MATERIALS.map((m: FloorMaterialId) => (
              <button
                key={m}
                type="button"
                title={m}
                className={`swatch${(room.floorMaterialId ?? 'woodFloor') === m ? ' active' : ''}`}
                style={{ background: SCENE_MATERIALS[m].color }}
                onClick={() => a.setRoomFloorMaterial(room.id, m)}
              />
            ))}
          </div>
        </Row>
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
        W draw · D door · N window · V select · Del delete · Ctrl+Z undo · Space pan · Shift+1 fit
      </p>
    </aside>
  )
}
