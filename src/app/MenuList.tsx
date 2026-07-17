import { useEffect, useRef } from 'react'

/**
 * WAI-ARIA menu list primitive — shared by the canvas context menu (M4) and
 * the File menu (M7). Roving focus: ArrowUp/Down wrap over enabled items,
 * Home/End jump, first-letter typeahead, Escape calls onClose, Enter/Space
 * activate via the native button. Keydown stops propagation so the global
 * keymap never sees menu navigation.
 */
export interface MenuEntry {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  /** Display-only shortcut hint (e.g. 'Ctrl+D'). */
  shortcut?: string
  /** Hover tooltip (e.g. a recent file's full path). */
  title?: string
  /** Small preview image data-URL (recent files, 0.11.0). */
  thumb?: string
}

export function MenuList({ entries, onClose }: { entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  const buttons = () =>
    [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]

  useEffect(() => {
    buttons()[0]?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // a focused menu OWNS the keyboard: no key may fall through to the
    // global keymap (Enter would also commit a measurement, Space would arm
    // panning and cancel the button's own activation, Delete would delete
    // the selection while browsing the menu)
    e.stopPropagation()
    const list = buttons()
    if (!list.length) return
    const idx = list.findIndex((b) => b === document.activeElement)
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus()
    if (e.key === 'ArrowDown') focusAt(idx + 1)
    else if (e.key === 'ArrowUp') focusAt(idx - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(list.length - 1)
    else if (e.key === 'Escape') onClose()
    else if (e.key === 'Tab') onClose() // never tab THROUGH the backdrop into covered UI
    else if (/^[a-z0-9]$/i.test(e.key)) {
      // typeahead: next enabled item starting with the letter, wrapping
      const from = idx + 1
      for (let step = 0; step < list.length; step++) {
        const b = list[(from + step) % list.length]!
        if (b.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase())) {
          b.focus()
          break
        }
      }
    } else {
      return // Enter/Space: native button activation proceeds
    }
    e.preventDefault()
  }

  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={onKeyDown}>
      {entries.map((entry, i) => (
        <span key={`${entry.label}-${i}`} style={{ display: 'contents' }}>
          {entry.separatorBefore && <div className="menu-sep" />}
          <button
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            title={entry.title}
            className={entry.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              entry.onSelect()
            }}
          >
            {entry.thumb && <img className="menu-thumb" src={entry.thumb} alt="" />}
            {entry.label}
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        </span>
      ))}
    </div>
  )
}
