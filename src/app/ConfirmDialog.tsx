import { useConfirmStore } from './confirmStore'

export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const resolve = useConfirmStore((s) => s.resolve)
  if (!pending) return null
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={pending.title}>
        <h3>{pending.title}</h3>
        <p>{pending.message}</p>
        <div className="modal-buttons">
          {pending.buttons.map((b) => (
            <button
              key={b.value}
              type="button"
              className={b.variant ?? 'plain'}
              onClick={() => resolve(b.value)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
