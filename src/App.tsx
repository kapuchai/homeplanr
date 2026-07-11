// App shell (M2): toolbar with 2D/3D toggle + the read-only editor and the
// thin 3D slice, bootstrapped with the fixture apartment. Real tools,
// panels, and file persistence land in M3a/M3b.
import { useEffect, useState } from 'react'
import { Editor2D } from './editor2d/Editor2D'
import { Slice3D } from './scene3d/Slice3D'
import { useDocStore } from './store/docStore'
import { useUiStore, initSelectionPruning } from './store/uiStore'
import { clearHistory } from './store/transactions'
import { buildFixtureDoc } from './test/fixtureDoc'

export default function App() {
  const [ready, setReady] = useState(false)
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const name = useDocStore((s) => s.doc.name)

  useEffect(() => {
    // M2 dev bootstrap: load the fixture apartment (M3b replaces this with
    // recovery/recent-file launch logic)
    useDocStore.getState().replaceDocument(buildFixtureDoc())
    clearHistory()
    const unsub = initSelectionPruning()
    setReady(true)
    return unsub
  }, [])

  return (
    <div className="app-root">
      <header className="toolbar">
        <span className="brand">homeplanr</span>
        <span className="project-name">{name}</span>
        <div className="spacer" />
        <div className="segmented">
          <button
            type="button"
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
          >
            2D
          </button>
          <button
            type="button"
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => setViewMode('3d')}
          >
            3D
          </button>
        </div>
      </header>
      <main className="content">
        {ready && (viewMode === '2d' ? <Editor2D /> : <Slice3D />)}
      </main>
    </div>
  )
}
