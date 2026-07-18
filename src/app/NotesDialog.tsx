import { useState } from 'react'
import { Modal } from './Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { t } from '../i18n'

/**
 * Project notes (0.15.0 pull-forward, v1): one plain-text field on the
 * document. Save commits ONE undoable setNotes; Esc/Cancel discards the
 * draft. The 0.15.0 panel overhaul re-homes this into the panel system.
 */
export function NotesDialog() {
  const open = useUiStore((s) => s.notesOpen)
  if (!open) return null
  return <NotesDialogInner />
}

function NotesDialogInner() {
  const setNotesOpen = useUiStore((s) => s.setNotesOpen)
  const [draft, setDraft] = useState(() => useDocStore.getState().doc.notes ?? '')
  const close = () => setNotesOpen(false)
  const save = () => {
    useDocStore.getState().setNotes(draft)
    close()
  }
  return (
    <Modal label={t('notes.title')} onClose={close}>
      <>
        <h3>{t('notes.title')}</h3>
        <textarea
          className="notes-text"
          value={draft}
          placeholder={t('notes.placeholder')}
          rows={10}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="modal-buttons">
          <button type="button" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      </>
    </Modal>
  )
}
