import { useLayoutEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { toolContext } from '../editor2d/tools/toolRegistry'
import {
  alignSelection,
  copySelection,
  deleteSelection,
  distributeSelection,
  duplicateRoom,
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
import { t } from '../i18n'
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
      { label: t('context.duplicate', { n }), shortcut: 'Ctrl+D', onSelect: () => duplicateSelection(ctx) },
      { label: t('context.rotate', { n }), shortcut: 'R', onSelect: () => rotateSelection(ctx, 1) },
      { label: t('context.flip', { n }), shortcut: 'F', onSelect: () => flipSelection(ctx) },
      { label: t('context.copy', { n }), shortcut: 'Ctrl+C', onSelect: () => copySelection(ctx) },
    )
  }
  if (selFurniture.length >= 2) {
    entries.push(
      {
        label: t('context.alignLeft'),
        separatorBefore: true,
        onSelect: () => alignSelection(ctx, 'left'),
      },
      { label: t('context.alignRight'), onSelect: () => alignSelection(ctx, 'right') },
      { label: t('context.alignTop'), onSelect: () => alignSelection(ctx, 'top') },
      { label: t('context.alignBottom'), onSelect: () => alignSelection(ctx, 'bottom') },
    )
    if (selFurniture.length >= 3) {
      entries.push(
        { label: t('context.distributeHorizontally'), onSelect: () => distributeSelection(ctx, 'x') },
        { label: t('context.distributeVertically'), onSelect: () => distributeSelection(ctx, 'y') },
      )
    }
  }
  if (selWalls.length === 1 && selection.length === 1) {
    entries.push({
      label: t('context.splitWall'),
      onSelect: () => splitWallAt(ctx, selWalls[0]! as WallId, menu.world),
    })
  }
  const selRoom =
    selection.length === 1 && doc.rooms[selection[0]! as RoomId] ? selection[0]! : null
  if (selRoom) {
    entries.push({
      label: t('context.rotateRoom'),
      shortcut: 'R',
      onSelect: () => rotateSelection(ctx, 1),
    })
    entries.push({
      label: t('context.rotateRoomCcw'),
      shortcut: 'Shift+R',
      onSelect: () => rotateSelection(ctx, -1),
    })
    entries.push({
      label: t('context.duplicateRoom'),
      onSelect: () => duplicateRoom(ctx, selRoom),
    })
    entries.push({
      label: t('context.copyRoom'),
      shortcut: 'Ctrl+C',
      onSelect: () => copySelection(ctx),
    })
    // right-click auto-selects the room under the cursor, which used to
    // hide the document-level fallback — paste-at-point must stay reachable
    entries.push({
      label: t('context.pasteHere'),
      shortcut: 'Ctrl+V',
      disabled: !hasClipboard(),
      onSelect: () => pasteClipboard(ctx, menu.world),
    })
  }
  if (selection.length && !selRoomsOnly) {
    entries.push({
      label: t('context.zoomToSelection'),
      shortcut: 'Shift+2',
      onSelect: () => zoomToSelection(ctx),
    })
  }
  if (deletable.length) {
    entries.push({
      label:
        deletable.length > 1
          ? t('context.deleteN', { count: deletable.length })
          : t('context.delete'),
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
        label: t('context.pasteHere'),
        shortcut: 'Ctrl+V',
        disabled: !hasClipboard(),
        onSelect: () => pasteClipboard(ctx, menu.world),
      },
      { label: t('context.selectAll'), shortcut: 'Ctrl+A', onSelect: () => selectAll(ctx) },
      { label: t('context.zoomToFit'), shortcut: 'Shift+1', onSelect: () => zoomToFitAll(ctx) },
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
