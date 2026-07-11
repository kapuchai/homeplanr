import { forwardRef } from 'react'
import { theme } from '../render/theme'

/**
 * Adaptive grid: a GPU-composited div behind the SVG. Two line weights ×
 * two axes = four layered linear-gradients; size/position are written
 * imperatively by useViewportTransform (zero React re-renders on pan/zoom).
 */
const line = (color: string, deg: number) =>
  `linear-gradient(${deg}deg, ${color} 0px, ${color} 1px, transparent 1px)`

export const GridLayer = forwardRef<HTMLDivElement>(function GridLayer(_, ref) {
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: [
          line(theme.gridMajor, 90),
          line(theme.gridMajor, 180),
          line(theme.gridMinor, 90),
          line(theme.gridMinor, 180),
        ].join(', '),
      }}
    />
  )
})
