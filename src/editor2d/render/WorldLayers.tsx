import { useMemo } from 'react'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { useAppSettings } from '../../store/appSettings'
import { formatArea } from '../../format/units'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived, type DerivedGeometry, type DerivedRoom } from '../../store/derived'
import type { ProjectDocument } from '../../model/types'
import type { Vec2 } from '../../geometry/vec'
import { add, normalize, perp, scale, sub } from '../../geometry/vec'
import { FLOOR_IDS, floorSpec, WALL_PAINTS } from '../../catalog/palette'
import { CATALOG } from '../../catalog'
import { symbolFor } from '../../catalog/symbolFromParts'
import { SymbolRenderer, UnknownSymbol } from './SymbolRenderer'
import { DimensionsLayer } from './DimensionsLayer'
import { rotateHandlePos } from '../tools/handles'
import { useThemeStore } from '../../theme/themeStore'
import type { Theme2D } from '../../theme/theme2d'
import type { WallSolid } from '../../geometry/wallSolids'

/**
 * Read-only world rendering (M2). Layer order (bottom→top): rooms → walls
 * (ONE path incl. patches; opening cover rects) → opening symbols →
 * furniture → room labels → wall dimensions → selection outlines. All
 * strokes non-scaling.
 * M3a refactors to per-entity subscriptions when drags land.
 */
const polyPath = (poly: readonly Vec2[]): string =>
  poly.length ? `M ${poly.map((p) => `${p.x} ${p.y}`).join(' L ')} Z` : ''

const worldPoint = (s: WallSolid, u: number, v: number): Vec2 =>
  add(add(s.frame.origin, scale(s.frame.dir, u)), scale(perp(s.frame.dir), v))

/**
 * Light tint of a floor color: mix(color, white, 0.55) — channels lerp
 * toward 255 (no hex literal here; lint:colors). Memoized per (id, theme).
 */
const floorTints = new WeakMap<Theme2D, Map<string, string>>()
function floorTint(floorId: string, theme: Theme2D): string {
  let byId = floorTints.get(theme)
  if (!byId) {
    byId = new Map()
    floorTints.set(theme, byId)
  }
  const hit = byId.get(floorId)
  if (hit) return hit
  const hex = floorSpec(floorId).color
  const mixed = [0, 1, 2]
    .map((i) => {
      const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
      return Math.round(c + (255 - c) * 0.55)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')
  const out = '#' + mixed
  byId.set(floorId, out)
  return out
}

function roomFill(room: DerivedRoom, theme: Theme2D): string {
  const floorId = room.room.floorMaterialId
  if (floorId !== undefined && FLOOR_IDS.has(floorId)) return floorTint(floorId, theme)
  // id-hash pastel — unchanged so docs without floor materials render as before
  const roomId = room.roomId
  let h = 0
  for (let i = 0; i < roomId.length; i++) h = (h * 31 + roomId.charCodeAt(i)) >>> 0
  return theme.roomFills[h % theme.roomFills.length]!
}

export function WorldLayers() {
  const doc = useDocStore((s) => s.doc)
  const derived = getDerived(doc)
  return (
    <>
      <RoomsLayer derived={derived} />
      <WallsLayer doc={doc} derived={derived} />
      <OpeningsLayer doc={doc} derived={derived} />
      <FurnitureLayer doc={doc} />
      <RoomLabels derived={derived} />
      <DimensionsLayer />
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
  const theme = useThemeStore((s) => s.theme)
  return (
    <g>
      {Object.values(derived.rooms).map((r) => {
        // hide labels for tiny rooms at the current zoom
        if (k * Math.sqrt(r.areaM2) < 48) return null
        const area = formatArea(r.areaM2, units)
        return (
          <g
            key={r.roomId}
            transform={`translate(${r.labelAnchor.x} ${r.labelAnchor.y}) scale(${1 / k} ${-1 / k})`}
            style={{ pointerEvents: 'none' }}
          >
            <text textAnchor="middle" fontSize={11} fill={theme.text} fontWeight={500}>
              {r.room.name ?? 'Room'}
            </text>
            <text textAnchor="middle" y={13} fontSize={10} fill={theme.textMuted}>
              {area}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function WallsLayer({ doc, derived }: { doc: ProjectDocument; derived: DerivedGeometry }) {
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
      const half = wall.thickness / 2 + 0.002
      for (const op of solid.openings) {
        out.push({
          key: op.openingId,
          d: polyPath([
            worldPoint(solid, op.u0, -half),
            worldPoint(solid, op.u1, -half),
            worldPoint(solid, op.u1, half),
            worldPoint(solid, op.u0, half),
          ]),
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

function OpeningsLayer({ doc, derived }: { doc: ProjectDocument; derived: DerivedGeometry }) {
  const theme = useThemeStore((s) => s.theme)
  const hair = {
    stroke: theme.text,
    strokeWidth: 1,
    vectorEffect: 'non-scaling-stroke' as const,
    fill: 'none' as const,
  }
  const els: React.ReactNode[] = []
  for (const solid of Object.values(derived.wallSolids)) {
    const wall = doc.walls[solid.wallId]
    if (!wall) continue
    const half = wall.thickness / 2
    for (const op of solid.openings) {
      const model = doc.openings[op.openingId]
      if (!model) continue
      // jamb ticks across the wall at both ends of the gap
      const jambs = (
        <g key={`${op.openingId}-j`}>
          <line
            x1={worldPoint(solid, op.u0, -half).x}
            y1={worldPoint(solid, op.u0, -half).y}
            x2={worldPoint(solid, op.u0, half).x}
            y2={worldPoint(solid, op.u0, half).y}
            {...hair}
          />
          <line
            x1={worldPoint(solid, op.u1, -half).x}
            y1={worldPoint(solid, op.u1, -half).y}
            x2={worldPoint(solid, op.u1, half).x}
            y2={worldPoint(solid, op.u1, half).y}
            {...hair}
          />
        </g>
      )
      els.push(jambs)
      if (op.kind === 'window') {
        // triple line along the gap
        for (const v of [-half / 2, 0, half / 2]) {
          const a = worldPoint(solid, op.u0, v)
          const b = worldPoint(solid, op.u1, v)
          els.push(
            <line key={`${op.openingId}-w${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...hair} />,
          )
        }
      } else if (model.kind === 'door') {
        const width = op.u1 - op.u0
        const hingeU = model.hinge === 'a' ? op.u0 : op.u1
        const farU = model.hinge === 'a' ? op.u1 : op.u0
        // leaf drawn open 90°: from the hinge jamb corner, perpendicular to
        // the wall on the swing side ('front' = +perp of a→b)
        const swingSign = model.swing === 'front' ? 1 : -1
        const vJamb = swingSign * half
        const hinge = worldPoint(solid, hingeU, vJamb)
        const leafEnd = worldPoint(solid, hingeU, vJamb + swingSign * width)
        const far = worldPoint(solid, farU, vJamb)
        // Empirically pinned by TWO user checks (M2 y-down, M6 y-up): the
        // y-flip mirrors both the sweep sense AND the leaf side, so the
        // original value stands. Do not re-derive from theory — check the
        // rendered arc.
        const sweep = (model.hinge === 'a') === (model.swing === 'front') ? 0 : 1
        els.push(
          <g key={`${op.openingId}-d`}>
            <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} {...hair} />
            <path
              d={`M ${leafEnd.x} ${leafEnd.y} A ${width} ${width} 0 0 ${sweep} ${far.x} ${far.y}`}
              {...hair}
              strokeWidth={0.75}
            />
          </g>,
        )
      }
    }
  }
  return <g>{els}</g>
}

function FurnitureLayer({ doc }: { doc: ProjectDocument }) {
  return (
    <g>
      {Object.values(doc.furniture).map((f) => {
        const item = CATALOG[f.catalogItemId]
        const deg = (f.rotation * 180) / Math.PI
        // trailing scale(-1 1) = reflection across item-local x=0 BEFORE the
        // rotation (SVG lists apply right-to-left): world = T·R·S(-1,1).
        // Symbols are stroke prims — negative scale is safe here (no mesh
        // winding), and non-scaling-stroke widths are unaffected.
        const mirror = f.mirrored ? ' scale(-1 1)' : ''
        return (
          <g key={f.id} transform={`translate(${f.x} ${f.y}) rotate(${deg})${mirror}`}>
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

function SelectionLayer({ doc, derived }: { doc: ProjectDocument; derived: DerivedGeometry }) {
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
    </g>
  )
}

