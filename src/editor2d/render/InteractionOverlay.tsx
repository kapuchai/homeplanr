import { useInteractionStore } from '../session/interactionStore'
import { useViewportStore } from '../viewport/viewportStore'
import { theme } from './theme'
import type { Vec2 } from '../../geometry/vec'

/**
 * The ONLY per-frame render layer: tool previews, snap indicators,
 * alignment guides, and dimension pills — all fed from interactionStore.
 */
const GUIDE_EXTENT = 2000 // world meters; effectively infinite lines

function Pill({ at, text, k }: { at: Vec2; text: string; k: number }) {
  const w = text.length * 6.6 + 12
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${1 / k})`} pointerEvents="none">
      <rect
        x={-w / 2}
        y={-20}
        width={w}
        height={18}
        rx={5}
        fill="#fff"
        stroke={theme.panelBorder}
      />
      <text textAnchor="middle" y={-7} fontSize={11} fill={theme.text}>
        {text}
      </text>
    </g>
  )
}

export function InteractionOverlay() {
  const preview = useInteractionStore((s) => s.preview)
  const snap = useInteractionStore((s) => s.snap)
  const pills = useInteractionStore((s) => s.pills)
  const k = useViewportStore((s) => s.k)
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
    if (p.to) {
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
    els.push(<Pill key={`p${i}`} at={p.at} text={p.text} k={k} />)
  })

  return <g pointerEvents="none">{els}</g>
}
