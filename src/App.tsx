// App shell (M3a): toolbar with tools + undo/redo + 2D/3D toggle.
// Panels and file persistence land in M3b.
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { Editor2D } from './editor2d/Editor2D'
import { Slice3D } from './scene3d/Slice3D'
import { useDocStore, docTemporal } from './store/docStore'
import { useUiStore, initSelectionPruning } from './store/uiStore'
import { clearHistory, safeRedo, safeUndo } from './store/transactions'
import { buildFixtureDoc } from './test/fixtureDoc'

function Toolbar() {
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const activeTool = useUiStore((s) => s.activeTool)
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const name = useDocStore((s) => s.doc.name)
  const canUndo = useStore(docTemporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(docTemporal, (s) => s.futureStates.length > 0)
  const is2d = viewMode === '2d'

  return (
    <header className="toolbar">
      <span className="brand">homeplanr</span>
      <span className="project-name">{name}</span>
      <div className="segmented" style={{ marginLeft: 16 }}>
        <button
          type="button"
          className={activeTool === 'select' ? 'active' : ''}
          disabled={!is2d}
          onClick={() => setActiveTool('select')}
          title="Select (V)"
        >
          Select
        </button>
        <button
          type="button"
          className={activeTool === 'draw-wall' ? 'active' : ''}
          disabled={!is2d}
          onClick={() => setActiveTool('draw-wall')}
          title="Draw walls (W)"
        >
          Wall
        </button>
      </div>
      <div className="segmented">
        <button type="button" disabled={!canUndo || !is2d} onClick={safeUndo} title="Undo (Ctrl+Z)">
          ↩
        </button>
        <button type="button" disabled={!canRedo || !is2d} onClick={safeRedo} title="Redo (Ctrl+Shift+Z)">
          ↪
        </button>
      </div>
      <div className="spacer" />
      <div className="segmented">
        <button type="button" className={is2d ? 'active' : ''} onClick={() => setViewMode('2d')}>
          2D
        </button>
        <button type="button" className={!is2d ? 'active' : ''} onClick={() => setViewMode('3d')}>
          3D
        </button>
      </div>
    </header>
  )
}

export default function App() {
  const [ready, setReady] = useState(false)
  const viewMode = useUiStore((s) => s.viewMode)

  useEffect(() => {
    // M3a dev bootstrap: fixture apartment (M3b replaces with launch logic)
    useDocStore.getState().replaceDocument(buildFixtureDoc())
    clearHistory()
    const unsub = initSelectionPruning()
    setReady(true)
    return unsub
  }, [])

  return (
    <div className="app-root">
      <Toolbar />
      <main className="content">{ready && (viewMode === '2d' ? <Editor2D /> : <Slice3D />)}</main>
    </div>
  )
}
