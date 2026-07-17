import { useMemo } from 'react'
import { useActiveLevelDoc } from '../../store/levelView'
import { useUiStore } from '../../store/uiStore'
import { useAppSettings } from '../../store/appSettings'
import { formatArea } from '../../format/units'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived, type DerivedGeometry } from '../../store/derived'
import type { LevelDoc } from '../../model/types'
import { add, normalize, perp, scale, sub } from '../../geometry/vec'
import { WALL_PAINTS } from '../../catalog/palette'
import { CATALOG } from '../../catalog'
import { symbolFor } from '../../catalog/symbolFromParts'
import { SymbolRenderer, UnknownSymbol } from './SymbolRenderer'
import { OpeningInkGlyph } from './OpeningInkGlyph'
import { DimensionsLayer } from './DimensionsLayer'
import { AnnotationsLayer } from './AnnotationsLayer'
import { furnitureTransform, openingSymbol, polyPath, roomFill, roomLabelLines, worldPoint } from './planGeometry'
import { resizeHandlePositions, rotateHandlePos, roomPivot, roomRotateHandlePos } from '../tools/handles'
import { dimensionSpan, labelBox } from '../hit/hitTest'
import { useThemeStore } from '../../theme/themeStore'

/**
 * Read-only world rendering (M2). Layer order (bottom→top): rooms → walls
 * (ONE path incl. patches; opening cover rects) → opening symbols →
 * furniture → room labels → wall dimensions → selection outlines. All
 * strokes non-scaling. The pure geometry lives in planGeometry.ts, shared
 * with the SVG exporter.
 * M3a refactors to per-entity subscriptions when drags land.
 */

export function WorldLayers() {
  const doc = useActiveLevelDoc()
  const derived = getDerived(doc)
  return (
    <>
      <RoomsLayer derived={derived} />
      <WallsLayer doc={doc} derived={derived} />
      <OpeningsLayer doc={doc} derived={derived} />
      <FurnitureLayer doc={doc} />
      <RoomLabels derived={derived} />
      <DimensionsLayer />
      <AnnotationsLayer doc={doc} />
      <SelectionLayer doc={doc} derived={derived} />
    </>
  )
}

function RoomsLayer({ derived }: { derived: DerivedGeometry }) {
  const theme = useThemeStore((s) => s.theme)
  return (
    <g>
      {Object.values(derived.rooms).map((r) => (
        <path
          key={r.roomId}
          d={[polyPath(r.polygon), ...r.holePolygons.map(polyPath)].join(' ')}
          fillRule="evenodd"
          fill={roomFill(r, theme)}
          fillOpacity={0.6}
          stroke="none"
        />
      ))}
    </g>
  )
}

function RoomLabels({ derived }: { derived: DerivedGeometry }) {
  const k = useViewportStore((s) => s.k)
  const units = useAppSettings((s) => s.units)
  // uiScale (0.7.0): room labels are screen-sized chrome like the pills —
  // the counter-scale group multiplies by it (world-sized text never does)
  const uiScale = useAppSettings((s) => s.uiScale)
  const theme = useThemeStore((s) => s.theme)
  return (
    <g>
      {Object.values(derived.rooms).map((r) => {
        // hide labels for tiny rooms at the current zoom
        if (k * Math.sqrt(r.areaM2) < 48) return null
        const area = formatArea(r.areaM2, units)
        // shared with exportPlanSvg (styling twins — planGeometry owns it)
        const { title, typeLine } = roomLabelLines(r.room)
        return (
          <g
            key={r.roomId}
            transform={`translate(${r.labelAnchor.x} ${r.labelAnchor.y}) scale(${uiScale / k} ${-uiScale / k})`}
            style={{ pointerEvents: 'none' }}
          >
            <text textAnchor="middle" fontSize={11} fill={theme.text} fontWeight={500}>
              {title}
            </text>
            <text textAnchor="middle" y={13} fontSize={10} fill={theme.textMuted}>
              {area}
            </text>
            {typeLine && (
              <text textAnchor="middle" y={25} fontSize={9} fill={theme.textMuted}>
                {typeLine}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function WallsLayer({ doc, derived }: { doc: LevelDoc; derived: DerivedGeometry }) {
  const theme = useThemeStore((s) => s.theme)
  const d = useMemo(() => {
    const parts: string[] = []
    for (const poly of Object.values(derived.outlines.wallPolygons)) parts.push(polyPath(poly))
    for (const patch of Object.values(derived.outlines.nodePatches)) parts.push(polyPath(patch))
    return parts.join(' ')
  }, [derived])

  // paper cover rects mask the wall fill where openings sit
  const covers = useMemo(() => {
    const out: { key: string; d: string }[] = []
    for (const solid of Object.values(derived.wallSolids)) {
      const wall = doc.walls[solid.wallId]
      if (!wall) continue
      for (const op of solid.openings) {
        const model = doc.openings[op.openingId]
        if (!model) continue
        out.push({
          key: op.openingId,
          d: polyPath(openingSymbol(solid, wall, op, model).coverRect),
        })
      }
    }
    return out
  }, [doc, derived])

  return (
    <g>
      <path d={d} fill={theme.wall} fillRule="nonzero" stroke="none" />
      {covers.map((c) => (
        <path key={c.key} d={c.d} fill={theme.paper} stroke="none" />
      ))}
    </g>
  )
}

function OpeningsLayer({ doc, derived }: { doc: LevelDoc; derived: DerivedGeometry }) {
  const els: React.ReactNode[] = []
  for (const solid of Object.values(derived.wallSolids)) {
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    for (const op of solid.openings) {
      const model = doc.openings[op.openingId]
      if (!model) continue
      // all geometry (incl. the EMPIRICALLY PINNED door-arc sweep — see
      // planGeometry + RUNBOOK) comes from the shared helper; styling
      // through the OpeningInkGlyph twin
      const sym = openingSymbol(solid, wall, op, model)
      els.push(
        <g key={op.openingId}>
          <OpeningInkGlyph prims={sym.ink} variant="plan" />
        </g>,
      )
    }
  }
  return <g>{els}</g>
}

function FurnitureLayer({ doc }: { doc: LevelDoc }) {
  return (
    <g>
      {Object.values(doc.furniture).map((f) => {
        const item = CATALOG[f.catalogItemId]
        // symbols are stroke prims — the mirror's negative scale is safe
        // here (no mesh winding), non-scaling-stroke widths unaffected
        return (
          <g key={f.id} transform={furnitureTransform(f.x, f.y, f.rotation, f.mirrored)}>
            {item ? (
              <g
                transform={`scale(${f.size.w / item.dims.w} ${f.size.d / item.dims.d})`}
              >
                <SymbolRenderer prims={symbolFor(item)} />
              </g>
            ) : (
              <UnknownSymbol w={f.size.w} d={f.size.d} />
            )}
          </g>
        )
      })}
    </g>
  )
}

function SelectionLayer({ doc, derived }: { doc: LevelDoc; derived: DerivedGeometry }) {
  const selection = useUiStore((s) => s.selection)
  const hovered = useUiStore((s) => s.hoveredId)
  const highlightSide = useUiStore((s) => s.highlightWallSide)
  const k = useViewportStore((s) => s.k)
  const theme = useThemeStore((s) => s.theme)

  // per-side paint badges on selected walls: +perp dot = front (pinned)
  const paintColor = (id: string | undefined) => WALL_PAINTS.find((p) => p.id === id)?.color
  const sideBadges = selection
    .map((id) => doc.walls[id as never])
    .filter((w) => !!w)
    .map((w) => {
      const na = doc.nodes[w!.a]
      const nb = doc.nodes[w!.b]
      if (!na || !nb) return null
      const side = perp(normalize(sub(nb, na)))
      const mid = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 }
      const off = w!.thickness / 2 + 10 / k
      const r = 5 / k
      const dots = [
        { side: 'front' as const, c: add(mid, scale(side, off)), paint: paintColor(w!.paintFront) },
        { side: 'back' as const, c: add(mid, scale(side, -off)), paint: paintColor(w!.paintBack) },
      ]
      return (
        <g key={`pb-${w!.id}`}>
          {dots.map((d) => (
            <g key={d.side}>
              <circle
                cx={d.c.x}
                cy={d.c.y}
                r={r}
                fill={d.paint ?? theme.handleFill}
                stroke={d.paint ? theme.pillBorder : theme.textMuted}
                strokeWidth={1}
                strokeDasharray={d.paint ? undefined : `${3 / k} ${2 / k}`}
                vectorEffect="non-scaling-stroke"
              />
              {highlightSide === d.side && (
                <circle
                  cx={d.c.x}
                  cy={d.c.y}
                  r={r + 2.5 / k}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          ))}
        </g>
      )
    })

  // rotate handles: every selected furniture item shows one on its front side
  const handles = selection
    .map((id) => doc.furniture[id as never])
    .filter((f) => !!f)
    .map((f) => {
      const pos = rotateHandlePos(f!, 1 / k)
      return (
        <g key={`h-${f!.id}`}>
          <line
            x1={f!.x}
            y1={f!.y}
            x2={pos.x}
            y2={pos.y}
            stroke={theme.accent}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={pos.x}
            cy={pos.y}
            r={7 / k}
            fill={theme.handleFill}
            stroke={theme.accent}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    })
  // room rotate handle (0.8.0): sole-selected room only; anchored above
  // roomPivot — the SAME point the rotation math pivots on (handles.ts).
  // Shown regardless of the label cull: selection implies intent.
  const soleRoom = selection.length === 1 ? derived.rooms[selection[0]! as never] : undefined
  const roomHandle = soleRoom
    ? (() => {
        const pivot = roomPivot(soleRoom)
        const pos = roomRotateHandlePos(pivot, 1 / k)
        return (
          <g key="room-h">
            <line
              x1={pivot.x}
              y1={pivot.y}
              x2={pos.x}
              y2={pos.y}
              stroke={theme.accent}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={pos.x}
              cy={pos.y}
              r={7 / k}
              fill={theme.handleFill}
              stroke={theme.accent}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })()
    : null
  // corner resize handles (M9): single selected furniture only
  const single = selection.length === 1 ? doc.furniture[selection[0]! as never] : undefined
  const resizeHandles = single
    ? resizeHandlePositions(single).map((c, i) => (
        <rect
          key={`rz-${i}`}
          x={c.x - 4 / k}
          y={c.y - 4 / k}
          width={8 / k}
          height={8 / k}
          fill={theme.handleFill}
          stroke={theme.accent}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))
    : null

  const outline = (id: string, color: string, width: number) => {
    const wallPoly = derived.outlines.wallPolygons[id as never]
    if (wallPoly) {
      return (
        <path
          key={`${id}-${color}`}
          d={polyPath(wallPoly)}
          fill="none"
          stroke={color}
          strokeWidth={width}
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    const f = doc.furniture[id as never]
    if (f) {
      const deg = (f.rotation * 180) / Math.PI
      return (
        <g key={`${id}-${color}`} transform={`translate(${f.x} ${f.y}) rotate(${deg})`}>
          <rect
            x={-f.size.w / 2}
            y={-f.size.d / 2}
            width={f.size.w}
            height={f.size.d}
            fill="none"
            stroke={color}
            strokeWidth={width}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    }
    const room = derived.rooms[id as never]
    if (room) {
      return (
        <path
          key={`${id}-${color}`}
          d={polyPath(room.polygon)}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    const ann = doc.annotations[id as never]
    if (ann) {
      if (ann.kind === 'dimension') {
        const { p, q } = dimensionSpan(ann)
        return (
          <line
            key={`${id}-${color}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={color}
            strokeWidth={width + 2}
            strokeOpacity={0.7}
            vectorEffect="non-scaling-stroke"
          />
        )
      }
      if (ann.kind === 'area') {
        return (
          <path
            key={`${id}-${color}`}
            d={`M ${ann.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
            fill="none"
            stroke={color}
            strokeWidth={width + 1}
            strokeOpacity={0.7}
            vectorEffect="non-scaling-stroke"
          />
        )
      }
      const box = labelBox(ann)
      const deg = ((ann.rotation ?? 0) * 180) / Math.PI
      return (
        <g key={`${id}-${color}`} transform={`translate(${ann.x} ${ann.y}) rotate(${deg})`}>
          <rect
            x={-box.w / 2}
            y={-box.d / 2}
            width={box.w}
            height={box.d}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    }
    const op = doc.openings[id as never]
    if (op) {
      const solid = derived.wallSolids[op.wallId]
      const wall = doc.walls[op.wallId]
      const realized = solid?.openings.find((o) => o.openingId === op.id)
      if (solid && wall && realized) {
        const half = wall.thickness / 2 + 0.01
        return (
          <path
            key={`${id}-${color}`}
            d={polyPath([
              worldPoint(solid, realized.u0, -half),
              worldPoint(solid, realized.u1, -half),
              worldPoint(solid, realized.u1, half),
              worldPoint(solid, realized.u0, half),
            ])}
            fill="none"
            stroke={color}
            strokeWidth={width}
            vectorEffect="non-scaling-stroke"
          />
        )
      }
    }
    return null
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      {hovered && !selection.includes(hovered) && outline(hovered, theme.accentSoft, 1.5)}
      {selection.map((id) => outline(id, theme.accent, 1.5))}
      {sideBadges}
      {handles}
      {roomHandle}
      {resizeHandles}
    </g>
  )
}

