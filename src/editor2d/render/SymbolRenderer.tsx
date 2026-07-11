import type { SymbolPrim } from '../../catalog/types'
import { theme } from './theme'

/**
 * Generic renderer for declarative catalog symbols (item-local meters,
 * origin center, front = −y). Roles map to theme styles:
 *  body    → near-opaque paper fill (masks room color) + hairline outline
 *  outline → hairline stroke, no fill
 *  detail  → lighter hairline stroke
 * All strokes are non-scaling (constant px at any zoom).
 */
const styles = {
  body: { fill: '#FFFFFF', fillOpacity: 0.92, stroke: '#6B7280', strokeWidth: 1.1 },
  outline: { fill: 'none', stroke: '#6B7280', strokeWidth: 1.1 },
  detail: { fill: 'none', stroke: '#9CA3AF', strokeWidth: 1 },
} as const

export function SymbolRenderer({ prims }: { prims: SymbolPrim[] }) {
  return (
    <>
      {prims.map((p, i) => {
        const s = styles[p.role]
        const common = { ...s, vectorEffect: 'non-scaling-stroke' as const }
        switch (p.kind) {
          case 'rect':
            return (
              <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} {...common} />
            )
          case 'line':
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...common} />
          case 'circle':
            return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} {...common} />
          case 'path':
            return <path key={i} d={p.d} {...common} />
        }
      })}
    </>
  )
}

/** Fallback footprint when a catalog item is unknown (imported docs). */
export function UnknownSymbol({ w, d }: { w: number; d: number }) {
  return (
    <rect
      x={-w / 2}
      y={-d / 2}
      width={w}
      height={d}
      fill="#FFFFFF"
      fillOpacity={0.9}
      stroke={theme.invalid}
      strokeDasharray="4 3"
      strokeWidth={1.1}
      vectorEffect="non-scaling-stroke"
    />
  )
}
