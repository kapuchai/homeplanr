import { useViewportStore } from '../viewport/viewportStore'
import { useAppSettings } from '../../store/appSettings'
import { useThemeStore } from '../../theme/themeStore'
import { formatArea, formatLength } from '../../format/units'
import { add, dist, normalize, perp, scale, sub } from '../../geometry/vec'
import { area, centroid } from '../../geometry/polygon'
import type { ProjectDocument } from '../../model/types'
import { DEFAULTS } from '../../model/types'
import { Pill } from './Pill'
import { AREA_MIN_PX, DIMENSION_MIN_PX, LABEL_MIN_PX } from '../hit/hitTest'

/**
 * User annotations (v3): persistent dimensions + free text labels.
 * Dimension TEXT is derived here from dist(a,b) + the current unit
 * preference — never stored, so unit switches can't go stale. Labels are
 * world-sized (they scale with the plan), counter-flipped upright against
 * the y-up render transform.
 * Visibility (0.7.0): gated by the showAnnotations device pref; hitTest
 * receives the same flag — hidden must never be hittable.
 */
export function AnnotationsLayer({ doc }: { doc: ProjectDocument }) {
  const show = useAppSettings((s) => s.showAnnotations)
  return show ? <Annotations doc={doc} /> : null
}

function Annotations({ doc }: { doc: ProjectDocument }) {
  const k = useViewportStore((s) => s.k)
  const units = useAppSettings((s) => s.units)
  const theme = useThemeStore((s) => s.theme)
  const px = (n: number) => n / k

  const els: React.ReactNode[] = []
  for (const ann of Object.values(doc.annotations)) {
    if (ann.kind === 'dimension') {
      const len = dist(ann.a, ann.b)
      if (len * k < DIMENSION_MIN_PX) continue // hitTest culls the same set
      const n = scale(perp(normalize(sub(ann.b, ann.a))), 1)
      const off = scale(n, ann.offset)
      const a2 = add(ann.a, off)
      const b2 = add(ann.b, off)
      const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }
      const tick = scale(n, px(4))
      // vector-effect is NOT inheritable — it must sit on each leaf, never
      // the <g> (a container-level attribute silently does nothing and a
      // world-unit strokeWidth would render meter-thick lines)
      const vex = { strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const }
      els.push(
        <g key={ann.id} stroke={theme.textMuted}>
          {ann.offset !== 0 && (
            <>
              <line {...vex} x1={ann.a.x} y1={ann.a.y} x2={a2.x} y2={a2.y} strokeDasharray="2 3" />
              <line {...vex} x1={ann.b.x} y1={ann.b.y} x2={b2.x} y2={b2.y} strokeDasharray="2 3" />
            </>
          )}
          <line {...vex} x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} />
          <line {...vex} x1={a2.x - tick.x} y1={a2.y - tick.y} x2={a2.x + tick.x} y2={a2.y + tick.y} />
          <line {...vex} x1={b2.x - tick.x} y1={b2.y - tick.y} x2={b2.x + tick.x} y2={b2.y + tick.y} />
        </g>,
        <Pill key={`${ann.id}-pill`} at={mid} text={formatLength(len, units)} k={k} tone="measure" />,
      )
    } else if (ann.kind === 'area') {
      const a = area(ann.points)
      if (Math.sqrt(a) * k < AREA_MIN_PX) continue // hitTest culls the same set
      const d = `M ${ann.points.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`
      els.push(
        <path
          key={ann.id}
          d={d}
          fill={theme.textMuted}
          fillOpacity={0.08}
          stroke={theme.textMuted}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />,
        // area text DERIVED at render (shoelace + current units) — never stored
        <Pill
          key={`${ann.id}-pill`}
          at={centroid(ann.points)}
          text={formatArea(a, units)}
          k={k}
          tone="measure"
        />,
      )
    } else {
      const size = ann.fontSize ?? DEFAULTS.labelFontSize
      if (size * k < LABEL_MIN_PX) continue // hitTest culls the same set
      els.push(
        // rotate(+deg): stored θ = world angle +θ — the furniture sign
        // convention, frozen HERE before any saved file can carry a nonzero
        // rotation (flipping it later would change existing plans)
        <g
          key={ann.id}
          transform={`translate(${ann.x} ${ann.y}) rotate(${((ann.rotation ?? 0) * 180) / Math.PI}) scale(1 -1)`}
          style={{ pointerEvents: 'none' }}
        >
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size}
            fill={theme.text}
            fontWeight={500}
          >
            {ann.text}
          </text>
        </g>,
      )
    }
  }
  return <g style={{ pointerEvents: 'none' }}>{els}</g>
}
