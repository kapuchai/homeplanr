import { useEffect, type RefObject } from 'react'
import { useViewportStore } from './viewportStore'
import { gridTier } from './viewportMath'
import { useDocStore } from '../../store/docStore'

/**
 * Transient viewport binding (plan-pinned): pan/zoom NEVER re-render world
 * content through React. This hook subscribes imperatively and writes:
 *  - the world <g> transform attribute,
 *  - the grid div's background size/position.
 * Translation is rounded to device pixels so hairlines stay crisp.
 */
export function useViewportTransform(
  worldRef: RefObject<SVGGElement | null>,
  gridRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1
    const apply = () => {
      const { k, tx, ty } = useViewportStore.getState()
      const rtx = Math.round(tx * dpr) / dpr
      const rty = Math.round(ty * dpr) / dpr
      // y-up render: negative y scale (see viewportMath docblock)
      worldRef.current?.setAttribute('transform', `matrix(${k},0,0,${-k},${rtx},${rty})`)
      const grid = gridRef.current
      if (grid) {
        const gridSize = useDocStore.getState().doc.settings.gridSize
        const { minor, major } = gridTier(k, gridSize)
        const mn = minor * k
        const mj = major * k
        grid.style.backgroundSize = `${mj}px ${mj}px, ${mj}px ${mj}px, ${mn}px ${mn}px, ${mn}px ${mn}px`
        grid.style.backgroundPosition = `${rtx}px ${rty}px`
      }
    }
    apply()
    const unsubVp = useViewportStore.subscribe(apply)
    const unsubDoc = useDocStore.subscribe(
      (s) => s.doc.settings.gridSize,
      apply,
    )
    return () => {
      unsubVp()
      unsubDoc()
    }
  }, [worldRef, gridRef])
}
