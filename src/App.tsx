// App shell (M3b): toolbar w/ File menu + tools + undo/redo + 2D/3D toggle,
// catalog + properties panels, confirm modal, and real file persistence.
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { Editor2D } from './editor2d/Editor2D'
import { PlannerCanvas } from './scene3d/PlannerCanvas'
import { useDocStore, docTemporal } from './store/docStore'
import { useUiStore, initSelectionPruning } from './store/uiStore'
import { safeRedo, safeUndo } from './store/transactions'
import {
  launchPersistence,
  newProject,
  openProject,
  openRecent,
  saveProject,
  saveProjectAs,
  usePersistStore,
} from './store/persistence/controller'
import { CatalogPanel } from './app/CatalogPanel'
import { PropertiesPanel } from './app/PropertiesPanel'
import { ConfirmDialog } from './app/ConfirmDialog'
import { OptionsDialog } from './app/OptionsDialog'

// unicode ⚙ renders inconsistently on WebKitGTK/Windows — inline SVG instead
function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.6v2.1M8 12.3v2.1M14.4 8h-2.1M3.7 8H1.6M12.5 3.5 11 5M5 11l-1.5 1.5M12.5 12.5 11 11M5 5 3.5 3.5" />
    </svg>
  )
}

function FileMenu() {
  const [open, setOpen] = useState(false)
  const recents = usePersistStore((s) => s.recents)
  const canRecent = usePersistStore((s) => !!s.adapter?.readPath)
  const run = (fn: () => void | Promise<unknown>) => () => {
    setOpen(false)
    void fn()
  }
  return (
    <div className="file-menu">
      <button type="button" onClick={() => setOpen((v) => !v)}>
        File ▾
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu">
            <button type="button" onClick={run(newProject)}>
              New <kbd>Ctrl+N</kbd>
            </button>
            <button type="button" onClick={run(openProject)}>
              Open… <kbd>Ctrl+O</kbd>
            </button>
            <button type="button" onClick={run(saveProject)}>
              Save <kbd>Ctrl+S</kbd>
            </button>
            <button type="button" onClick={run(saveProjectAs)}>
              Save As… <kbd>Ctrl+Shift+S</kbd>
            </button>
            {canRecent && recents.length > 0 && (
              <>
                <div className="menu-sep" />
                {recents.map((r) => (
                  <button key={r.path} type="button" title={r.path} onClick={run(() => openRecent(r.path))}>
                    {r.name}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ProjectName() {
  const name = useDocStore((s) => s.doc.name)
  const dirty = usePersistStore((s) => s.dirty)
  const [draft, setDraft] = useState(name)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setDraft(name)
  }, [name, focused])
  return (
    <span className="project-name">
      <input
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false)
          useDocStore.getState().renameProject(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {dirty && <span className="dirty-dot" title="Unsaved changes">•</span>}
    </span>
  )
}

function Toolbar() {
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  const activeTool = useUiStore((s) => s.activeTool)
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const setToolParams = useUiStore((s) => s.setToolParams)
  const openingKind = useUiStore((s) => s.toolParams.openingKind)
  const canUndo = useStore(docTemporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(docTemporal, (s) => s.futureStates.length > 0)
  const is2d = viewMode === '2d'

  const toolBtn = (
    label: string,
    active: boolean,
    onClick: () => void,
    title: string,
  ) => (
    <button type="button" className={active ? 'active' : ''} disabled={!is2d} onClick={onClick} title={title}>
      {label}
    </button>
  )

  return (
    <header className="toolbar">
      <span className="brand">homeplanr</span>
      <FileMenu />
      <ProjectName />
      <div className="segmented" style={{ marginLeft: 12 }}>
        {toolBtn('Select', activeTool === 'select', () => setActiveTool('select'), 'Select (V)')}
        {toolBtn('Wall', activeTool === 'draw-wall', () => setActiveTool('draw-wall'), 'Draw walls (W)')}
        {toolBtn(
          'Door',
          activeTool === 'place-opening' && openingKind === 'door',
          () => {
            setToolParams({ openingKind: 'door' })
            setActiveTool('place-opening')
          },
          'Place door (D)',
        )}
        {toolBtn(
          'Window',
          activeTool === 'place-opening' && openingKind === 'window',
          () => {
            setToolParams({ openingKind: 'window' })
            setActiveTool('place-opening')
          },
          'Place window (N)',
        )}
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
      <button
        type="button"
        className="icon-btn"
        title="Options"
        aria-label="Options"
        onClick={() => useUiStore.getState().setOptionsOpen(true)}
      >
        <GearIcon />
      </button>
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
  // keep-alive (plan-pinned): mount the 3D canvas lazily on the first
  // toggle, then keep it mounted but hidden — the WebGL context, compiled
  // shaders, and uploaded geometry persist; useSceneDoc latches the doc so
  // the hidden scene does zero work during 2D editing.
  const [everShown3d, setEverShown3d] = useState(false)
  useEffect(() => {
    if (viewMode === '3d') setEverShown3d(true)
  }, [viewMode])

  useEffect(() => {
    const unsub = initSelectionPruning()
    void launchPersistence().finally(() => setReady(true))
    return unsub
  }, [])

  const is2d = viewMode === '2d'
  return (
    <div className="app-root">
      <Toolbar />
      <main className="content">
        {ready && (
          <>
            <div className="view-2d" style={{ display: is2d ? 'flex' : 'none', flex: 1, minWidth: 0 }}>
              <CatalogPanel />
              <Editor2D />
              <PropertiesPanel />
            </div>
            {everShown3d && (
              <div className="view-3d" style={{ display: is2d ? 'none' : 'flex', flex: 1, minWidth: 0 }}>
                <PlannerCanvas />
              </div>
            )}
          </>
        )}
      </main>
      <OptionsDialog />
      <ConfirmDialog />
    </div>
  )
}
