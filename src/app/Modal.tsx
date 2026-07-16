import { useEffect, useRef } from 'react'

const focusablesOf = (dialog: HTMLElement): HTMLElement[] =>
  [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null)

/**
 * Shared modal shell (M7): backdrop + dialog role + the keyboard contract
 * every dialog kept reimplementing differently —
 * - focus moves INTO the dialog on open (first focusable, or the dialog);
 * - Tab / Shift+Tab wrap inside it (focus trap);
 * - focus RESTORES to the opener on close;
 * - Escape calls onClose (stopPropagation: the keymap's window listener
 *   must not also run its Esc ladder on the same press);
 * - optional backdrop-click dismissal.
 * The global keymap independently swallows shortcuts while a modal is up.
 */
export function Modal({
  label,
  onClose,
  dismissOnBackdrop = true,
  refocusKey,
  wide = false,
  children,
}: {
  label: string
  onClose: () => void
  dismissOnBackdrop?: boolean
  /** Changing this re-focuses the first control — pass the pending prompt
   * so a QUEUE PROMOTION (same mounted Modal, new buttons) doesn't strand
   * focus on <body> and leave the promoted prompt keyboard-dead. */
  refocusKey?: unknown
  /** Wide variant (B8) for content the 380 px shell can't hold — the
   * shortcut sheet's two-column grid clipped and scrolled sideways. */
  wide?: boolean
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // ref, not a dep: onClose is a fresh arrow every render — depending on it
  // would re-run the trap (and thrash focus) on every settings click
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement as HTMLElement | null

    const focusables = () => focusablesOf(dialog)

    ;(focusables()[0] ?? dialog).focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) {
        e.preventDefault()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      const active = document.activeElement
      if (!active || !dialog.contains(active)) {
        // focus escaped (backdrop click blurred to body) — pull it back in
        // instead of letting Tab reach the chrome BEHIND the modal
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // capture phase on the document: sees Tab/Escape regardless of what
    // inside the dialog has focus, before the window-level keymap
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [])

  // queue promotion: same Modal, new content — re-focus the first control
  const firstRefocus = useRef(true)
  useEffect(() => {
    if (firstRefocus.current) {
      firstRefocus.current = false
      return
    }
    const dialog = ref.current
    if (dialog) (focusablesOf(dialog)[0] ?? dialog).focus()
  }, [refocusKey])

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={ref}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
