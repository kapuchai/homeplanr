import { useThemeStore } from '../../theme/themeStore'
import type { Vec2 } from '../../geometry/vec'

/**
 * Dimension pill — shared by the per-frame InteractionOverlay and the
 * permanent DimensionsLayer. `tone: 'passive'` mutes the text (context
 * readouts vs. active measurements).
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
  const w = text.length * 6.6 + 12
  return (
    // counter-scale flips y back (world renders y-up) so text stays upright
    <g transform={`translate(${at.x} ${at.y}) scale(${1 / k} ${-1 / k})`} pointerEvents="none">
      <rect
        x={-w / 2}
        y={-20}
        width={w}
        height={18}
        rx={5}
        fill={theme.pillBg}
        stroke={theme.pillBorder}
      />
      <text
        textAnchor="middle"
        y={-7}
        fontSize={11}
        fill={tone === 'passive' ? theme.textMuted : theme.text}
      >
        {text}
      </text>
    </g>
  )
}
