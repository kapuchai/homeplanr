import { useLayoutEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { toolContext } from '../editor2d/tools/toolRegistry'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  pasteClipboard,
  rotateSelection,
  selectAll,
  splitWallAt,
  zoomToFitAll,
  zoomToSelection,
} from '../editor2d/commands'
import { hasClipboard } from '../editor2d/clipboard'
import { MenuList, type MenuEntry } from './MenuList'
import type { FurnitureId, RoomId, WallId } from '../model/ids'

/**
 * Canvas right-click menu (M4). Positioned inside the editor root; Editor2D
 * opens it on a sub-slop right CLICK (right-drag pans). Entries act on the
 * CURRENT selection via the shared commands module — identical semantics to
 * the keyboard shortcuts they mirror.
 */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu)
  const selection = useUiStore((s) => s.selection)
  const doc = useDocStore((s) => s.doc)
  const viewMode = useUiStore((s) => s.viewMode)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // Editor2D stays MOUNTED (display:none) in 3D — an open menu must not
  // survive the view switch and keep the keymap guard swallowing keys
  useLayoutEffect(() => {
    if (viewMode !== '2d') useUiStore.getState().setContextMenu(null)
  }, [viewMode])

  // clamp into the editor root once measured (flip away from edges)
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null)
      return
    }
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) {
      setPos({ x: menu.x, y: menu.y })
      return
    }
    const { width: mw, height: mh } = el.getBoundingClientRect()
    const { width: hw, height: hh } = host.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(menu.x, hw - mw - 4)),
      y: Math.max(4, Math.min(menu.y, hh - mh - 4)),
    })
  }, [menu])

  if (!menu) return null
  const close = () => useUiStore.getState().setContextMenu(null)
  const ctx = toolContext

  const selFurniture = selection.filter((id) => doc.furniture[id as FurnitureId])
  const selWalls = selection.filter((id) => doc.walls[id as WallId])
  const selRoomsOnly =
    selection.length > 0 && selection.every((id) => doc.rooms[id as RoomId])
  const deletable = selection.filter((id) => !doc.rooms[id as RoomId])

  const entries: MenuEntry[] = []
  if (selFurniture.length) {
    const n = selFurniture.length > 1 ? ` ${selFurniture.length}` : ''
    entries.push(
      { label: `Duplicate${n}`, shortcut: 'Ctrl+D', onSelect: () => duplicateSelection(ctx) },
      { label: `Rotate${n} 90°`, shortcut: 'R', onSelect: () => rotateSelection(ctx, 1) },
      { label: `Flip${n}`, shortcut: 'F', onSelect: () => flipSelection(ctx) },
      { label: `Copy${n}`, shortcut: 'Ctrl+C', onSelect: () => copySelection(ctx) },
    )
  }
  if (selWalls.length === 1 && selection.length === 1) {
    entries.push({
      label: 'Split wall here',
      onSelect: () => splitWallAt(ctx, selWalls[0]! as WallId, menu.world),
    })
  }
  if (selection.length && !selRoomsOnly) {
    entries.push({
      label: 'Zoom to selection',
      shortcut: 'Shift+2',
      onSelect: () => zoomToSelection(ctx),
    })
  }
  if (deletable.length) {
    entries.push({
      label: `Delete${deletable.length > 1 ? ` ${deletable.length} items` : ''}`,
      shortcut: 'Del',
      danger: true,
      separatorBefore: entries.length > 0,
      onSelect: () => deleteSelection(ctx),
    })
  }
  if (!entries.length) {
    // empty canvas (or room-only selection): document-level actions
    entries.push(
      {
        label: 'Paste here',
        shortcut: 'Ctrl+V',
        disabled: !hasClipboard(),
        onSelect: () => pasteClipboard(ctx, menu.world),
      },
      { label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => selectAll(ctx) },
      { label: 'Zoom to fit', shortcut: 'Shift+1', onSelect: () => zoomToFitAll(ctx) },
    )
  }

  return (
    <>
      <div
        className="context-backdrop"
        onPointerDown={close}
        onContextMenu={(e) => {
          e.preventDefault()
          close()
        }}
      />
      <div
        ref={ref}
        className="context-menu"
        style={{
          position: 'absolute',
          left: pos?.x ?? menu.x,
          top: pos?.y ?? menu.y,
          // opacity (not visibility) for the pre-measure frame: hidden
          // elements are unfocusable, which silently killed MenuList's
          // mount-time focus and with it ALL keyboard navigation
          opacity: pos ? 1 : 0,
          zIndex: 60,
        }}
      >
        <MenuList entries={entries} onClose={close} />
      </div>
    </>
  )
}
