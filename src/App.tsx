// App shell (M3b): toolbar w/ File menu + tools + undo/redo + 2D/3D toggle,
// catalog + properties panels, confirm modal, and real file persistence.
import { useEffect, useRef, useState } from 'react'
import { Editor2D } from './editor2d/Editor2D'
import { PlannerCanvas } from './scene3d/PlannerCanvas'
import { useDocStore } from './store/docStore'
import { useUiStore, initSelectionPruning } from './store/uiStore'
import { safeRedo, safeUndo, useCanUndo, useCanRedo } from './store/transactions'
import {
  launchPersistence,
  newProject,
  openProject,
  openRecent,
  saveProject,
  saveProjectAs,
  usePersistStore,
} from './store/persistence/controller'
import { exportImage } from './export/exportController'
import { switchTool } from './editor2d/tools/toolRegistry'
import { flushPendingNudge } from './editor2d/tools/keymap'
import { CatalogPanel } from './app/CatalogPanel'
import { PropertiesPanel } from './app/PropertiesPanel'
import { ConfirmDialog } from './app/ConfirmDialog'
import { OptionsDialog } from './app/OptionsDialog'
import { ShortcutHelp } from './app/ShortcutHelp'
import { MenuList, type MenuEntry } from './app/MenuList'

// unicode glyphs render inconsistently on WebKitGTK/Windows — inline SVGs
function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.5 3.5 3 7l3.5 3.5" />
      <path d="M3 7h6a4 4 0 0 1 0 8H7" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 3.5 13 7l-3.5 3.5" />
      <path d="M13 7H7a4 4 0 0 0 0 8h2" />
    </svg>
  )
}

function CaretIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <path d="M2 3.5h6L5 7.5Z" />
    </svg>
  )
}

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const recents = usePersistStore((s) => s.recents)
  const canRecent = usePersistStore((s) => !!s.adapter?.readPath)
  const lastSavedAt = usePersistStore((s) => s.lastSavedAt)
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const run = (fn: () => void | Promise<unknown>) => () => {
    flushPendingNudge() // menu actions act on the post-nudge doc
    void fn()
  }
  const entries: MenuEntry[] = [
    { label: 'New', shortcut: 'Ctrl+N', onSelect: run(newProject) },
    { label: 'Open…', shortcut: 'Ctrl+O', onSelect: run(openProject) },
    { label: 'Save', shortcut: 'Ctrl+S', onSelect: run(saveProject) },
    { label: 'Save As…', shortcut: 'Ctrl+Shift+S', onSelect: run(saveProjectAs) },
    { label: 'Export PNG…', separatorBefore: true, onSelect: run(() => exportImage('png')) },
    { label: 'Export SVG…', onSelect: run(() => exportImage('svg')) },
    ...(canRecent && recents.length > 0
      ? recents.map((r, i) => ({
          label: r.name,
          title: r.path,
          separatorBefore: i === 0,
          onSelect: run(() => openRecent(r.path)),
        }))
      : []),
    ...(lastSavedAt !== null
      ? [
          {
            label: `Last saved ${new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
            disabled: true,
            separatorBefore: true,
            onSelect: () => {},
          },
        ]
      : []),
  ]
  return (
    <div className="file-menu">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        File <CaretIcon />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <MenuList entries={entries} onClose={close} />
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
        aria-label="Project name"
        title="Project name — click to rename"
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
  const setToolParams = useUiStore((s) => s.setToolParams)
  const openingKind = useUiStore((s) => s.toolParams.openingKind)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const is2d = viewMode === '2d'

  const toolBtn = (
    label: string,
    active: boolean,
    onClick: () => void,
    title: string,
  ) => (
    <button
      type="button"
      className={active ? 'active' : ''}
      aria-pressed={active}
      disabled={!is2d}
      onClick={onClick}
      title={is2d ? title : 'Available in the 2D view'}
    >
      {label}
    </button>
  )

  return (
    <header className="toolbar">
      <span className="brand">homeplanr</span>
      <FileMenu />
      <ProjectName />
      <div className="segmented" style={{ marginLeft: 12 }}>
        {/* switchTool (never setActiveTool): the outgoing tool must deactivate */}
        {toolBtn('Select', activeTool === 'select', () => switchTool('select'), 'Select (V)')}
        {toolBtn('Wall', activeTool === 'draw-wall', () => switchTool('draw-wall'), 'Draw walls (W)')}
        {toolBtn(
          'Door',
          activeTool === 'place-opening' && openingKind === 'door',
          () => {
            setToolParams({ openingKind: 'door' })
            switchTool('place-opening')
          },
          'Place door (D)',
        )}
        {toolBtn(
          'Window',
          activeTool === 'place-opening' && openingKind === 'window',
          () => {
            setToolParams({ openingKind: 'window' })
            switchTool('place-opening')
          },
          'Place window (N)',
        )}
        {toolBtn('Measure', activeTool === 'measure', () => switchTool('measure'), 'Measure (M)')}
        {toolBtn('Text', activeTool === 'annotate-text', () => switchTool('annotate-text'), 'Text label (T)')}
      </div>
      <div className="segmented">
        <button
          type="button"
          disabled={!canUndo || !is2d}
          onClick={() => {
            // commit a pending nudge first — safeUndo silently no-ops
            // behind an open tx, which would eat the click
            flushPendingNudge()
            safeUndo()
          }}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          disabled={!canRedo || !is2d}
          onClick={() => {
            flushPendingNudge()
            safeRedo()
          }}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          <RedoIcon />
        </button>
      </div>
      <div className="spacer" />
      <button
        type="button"
        className="icon-btn"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        onClick={() => useUiStore.getState().setHelpOpen(true)}
      >
        ?
      </button>
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
        <button
          type="button"
          className={is2d ? 'active' : ''}
          aria-pressed={is2d}
          title="2D plan view"
          onClick={() => setViewMode('2d')}
        >
          2D
        </button>
        <button
          type="button"
          className={!is2d ? 'active' : ''}
          aria-pressed={!is2d}
          title="3D view"
          onClick={() => setViewMode('3d')}
        >
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
      <ShortcutHelp />
      <ConfirmDialog />
    </div>
  )
}
