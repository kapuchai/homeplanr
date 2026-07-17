import type { Level, LevelDoc, ProjectDocument } from '../model/types'
import type { LevelId } from '../model/ids'
import { makeLevelDoc } from '../model/levels'
import { useDocStore } from './docStore'
import { useActiveLevel } from './activeLevel'

/**
 * Identity-stable LevelDoc views (v7). getDerived and every renderer memo
 * key on view identity, so for a given (committed doc, level) pair the
 * SAME view object must come back — a fresh wrapper per render would
 * defeat the whole derived cache. WeakMap on the doc keeps views exactly
 * as long as the doc they wrap.
 *
 * Mutations never use this cache — the docStore seam builds throwaway
 * views over the immer draft (drafts are per-recipe).
 */
const viewCache = new WeakMap<ProjectDocument, Map<LevelId, LevelDoc>>()

/** Resolve an id to a level with the null/stale fallback: first level. */
export function resolveLevel(doc: ProjectDocument, levelId: LevelId | null): Level {
  const found = levelId ? doc.levels.find((l) => l.id === levelId) : undefined
  return found ?? doc.levels[0]!
}

export function levelDocOf(doc: ProjectDocument, levelId: LevelId | null): LevelDoc {
  const level = resolveLevel(doc, levelId)
  let byLevel = viewCache.get(doc)
  if (!byLevel) {
    byLevel = new Map()
    viewCache.set(doc, byLevel)
  }
  const hit = byLevel.get(level.id)
  if (hit) return hit
  const view = makeLevelDoc(doc, level)
  byLevel.set(level.id, view)
  return view
}

/** Imperative read for tools/keymap/commands (getState-style call sites). */
export function getActiveLevelDoc(): LevelDoc {
  return levelDocOf(useDocStore.getState().doc, useActiveLevel.getState().activeLevelId)
}

/** Reactive view of the active level — re-renders on doc commits AND on
 * floor switches; identity-stable per (doc, level). */
export function useActiveLevelDoc(): LevelDoc {
  const doc = useDocStore((s) => s.doc)
  const activeLevelId = useActiveLevel((s) => s.activeLevelId)
  return levelDocOf(doc, activeLevelId)
}
