import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useActiveLevel } from '../store/activeLevel'
import { resolveLevel } from '../store/levelView'
import { useConfirmStore } from './confirmStore'
import type { Level } from '../model/types'
import { levelDisplayName } from './levelName'
import { t } from '../i18n'

/**
 * Floor switcher (v7) — top-left overlay in BOTH views (the one corner
 * empty in 2D and 3D; SunArc keeps the 3D top-center). Rows render top
 * storey first, matching the physical stack; the control row under the
 * list acts on the ACTIVE floor. Double-click a row to rename inline.
 */

const icon = (d: string) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const ICON_ADD = icon('M6 2.5v7M2.5 6h7')
const ICON_DUP = icon('M4.5 4.5h5v5h-5zM2.5 7.5v-5h5')
const ICON_UP = icon('M3 7.5 6 4.5l3 3')
const ICON_DOWN = icon('M3 4.5 6 7.5l3-3')
const ICON_DEL = icon('M3 3l6 6M9 3l-6 6')

function LevelRow({
  level,
  index,
  active,
  onActivate,
}: {
  level: Level
  index: number
  active: boolean
  onActivate: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (!editing) setDraft(levelDisplayName(level, index))
  }, [editing, level, index])

  if (editing) {
    return (
      <input
        className="level-rename"
        value={draft}
        aria-label={t('levels.renameAria')}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          useDocStore.getState().renameLevel(level.id, draft)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(levelDisplayName(level, index))
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      aria-pressed={active}
      title={t('levels.rowTitle')}
      onClick={onActivate}
      onDoubleClick={() => setEditing(true)}
    >
      {levelDisplayName(level, index)}
    </button>
  )
}

export function LevelSwitcher() {
  const levels = useDocStore((s) => s.doc.levels)
  const activeLevelId = useActiveLevel((s) => s.activeLevelId)
  const setActiveLevel = useActiveLevel((s) => s.setActiveLevel)
  const a = useDocStore.getState()
  const fullDoc = useDocStore((s) => s.doc)
  const active = resolveLevel(fullDoc, activeLevelId)
  const activeIdx = levels.findIndex((l) => l.id === active.id)

  const deleteActive = async () => {
    if (levels.length <= 1) return
    const choice = await useConfirmStore.getState().prompt(
      t('levels.deleteConfirmTitle'),
      t('levels.deleteConfirmMessage', { name: levelDisplayName(active, activeIdx) }),
      [
        { value: 'delete', label: t('levels.deleteConfirm'), variant: 'danger' },
        { value: 'cancel', label: t('common.cancel') },
      ],
      { escValue: 'cancel' },
    )
    if (choice !== 'delete') return
    const fallback = levels[activeIdx - 1] ?? levels[activeIdx + 1]
    a.deleteLevel(active.id)
    if (fallback) setActiveLevel(fallback.id)
  }

  return (
    <div className="level-switcher" role="group" aria-label={t('levels.listAria')}>
      <div className="level-rows">
        {[...levels]
          .map((level, i) => ({ level, i }))
          .reverse()
          .map(({ level, i }) => (
            <LevelRow
              key={level.id}
              level={level}
              index={i}
              active={level.id === active.id}
              onActivate={() => setActiveLevel(level.id)}
            />
          ))}
      </div>
      <div className="level-controls">
        <button type="button" title={t('levels.addTitle')} onClick={() => setActiveLevel(a.addLevel())}>
          {ICON_ADD}
        </button>
        <button
          type="button"
          title={t('levels.duplicateTitle')}
          onClick={() => {
            const id = a.duplicateLevel(active.id)
            if (id) setActiveLevel(id)
          }}
        >
          {ICON_DUP}
        </button>
        <button
          type="button"
          title={t('levels.upTitle')}
          disabled={activeIdx >= levels.length - 1}
          onClick={() => a.moveLevel(active.id, 1)}
        >
          {ICON_UP}
        </button>
        <button
          type="button"
          title={t('levels.downTitle')}
          disabled={activeIdx <= 0}
          onClick={() => a.moveLevel(active.id, -1)}
        >
          {ICON_DOWN}
        </button>
        <button
          type="button"
          title={t('levels.deleteTitle')}
          disabled={levels.length <= 1}
          onClick={() => void deleteActive()}
        >
          {ICON_DEL}
        </button>
      </div>
    </div>
  )
}
