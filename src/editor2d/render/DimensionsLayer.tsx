import { useMemo } from 'react'
import { useActiveLevelDoc } from '../../store/levelView'
import { useAppSettings, type DimensionLevel } from '../../store/appSettings'
import { useUiStore } from '../../store/uiStore'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived } from '../../store/derived'
import {
  dimensionLabels,
  furnitureSizeLabels,
  openingWidthLabels,
} from '../measure/liveMeasurements'
import { Pill } from './Pill'

/**
 * Permanent dimension labels ([Dim] / Shift+D / Options), 0.7.0 ladder:
 * 'walls' → wall lengths, 'openings' → + opening widths, 'all' → + selected
 * furniture w × d. Zoom is subscribed QUANTIZED (4-unit k steps) so
 * continuous zooming doesn't re-render the layer per frame; labels whose
 * measured extent is under 48 screen px are culled.
 */
const MIN_LABEL_PX = 48

export function DimensionsLayer() {
  const level = useAppSettings((s) => s.dimensionLevel)
  return level !== 'off' ? <Labels level={level} /> : null
}

function Labels({ level }: { level: Exclude<DimensionLevel, 'off'> }) {
  const doc = useActiveLevelDoc()
  const units = useAppSettings((s) => s.units)
  const uiScale = useAppSettings((s) => s.uiScale)
  const k = useViewportStore((s) => Math.round(s.k / 4) * 4)
  const selection = useUiStore((s) => s.selection)
  const walls = useMemo(
    () => dimensionLabels(doc, getDerived(doc), units, 1 / k, uiScale),
    [doc, units, k, uiScale],
  )
  const openings = useMemo(
    () =>
      level === 'walls' ? [] : openingWidthLabels(doc, getDerived(doc), units, 1 / k, uiScale),
    [doc, units, k, level, uiScale],
  )
  const sizes = useMemo(
    () => (level === 'all' ? furnitureSizeLabels(doc, selection, units, 1 / k, uiScale) : []),
    [doc, units, k, level, selection, uiScale],
  )
  return (
    <g pointerEvents="none">
      {walls.map((l) =>
        k * l.length < MIN_LABEL_PX ? null : (
          <Pill key={l.wallId} at={l.at} text={l.text} k={k} />
        ),
      )}
      {openings.map((l) =>
        k * l.length < MIN_LABEL_PX ? null : (
          <Pill key={l.openingId} at={l.at} text={l.text} k={k} />
        ),
      )}
      {sizes.map((l) =>
        k * l.length < MIN_LABEL_PX ? null : (
          <Pill key={l.furnitureId} at={l.at} text={l.text} k={k} />
        ),
      )}
    </g>
  )
}
