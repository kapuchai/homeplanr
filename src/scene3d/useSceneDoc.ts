import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import type { ProjectDocument } from '../model/types'

/**
 * Hidden-canvas gating (plan-pinned): the 3D scene reads the doc through
 * this hook — LIVE in 3D mode, LATCHED to the last-shown doc while hidden.
 * A 2D drag therefore does ZERO hidden 3D work; the single rebuild happens
 * at the 2D→3D toggle.
 */
export function useSceneDoc(): ProjectDocument {
  const [latched, setLatched] = useState<ProjectDocument>(
    () => useDocStore.getState().doc,
  )
  useEffect(() => {
    const sync = () => {
      if (useUiStore.getState().viewMode !== '3d') return
      const live = useDocStore.getState().doc
      setLatched((prev) => (prev === live ? prev : live))
    }
    sync() // flush on mount / mode flip
    const unsubDoc = useDocStore.subscribe((s) => s.doc, sync)
    const unsubMode = useUiStore.subscribe((s) => s.viewMode, sync)
    return () => {
      unsubDoc()
      unsubMode()
    }
  }, [])
  return latched
}
