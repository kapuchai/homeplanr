/**
 * THE shortcut table (M8) — the '?' overlay renders this, and the keymap
 * drift test asserts every binding it exercises appears here. One module so
 * the sheet and the bindings can't diverge silently.
 */
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
    title: 'Tools',
    rows: [
      { keys: 'V', does: 'Select' },
      { keys: 'W', does: 'Draw walls' },
      { keys: 'D', does: 'Place door' },
      { keys: 'N', does: 'Place window' },
      { keys: 'M', does: 'Tape measure' },
      { keys: 'T', does: 'Text label' },
      { keys: 'Esc', does: 'Cancel gesture → select tool → deselect' },
    ],
  },
  {
    title: 'Selection & editing',
    rows: [
      { keys: 'Drag', does: 'Marquee select (empty canvas or room floor)' },
      { keys: 'Shift+drag / click', does: 'Add to selection' },
      { keys: 'Ctrl+A', does: 'Select all' },
      { keys: 'Alt+click / repeat click', does: 'Cycle overlapping items' },
      { keys: 'Right-click', does: 'Context menu' },
      { keys: 'R / Shift+R', does: 'Rotate furniture or ghost ±90°' },
      { keys: 'F', does: 'Flip (mirror) furniture or ghost' },
      { keys: 'Arrows', does: 'Nudge 1 cm (Shift: 10 cm)' },
      { keys: 'Ctrl+D', does: 'Duplicate furniture' },
      { keys: 'Ctrl+C / Ctrl+V', does: 'Copy / paste furniture' },
      { keys: 'Del', does: 'Delete selection' },
      { keys: 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', does: 'Undo / redo' },
    ],
  },
  {
    title: 'Drawing',
    rows: [
      { keys: 'Enter', does: 'Finish wall chain · keep measurement as dimension' },
      { keys: 'Backspace', does: 'Step back one wall segment' },
      { keys: 'Double-click', does: 'Finish wall chain' },
      { keys: 'Hold Ctrl', does: 'Suspend snapping during a drag' },
      { keys: 'S', does: 'Toggle snapping' },
      { keys: 'G', does: 'Toggle grid' },
    ],
  },
  {
    title: 'View',
    rows: [
      { keys: 'Space+drag / middle / right-drag', does: 'Pan' },
      { keys: 'Wheel', does: 'Zoom at cursor (Shift+wheel: pan sideways)' },
      { keys: '+ / −', does: 'Zoom in / out' },
      { keys: 'Shift+1', does: 'Zoom to fit' },
      { keys: 'Shift+2', does: 'Zoom to selection' },
      { keys: 'Shift+D', does: 'Wall dimension labels' },
      { keys: '?', does: 'This sheet' },
    ],
  },
  {
    title: 'Files',
    rows: [
      { keys: 'Ctrl+N', does: 'New project' },
      { keys: 'Ctrl+O', does: 'Open…' },
      { keys: 'Ctrl+S / Ctrl+Shift+S', does: 'Save / Save As…' },
    ],
  },
]
