import { useEffect, useRef } from 'react'
import { useConfirmStore } from './confirmStore'
import { Modal } from './Modal'

export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const resolve = useConfirmStore((s) => s.resolve)
  // when a QUEUED prompt is promoted (prompt→prompt transition), swallow
  // clicks for a beat: the second click of a double-click on the previous
  // prompt's button must not fall through onto this one's same-position
  // (possibly destructive) button. First-from-empty prompts arm instantly.
  const armedAt = useRef(0)
  const prevPending = useRef<typeof pending>(null)
  useEffect(() => {
    armedAt.current = prevPending.current && pending ? performance.now() + 250 : 0
    prevPending.current = pending
  }, [pending])
  if (!pending) return null
  return (
    <Modal
      label={pending.title}
      dismissOnBackdrop={false}
      refocusKey={pending}
      onClose={() => resolve(pending.escValue)}
    >
      <>
        <h3>{pending.title}</h3>
        <p>{pending.message}</p>
        <div className="modal-buttons">
          {pending.buttons.map((b) => (
            <button
              key={b.value}
              type="button"
              className={b.variant ?? 'plain'}
              onClick={() => {
                if (performance.now() < armedAt.current) return
                resolve(b.value)
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </>
    </Modal>
  )
}
