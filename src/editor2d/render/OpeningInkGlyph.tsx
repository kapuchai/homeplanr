import type { OpeningPrim } from './planGeometry'
import { arcPath } from './planGeometry'
import { useThemeStore } from '../../theme/themeStore'

/**
 * The editor-side styling twin for opening ink (the other is
 * exportPlanSvg's ink emitter — keep the two in agreement). Renders the
 * role-tagged prims from planGeometry.openingInk:
 *  - 'plan':  placed openings (OpeningsLayer) and catalog style cards —
 *    text-ink hairlines, swing arcs slightly lighter (0.75), dashed roles
 *    dashed.
 *  - 'ghost': the place-opening preview — accent strokes, leaf emphasized
 *    (1.2), swing arcs always dashed (the pre-0.10.0 ghost convention).
 */
export function OpeningInkGlyph({
  prims,
  variant,
}: {
  prims: readonly OpeningPrim[]
  variant: 'plan' | 'ghost'
}) {
  const theme = useThemeStore((s) => s.theme)
  const ghost = variant === 'ghost'
  return (
    <g stroke={ghost ? theme.accent : theme.text} fill="none">
      {prims.map((p, i) => {
        const dashed = p.kind === 'arc' ? ghost : p.dashed === true
        const width =
          p.kind === 'arc' ? (ghost ? 1 : 0.75) : ghost && p.role === 'leaf' ? 1.2 : 1
        const common = {
          strokeWidth: width,
          vectorEffect: 'non-scaling-stroke' as const,
          ...(dashed ? { strokeDasharray: '4 3' } : {}),
        }
        return p.kind === 'line' ? (
          <line key={i} {...p.line} {...common} />
        ) : (
          <path key={i} d={arcPath(p.arc)} {...common} />
        )
      })}
    </g>
  )
}
