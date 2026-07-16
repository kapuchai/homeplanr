import type { SymbolPrim } from '../../catalog/types'
import { useThemeStore } from '../../theme/themeStore'
import type { Theme2D } from '../../theme/theme2d'

/**
 * Generic renderer for declarative catalog symbols (item-local meters,
 * origin center, front = −y). Roles map to theme styles:
 *  silhouette → strong stroke under the fills (2× width: the fills cover the
 *               inner half + everything interior to the part union, leaving
 *               a ~1.1px border along the union boundary only)
 *  body       → paper fill (masks room color); flattened with silhouettes in
 *               one opacity-0.92 group so overlaps never double-darken
 *  outline    → hairline stroke, no fill
 *  detail     → lighter hairline stroke
 * All strokes are non-scaling (constant px at any zoom). exportPlanSvg
 * mirrors this mapping in paper units — keep the two in agreement.
 */
const buildStyles = (theme: Theme2D) => ({
  silhouette: { fill: 'none', stroke: theme.symbolLine, strokeWidth: 2.2 },
  body: { fill: theme.symbolBody, stroke: 'none' },
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

const inFootprintLayer = (p: SymbolPrim) => p.role === 'silhouette' || p.role === 'body'

function primEl(p: SymbolPrim, i: number, styles: SymbolStyles) {
  const s = styles[p.role]
  const common = { ...s, vectorEffect: 'non-scaling-stroke' as const }
  switch (p.kind) {
    case 'rect':
      return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx} {...common} />
    case 'line':
      return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} {...common} />
    case 'circle':
      return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} {...common} />
    case 'path':
      return <path key={i} d={p.d} {...common} />
  }
}

export function SymbolRenderer({ prims }: { prims: SymbolPrim[] }) {
  // theme via the store (not props) so call sites (WorldLayers, CatalogPanel
  // cards) stay untouched
  const styles = stylesFor(useThemeStore((s) => s.theme))
  return (
    <>
      {/* footprint layer flattened as ONE group: overlapping part fills never
          double-darken, and fills cover silhouette strokes inside the union */}
      <g opacity={0.92}>{prims.filter(inFootprintLayer).map((p, i) => primEl(p, i, styles))}</g>
      {prims.filter((p) => !inFootprintLayer(p)).map((p, i) => primEl(p, i, styles))}
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
