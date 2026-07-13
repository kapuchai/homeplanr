import { useUiStore } from '../store/uiStore'
import { Modal } from './Modal'
import { SHORTCUT_SECTIONS } from './shortcuts'

/** '?' overlay: the full shortcut sheet, rendered from the shared table. */
export function ShortcutHelp() {
  const open = useUiStore((s) => s.helpOpen)
  const setOpen = useUiStore((s) => s.setHelpOpen)
  if (!open) return null
  return (
    <Modal label="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <>
        <h3>Keyboard shortcuts</h3>
        <div className="shortcut-grid">
          {SHORTCUT_SECTIONS.map((sec) => (
            <section key={sec.title} className="options-section">
              <h4>{sec.title}</h4>
              {sec.rows.map((r) => (
                <div className="options-row shortcut-row" key={r.keys}>
                  <span>{r.does}</span>
                  <kbd>{r.keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="modal-buttons">
          <button type="button" className="primary" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </>
    </Modal>
  )
}
