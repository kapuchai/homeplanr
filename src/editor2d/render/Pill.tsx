import { useThemeStore } from '../../theme/themeStore'
import { useAppSettings } from '../../store/appSettings'
import { PILL_H_PX, pillWidthPx } from './pillMetrics'
import type { Vec2 } from '../../geometry/vec'

/**
 * Dimension pill — shared by the per-frame InteractionOverlay and the
 * permanent DimensionsLayer. `tone: 'passive'` mutes the text (context
 * readouts vs. active measurements).
 * uiScale (0.7.0) is read HERE so every pill renders at the chrome scale;
 * clearance math must pass the same scale into pillMetrics or side labels
 * land on their walls (the B5 lesson).
 */
export function Pill({
  at,
  text,
  k,
  tone,
}: {
  at: Vec2
  text: string
  k: number
  tone?: 'measure' | 'passive'
}) {
  const theme = useThemeStore((s) => s.theme)
  const s = useAppSettings((st) => st.uiScale)
  const w = pillWidthPx(text, s)
  return (
    // counter-scale flips y back (world renders y-up) so text stays upright;
    // the box is CENTERED on the anchor (B5) — an above-anchor box read as
    // asymmetric placement whenever the side rule put a label below a wall
    <g transform={`translate(${at.x} ${at.y}) scale(${1 / k} ${-1 / k})`} pointerEvents="none">
      <rect
        x={-w / 2}
        y={(-PILL_H_PX * s) / 2}
        width={w}
        height={PILL_H_PX * s}
        rx={5 * s}
        fill={theme.pillBg}
        stroke={theme.pillBorder}
      />
      <text
        textAnchor="middle"
        y={4 * s}
        fontSize={11 * s}
        fill={tone === 'passive' ? theme.textMuted : theme.text}
      >
        {text}
      </text>
    </g>
  )
}
