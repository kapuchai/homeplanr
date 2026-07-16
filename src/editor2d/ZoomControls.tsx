import { useDocStore } from '../store/docStore'
import { useAppSettings } from '../store/appSettings'
import { useViewportStore } from './viewport/viewportStore'
import { K_DEFAULT, KEY_ZOOM_FACTOR } from './viewport/viewportMath'
import { zoomToFitContent } from './tools/keymap'
import { t } from '../i18n'

/**
 * Bottom-right zoom cluster: [−] [NN%] [+] [Fit] [Dim]. Every button swallows
 * its mousedown — a focused button would re-trigger on the next Space press
 * (the pan key). Subscribes only to `k` and the dimensions toggle.
 */
export function ZoomControls() {
  const k = useViewportStore((s) => s.k)
  const showDimensions = useAppSettings((s) => s.showDimensions)
  const snapEnabled = useAppSettings((s) => s.snapEnabled)
  const showGrid = useAppSettings((s) => s.showGrid)
  const zoomAtCenter = (factor: number) => {
    const vp = useViewportStore.getState()
    vp.zoomAtPoint({ x: vp.width / 2, y: vp.height / 2 }, factor)
  }
  return (
    <div className="canvas-controls segmented small">
      <button
        aria-label={t('zoom.out')}
        title={t('zoom.outTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => zoomAtCenter(1 / KEY_ZOOM_FACTOR)}
      >
        -
      </button>
      <button
        className="zoom-level"
        title={t('zoom.reset')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => zoomAtCenter(K_DEFAULT / useViewportStore.getState().k)}
      >
        {Math.round((k / K_DEFAULT) * 100)}%
      </button>
      <button
        aria-label={t('zoom.in')}
        title={t('zoom.inTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => zoomAtCenter(KEY_ZOOM_FACTOR)}
      >
        +
      </button>
      <button
        title={t('zoom.fitTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => zoomToFitContent(useDocStore.getState().doc)}
      >
        {t('zoom.fit')}
      </button>
      <button
        className={showDimensions ? 'active' : ''}
        aria-pressed={showDimensions}
        title={t('zoom.dimTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => useAppSettings.getState().setShowDimensions(!showDimensions)}
      >
        {t('zoom.dim')}
      </button>
      <button
        className={snapEnabled ? 'active' : ''}
        aria-pressed={snapEnabled}
        title={t('zoom.snapTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => useAppSettings.getState().setSnapEnabled(!snapEnabled)}
      >
        {t('zoom.snap')}
      </button>
      <button
        className={showGrid ? 'active' : ''}
        aria-pressed={showGrid}
        title={t('zoom.gridTitle')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => useAppSettings.getState().setShowGrid(!showGrid)}
      >
        {t('zoom.grid')}
      </button>
    </div>
  )
}
