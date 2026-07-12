import type { SymbolPrim } from '../../catalog/types'
import { useThemeStore } from '../../theme/themeStore'
import type { Theme2D } from '../../theme/theme2d'

/**
 * Generic renderer for declarative catalog symbols (item-local meters,
 * origin center, front = −y). Roles map to theme styles:
 *  body    → near-opaque paper fill (masks room color) + hairline outline
 *  outline → hairline stroke, no fill
 *  detail  → lighter hairline stroke
 * All strokes are non-scaling (constant px at any zoom).
 */
const buildStyles = (theme: Theme2D) => ({
  body: {
    fill: theme.symbolBody,
    fillOpacity: 0.92,
    stroke: theme.symbolLine,
    strokeWidth: 1.1,
  },
  outline: { fill: 'none', stroke: theme.symbolLine, strokeWidth: 1.1 },
  detail: { fill: 'none', stroke: theme.symbolDetail, strokeWidth: 1 },
})

type SymbolStyles = ReturnType<typeof buildStyles>

// single-slot memo keyed by theme identity: one styles object per theme flip,
// shared by every symbol instance (this renders per furniture item)
let cache: { key: Theme2D; styles: SymbolStyles } | null = null
function stylesFor(theme: Theme2D): SymbolStyles {
  if (!cache || cache.key !== theme) cache = { key: theme, styles: buildStyles(theme) }
  return cache.styles
}

export function SymbolRenderer({ prims }: { prims: SymbolPrim[] }) {
  // theme via the store (not props) so call sites (WorldLayers, CatalogPanel
  // cards) stay untouched
  const styles = stylesFor(useThemeStore((s) => s.theme))
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
  const theme = useThemeStore((s) => s.theme)
  return (
    <rect
      x={-w / 2}
      y={-d / 2}
      width={w}
      height={d}
      fill={theme.symbolBody}
      fillOpacity={0.9}
      stroke={theme.invalid}
      strokeDasharray="4 3"
      strokeWidth={1.1}
      vectorEffect="non-scaling-stroke"
    />
  )
}
