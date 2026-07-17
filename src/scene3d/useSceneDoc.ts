import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useActiveLevel } from '../store/activeLevel'
import { levelDocOf } from '../store/levelView'
import type { LevelDoc } from '../model/types'

/**
 * Hidden-canvas gating (plan-pinned): the 3D scene reads the doc through
 * this hook — LIVE in 3D mode, LATCHED to the last-shown state while
 * hidden. A 2D drag therefore does ZERO hidden 3D work; the single rebuild
 * happens at the 2D→3D toggle.
 *
 * v7: the scene consumes the ACTIVE level's view (identity-stable via
 * levelView's cache, so every derived/renderer memo keys correctly), and a
 * floor switch counts as a doc change — latched in 2D, live in 3D.
 */
export function useSceneDoc(): LevelDoc {
  const [latched, setLatched] = useState<LevelDoc>(() =>
    levelDocOf(useDocStore.getState().doc, useActiveLevel.getState().activeLevelId),
  )
  useEffect(() => {
    const sync = () => {
      if (useUiStore.getState().viewMode !== '3d') return
      const live = levelDocOf(
        useDocStore.getState().doc,
        useActiveLevel.getState().activeLevelId,
      )
      setLatched((prev) => (prev === live ? prev : live))
    }
    sync() // flush on mount / mode flip
    const unsubDoc = useDocStore.subscribe((s) => s.doc, sync)
    const unsubLevel = useActiveLevel.subscribe((s) => s.activeLevelId, sync)
    const unsubMode = useUiStore.subscribe((s) => s.viewMode, sync)
    return () => {
      unsubDoc()
      unsubLevel()
      unsubMode()
    }
  }, [])
  return latched
}
