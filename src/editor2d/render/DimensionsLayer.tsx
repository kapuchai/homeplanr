import { useMemo } from 'react'
import { useDocStore } from '../../store/docStore'
import { useAppSettings } from '../../store/appSettings'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived } from '../../store/derived'
import { dimensionLabels } from '../measure/liveMeasurements'
import { Pill } from './Pill'

/**
 * Permanent wall-dimension labels ([Dim] / Shift+D / Options). Zoom is
 * subscribed QUANTIZED (4-unit k steps) so continuous zooming doesn't
 * re-render the layer per frame; labels under 48 screen px are culled.
 */
const MIN_LABEL_PX = 48

export function DimensionsLayer() {
  const show = useAppSettings((s) => s.showDimensions)
  return show ? <Labels /> : null
}

function Labels() {
  const doc = useDocStore((s) => s.doc)
  const units = useAppSettings((s) => s.units)
  const k = useViewportStore((s) => Math.round(s.k / 4) * 4)
  const labels = useMemo(
    () => dimensionLabels(doc, getDerived(doc), units, 1 / k),
    [doc, units, k],
  )
  return (
    <g pointerEvents="none">
      {labels.map((l) =>
        k * l.length < MIN_LABEL_PX ? null : (
          <Pill key={l.wallId} at={l.at} text={l.text} k={k} />
        ),
      )}
    </g>
  )
}
