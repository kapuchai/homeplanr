import type { Vec2 } from '../../geometry/vec'

/**
 * Pill box geometry in SCREEN px — shared by the Pill renderer and the
 * measure layer's clearance math. The box is CENTERED on its anchor
 * (0.5.0 B5), so anything placing a pill next to geometry must clear the
 * box's half-extent ALONG THE OFFSET NORMAL: half-height for horizontal
 * walls, half-WIDTH for vertical ones (the 0.5.0 checklist found side
 * labels sitting on top of vertical walls when a fixed 16 px offset only
 * cleared the 9 px half-height).
 */
export const PILL_H_PX = 18
/** `scale` = the uiScale chrome multiplier (0.7.0). It MUST match what the
 * Pill renderer draws with, or clearance-placed pills sit on their walls —
 * default 1 is load-bearing: the exporter's paper metrics never scale. */
export const pillWidthPx = (text: string, scale = 1): number =>
  (text.length * 6.6 + 12) * scale

/** Half-extent of the (axis-aligned) pill box along unit direction n. */
export const pillHalfExtentPx = (text: string, n: Vec2, scale = 1): number =>
  Math.abs(n.x) * (pillWidthPx(text, scale) / 2) + Math.abs(n.y) * ((PILL_H_PX * scale) / 2)
