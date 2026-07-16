/**
 * THE shortcut table (M8) — the '?' overlay renders this, and the keymap
 * drift test asserts every binding it exercises appears here. One module so
 * the sheet and the bindings can't diverge silently.
 */
import { t } from '../i18n'

export interface ShortcutRow {
  keys: string
  does: string
}

export interface ShortcutSection {
  title: string
  rows: ShortcutRow[]
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: t('shortcuts.section.tools'),
    rows: [
      { keys: 'V', does: t('shortcuts.does.select') },
      { keys: 'W', does: t('shortcuts.does.drawWalls') },
      { keys: 'D', does: t('shortcuts.does.placeDoor') },
      { keys: 'N', does: t('shortcuts.does.placeWindow') },
      { keys: 'M', does: t('shortcuts.does.tapeMeasure') },
      { keys: 'A', does: t('shortcuts.does.areaTool') },
      { keys: 'T', does: t('shortcuts.does.textLabel') },
      { keys: 'Esc', does: t('shortcuts.does.cancel') },
    ],
  },
  {
    title: t('shortcuts.section.selection'),
    rows: [
      { keys: 'Drag', does: t('shortcuts.does.marquee') },
      { keys: 'Shift+drag / click', does: t('shortcuts.does.addToSelection') },
      { keys: 'Ctrl+A', does: t('shortcuts.does.selectAll') },
      { keys: 'Alt+click / repeat click', does: t('shortcuts.does.cycleOverlapping') },
      { keys: 'Right-click', does: t('shortcuts.does.contextMenu') },
      { keys: 'R / Shift+R', does: t('shortcuts.does.rotate') },
      { keys: 'F', does: t('shortcuts.does.flip') },
      { keys: 'Arrows', does: t('shortcuts.does.nudge') },
      { keys: 'Ctrl+D', does: t('shortcuts.does.duplicate') },
      { keys: 'Ctrl+C / Ctrl+V', does: t('shortcuts.does.copyPaste') },
      { keys: 'Del', does: t('shortcuts.does.delete') },
      { keys: 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', does: t('shortcuts.does.undoRedo') },
    ],
  },
  {
    title: t('shortcuts.section.drawing'),
    rows: [
      { keys: 'Enter', does: t('shortcuts.does.finishWall') },
      { keys: 'Backspace', does: t('shortcuts.does.stepBack') },
      { keys: 'Double-click', does: t('shortcuts.does.finishWallDouble') },
      { keys: 'Hold Ctrl', does: t('shortcuts.does.suspendSnap') },
      { keys: 'S', does: t('shortcuts.does.toggleSnap') },
      { keys: 'G', does: t('shortcuts.does.toggleGrid') },
    ],
  },
  {
    title: t('shortcuts.section.view'),
    rows: [
      { keys: 'Space+drag / middle / right-drag', does: t('shortcuts.does.pan') },
      { keys: 'Space+wheel', does: t('shortcuts.does.panWheel') },
      { keys: 'Wheel', does: t('shortcuts.does.zoomCursor') },
      { keys: '+ / −', does: t('shortcuts.does.zoomInOut') },
      { keys: 'Shift+1', does: t('shortcuts.does.zoomToFit') },
      { keys: 'Shift+2', does: t('shortcuts.does.zoomToSelection') },
      { keys: 'Shift+D', does: t('shortcuts.does.wallDimensions') },
      { keys: 'Shift+A', does: t('shortcuts.does.annotations') },
      { keys: '?', does: t('shortcuts.does.thisSheet') },
    ],
  },
  {
    title: t('shortcuts.section.files'),
    rows: [
      { keys: 'Ctrl+N', does: t('shortcuts.does.newProject') },
      { keys: 'Ctrl+O', does: t('shortcuts.does.open') },
      { keys: 'Ctrl+S / Ctrl+Shift+S', does: t('shortcuts.does.saveSaveAs') },
    ],
  },
]
