import { useInteractionStore } from '../session/interactionStore'
import { useViewportStore } from '../viewport/viewportStore'
import { useThemeStore } from '../../theme/themeStore'
import { normalize, perp, scale, sub, type Vec2 } from '../../geometry/vec'
import { CATALOG } from '../../catalog'
import { symbolFor } from '../../catalog/symbolFromParts'
import { furnitureTransform } from './planGeometry'
import { SymbolRenderer } from './SymbolRenderer'
import { Pill } from './Pill'

/**
 * The ONLY per-frame render layer: tool previews, snap indicators,
 * alignment guides, and dimension pills — all fed from interactionStore.
 */
const GUIDE_EXTENT = 2000 // world meters; effectively infinite lines

export function InteractionOverlay() {
  const preview = useInteractionStore((s) => s.preview)
  const snap = useInteractionStore((s) => s.snap)
  const pills = useInteractionStore((s) => s.pills)
  const k = useViewportStore((s) => s.k)
  const theme = useThemeStore((s) => s.theme)
  const px = (n: number) => n / k

  const els: React.ReactNode[] = []

  // --- tool preview ---
  if (preview?.kind === 'wallDraw') {
    if (preview.anchor && preview.cursor) {
      els.push(
        <g key="wd">
          <line
            x1={preview.anchor.x}
            y1={preview.anchor.y}
            x2={preview.cursor.x}
            y2={preview.cursor.y}
            stroke={theme.wall}
            strokeOpacity={0.35}
            strokeWidth={preview.thickness}
            strokeLinecap="butt"
          />
          <line
            x1={preview.anchor.x}
            y1={preview.anchor.y}
            x2={preview.cursor.x}
            y2={preview.cursor.y}
            stroke={theme.accent}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="5 4"
          />
        </g>,
      )
      if (preview.angleBadge) {
        els.push(
          <Pill
            key="wd-angle"
            at={{ x: preview.anchor.x, y: preview.anchor.y - px(26) }}
            text={preview.angleBadge}
            k={k}
          />,
        )
      }
    }
    if (preview.cursor) {
      els.push(
        <circle
          key="wd-cursor"
          cx={preview.cursor.x}
          cy={preview.cursor.y}
          r={px(4)}
          fill={theme.accent}
        />,
      )
    }
  }
  if (preview?.kind === 'areaDraw') {
    const pts = preview.points
    if (pts.length) {
      const chain = pts.map((p) => `${p.x} ${p.y}`).join(' L ')
      els.push(
        <g key="ad" stroke={theme.accent} fill="none">
          <path d={`M ${chain}`} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          {preview.cursor && (
            <line
              x1={pts[pts.length - 1]!.x}
              y1={pts[pts.length - 1]!.y}
              x2={preview.cursor.x}
              y2={preview.cursor.y}
              strokeWidth={1}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {preview.closeHint && (
            <line
              x1={pts[pts.length - 1]!.x}
              y1={pts[pts.length - 1]!.y}
              x2={pts[0]!.x}
              y2={pts[0]!.y}
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>,
      )
      // vertex dots; the first grows into the close target when in range
      els.push(
        <g key="ad-verts" fill={theme.accent}>
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 && preview.closeHint ? 6 : 3)} />
          ))}
        </g>,
      )
    }
    if (preview.cursor) {
      els.push(
        <circle
          key="ad-cursor"
          cx={preview.cursor.x}
          cy={preview.cursor.y}
          r={px(4)}
          fill={theme.accent}
        />,
      )
    }
  }
  if (preview?.kind === 'ghost') {
    els.push(
      <path
        key="ghost"
        d={`M ${preview.polygon.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
        fill={preview.valid ? theme.accentSoft : theme.invalid}
        fillOpacity={0.3}
        stroke={preview.valid ? theme.accent : theme.invalid}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />,
    )
    // door ghosts preview the leaf + swing arc (same doorGlyph as placed
    // doors — the pinned sweep flags flow straight through)
    if (preview.door) {
      const { leaf, arc } = preview.door
      els.push(
        <g key="ghost-door" stroke={theme.accent} fill="none">
          <line {...leaf} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          <path
            d={`M ${arc.from.x} ${arc.from.y} A ${arc.r} ${arc.r} 0 0 ${arc.sweep} ${arc.to.x} ${arc.to.y}`}
            strokeWidth={1}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        </g>,
      )
    }
    // furniture ghosts draw the REAL symbol over the tint underlay via the
    // shared furnitureTransform (ghosts render at natural catalog dims, so
    // no inner size-scale group here)
    const f = preview.furniture
    const item = f ? CATALOG[f.itemId] : null
    if (f && item) {
      els.push(
        <g
          key="ghost-symbol"
          opacity={0.75}
          transform={furnitureTransform(f.at.x, f.at.y, f.rot, f.mirrored)}
        >
          <SymbolRenderer prims={symbolFor(item)} />
        </g>,
      )
    }
  }
  if (preview?.kind === 'marquee') {
    els.push(
      <rect
        key="marquee"
        x={Math.min(preview.a.x, preview.b.x)}
        y={Math.min(preview.a.y, preview.b.y)}
        width={Math.abs(preview.b.x - preview.a.x)}
        height={Math.abs(preview.b.y - preview.a.y)}
        fill={theme.accentSoft}
        fillOpacity={0.15}
        stroke={theme.accent}
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />,
    )
  }

  // --- snap indicators ---
  if (snap?.primary) {
    const c = snap.primary
    if (c.kind === 'node') {
      els.push(
        <circle
          key="sn"
          cx={c.point.x}
          cy={c.point.y}
          r={px(7)}
          fill="none"
          stroke={theme.snap}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />,
      )
    } else if (c.kind === 'wallPoint') {
      els.push(
        <rect
          key="sw"
          x={c.point.x - px(4)}
          y={c.point.y - px(4)}
          width={px(8)}
          height={px(8)}
          fill={theme.snap}
        />,
      )
    } else if (c.kind === 'wallBack') {
      const d = c.slideDir
      els.push(
        <line
          key="sb"
          x1={c.point.x - d.x * GUIDE_EXTENT}
          y1={c.point.y - d.y * GUIDE_EXTENT}
          x2={c.point.x + d.x * GUIDE_EXTENT}
          y2={c.point.y + d.y * GUIDE_EXTENT}
          stroke={theme.snap}
          strokeWidth={1.2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />,
      )
    }
  }
  if (snap?.axes?.x && snap.axes.x.kind === 'guideX') {
    const x = snap.axes.x.display ?? snap.axes.x.value
    els.push(
      <line
        key="gx"
        x1={x}
        y1={-GUIDE_EXTENT}
        x2={x}
        y2={GUIDE_EXTENT}
        stroke={theme.guide}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    )
  }
  if (snap?.axes?.y && snap.axes.y.kind === 'guideY') {
    const y = snap.axes.y.display ?? snap.axes.y.value
    els.push(
      <line
        key="gy"
        x1={-GUIDE_EXTENT}
        y1={y}
        x2={GUIDE_EXTENT}
        y2={y}
        stroke={theme.guide}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    )
  }
  if (snap?.constraint?.kind === 'ray') {
    const { origin, dir } = snap.constraint
    els.push(
      <line
        key="ray"
        x1={origin.x}
        y1={origin.y}
        x2={origin.x + dir.x * GUIDE_EXTENT}
        y2={origin.y + dir.y * GUIDE_EXTENT}
        stroke={theme.accentSoft}
        strokeWidth={1}
        strokeDasharray="2 4"
        vectorEffect="non-scaling-stroke"
      />,
    )
  }

  // --- dimension pills ---
  pills.forEach((p, i) => {
    if (p.from && p.to) {
      // measured span: dashed from→to line with perpendicular end ticks
      const t = scale(perp(normalize(sub(p.to, p.from))), px(3))
      const tick = (c: Vec2, key: string) => (
        <line
          key={key}
          x1={c.x - t.x}
          y1={c.y - t.y}
          x2={c.x + t.x}
          y2={c.y + t.y}
          stroke={theme.textMuted}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )
      els.push(
        <line
          key={`pm${i}`}
          x1={p.from.x}
          y1={p.from.y}
          x2={p.to.x}
          y2={p.to.y}
          stroke={theme.textMuted}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />,
        tick(p.from, `pt${i}a`),
        tick(p.to, `pt${i}b`),
      )
    } else if (p.to) {
      els.push(
        <line
          key={`pl${i}`}
          x1={p.at.x}
          y1={p.at.y}
          x2={p.to.x}
          y2={p.to.y}
          stroke={theme.textMuted}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />,
      )
    }
    els.push(<Pill key={`p${i}`} at={p.at} text={p.text} k={k} tone={p.tone} />)
  })

  return <g pointerEvents="none">{els}</g>
}
