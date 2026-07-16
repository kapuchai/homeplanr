// App shell (M3b): toolbar w/ File menu + tools + undo/redo + 2D/3D toggle,
// catalog + properties panels, confirm modal, and real file persistence.
import { useEffect, useRef, useState } from 'react'
import { Editor2D } from './editor2d/Editor2D'
import { PlannerCanvas } from './scene3d/PlannerCanvas'
import { useDocStore } from './store/docStore'
import { useUiStore, initSelectionPruning } from './store/uiStore'
import { safeRedo, safeUndo, useCanUndo, useCanRedo } from './store/transactions'
import { useAppSettings } from './store/appSettings'
import {
  launchPersistence,
  newFromTemplate,
  newProject,
  openProject,
  openRecent,
  saveProject,
  saveProjectAs,
  usePersistStore,
} from './store/persistence/controller'
import { TEMPLATES } from './app/templates'
import { t } from './i18n'
import { switchTool } from './editor2d/tools/toolRegistry'
import { flushPendingNudge } from './editor2d/tools/keymap'
import { CatalogPanel } from './app/CatalogPanel'
import { PanelHandle } from './app/PanelHandle'
import { PropertiesPanel } from './app/PropertiesPanel'
import { ConfirmDialog } from './app/ConfirmDialog'
import { ExportDialog } from './app/ExportDialog'
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
  // FILLED cog silhouette, 8 teeth + evenodd center hole (user pick, 0.6.0).
  // Strokes never read right at 16px: 0.4.0's thin rays looked like a sun,
  // 0.5.0's chunky spokes like an asterisk. Vertices generated radially
  // (tip r=7.2 spanning ±8.5°, root r=5.3 spanning ±15°) — regenerate with
  // that math rather than nudging points by hand.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M13.12 6.63 L15.12 6.94 L15.12 9.06 L13.12 9.37 L12.59 10.65 L13.79 12.28 L12.28 13.79 L10.65 12.59 L9.37 13.12 L9.06 15.12 L6.94 15.12 L6.63 13.12 L5.35 12.59 L3.72 13.79 L2.21 12.28 L3.41 10.65 L2.88 9.37 L0.88 9.06 L0.88 6.94 L2.88 6.63 L3.41 5.35 L2.21 3.72 L3.72 2.21 L5.35 3.41 L6.63 2.88 L6.94 0.88 L9.06 0.88 L9.37 2.88 L10.65 3.41 L12.28 2.21 L13.79 3.72 L12.59 5.35 Z M10.2 8 a2.2 2.2 0 1 1 -4.4 0 a2.2 2.2 0 1 1 4.4 0 Z"
      />
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
    { label: t('menu.new'), shortcut: 'Ctrl+N', onSelect: run(newProject) },
    ...TEMPLATES.map((tpl, i) => ({
      label: t('menu.newTemplate', { name: tpl.name }),
      ...(i === 0 ? { separatorBefore: true } : {}),
      onSelect: run(() => newFromTemplate(tpl.name, tpl.raw)),
    })),
    { label: t('menu.open'), shortcut: 'Ctrl+O', separatorBefore: true, onSelect: run(openProject) },
    { label: t('menu.save'), shortcut: 'Ctrl+S', onSelect: run(saveProject) },
    { label: t('menu.saveAs'), shortcut: 'Ctrl+Shift+S', onSelect: run(saveProjectAs) },
    {
      label: t('menu.export'),
      separatorBefore: true,
      onSelect: run(() => useUiStore.getState().setExportOpen(true)),
    },
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
            label: t('menu.lastSaved', {
              time: new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
            }),
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
        {t('menu.file')} <CaretIcon />
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
        aria-label={t('toolbar.projectNameAria')}
        title={t('toolbar.projectNameTitle')}
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
      {dirty && <span className="dirty-dot" title={t('toolbar.unsavedChanges')}>•</span>}
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
      title={is2d ? title : t('tool.disabledIn3d')}
    >
      {label}
    </button>
  )

  return (
    <header className="toolbar">
      <span className="brand">{t('toolbar.brand')}</span>
      <FileMenu />
      <ProjectName />
      {/* two tool groups (0.5.0): selection/annotation vs construction */}
      <div className="segmented" style={{ marginLeft: 12 }}>
        {/* switchTool (never setActiveTool): the outgoing tool must deactivate */}
        {toolBtn(t('tool.select'), activeTool === 'select', () => switchTool('select'), t('tool.selectTitle'))}
        {toolBtn(t('tool.measure'), activeTool === 'measure', () => switchTool('measure'), t('tool.measureTitle'))}
        {toolBtn(t('tool.text'), activeTool === 'annotate-text', () => switchTool('annotate-text'), t('tool.textTitle'))}
      </div>
      <div className="segmented">
        {toolBtn(t('tool.wall'), activeTool === 'draw-wall', () => switchTool('draw-wall'), t('tool.wallTitle'))}
        {toolBtn(
          t('tool.door'),
          activeTool === 'place-opening' && openingKind === 'door',
          () => {
            setToolParams({ openingKind: 'door' })
            switchTool('place-opening')
          },
          t('tool.doorTitle'),
        )}
        {toolBtn(
          t('tool.window'),
          activeTool === 'place-opening' && openingKind === 'window',
          () => {
            setToolParams({ openingKind: 'window' })
            switchTool('place-opening')
          },
          t('tool.windowTitle'),
        )}
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
          title={t('toolbar.undoTitle')}
          aria-label={t('toolbar.undo')}
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
          title={t('toolbar.redoTitle')}
          aria-label={t('toolbar.redo')}
        >
          <RedoIcon />
        </button>
      </div>
      <div className="spacer" />
      {/* right cluster order (user pick, 0.6.0): [2D 3D] then ? and gear
          at the outer edge */}
      <div className="segmented">
        <button
          type="button"
          className={is2d ? 'active' : ''}
          aria-pressed={is2d}
          title={t('toolbar.view2dTitle')}
          onClick={() => setViewMode('2d')}
        >
          {t('toolbar.view2d')}
        </button>
        <button
          type="button"
          className={!is2d ? 'active' : ''}
          aria-pressed={!is2d}
          title={t('toolbar.view3dTitle')}
          onClick={() => setViewMode('3d')}
        >
          {t('toolbar.view3d')}
        </button>
      </div>
      <button
        type="button"
        className="icon-btn"
        title={t('toolbar.helpTitle')}
        aria-label={t('shortcuts.title')}
        onClick={() => useUiStore.getState().setHelpOpen(true)}
      >
        ?
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t('options.title')}
        aria-label={t('options.title')}
        onClick={() => useUiStore.getState().setOptionsOpen(true)}
      >
        <GearIcon />
      </button>
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
  const catalogW = useAppSettings((s) => s.catalogPanelWidth)
  const propsW = useAppSettings((s) => s.propsPanelWidth)
  const catalogCollapsed = useAppSettings((s) => s.catalogPanelCollapsed)
  const propsCollapsed = useAppSettings((s) => s.propsPanelCollapsed)
  const view2dClass =
    'view-2d' +
    (catalogCollapsed ? ' catalog-collapsed' : '') +
    (propsCollapsed ? ' props-collapsed' : '')
  return (
    <div className="app-root">
      <Toolbar />
      <main className="content">
        {ready && (
          <>
            <div
              className={view2dClass}
              style={
                {
                  display: is2d ? 'flex' : 'none',
                  flex: 1,
                  minWidth: 0,
                  '--catalog-w': `${catalogW}px`,
                  '--props-w': `${propsW}px`,
                } as React.CSSProperties
              }
            >
              <CatalogPanel />
              <PanelHandle panel="catalog" />
              <Editor2D />
              <PanelHandle panel="props" />
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
      <ExportDialog />
      <ShortcutHelp />
      <ConfirmDialog />
    </div>
  )
}
