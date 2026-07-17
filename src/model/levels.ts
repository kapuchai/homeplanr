import type { Level, LevelDoc, ProjectDocument } from './types'
import { DEFAULTS } from './types'
import type { LevelId } from './ids'

/**
 * Level helpers (v7). A LevelDoc is the single-level working view every
 * entity consumer operates on — see the LevelDoc docblock in types.ts for
 * the aliasing contract.
 */

/** Slab thickness (m) between a level's ceiling and the floor above it.
 * Feeds both elevation stacking and the 3D upper-floor slab prisms. */
export const SLAB_THICKNESS = 0.3

/** A level's stacking height: its tallest wall (walls carry height
 * individually), falling back to the default wall height when empty. */
export function levelHeight(level: Level): number {
  let max = 0
  for (const w of Object.values(level.walls)) {
    if (w.height > max) max = w.height
  }
  return max > 0 ? max : DEFAULTS.wallHeight
}

/**
 * Absolute floor-plane z (m) per level, index-aligned with doc.levels.
 * Ground = 0; each next level stacks on the one below (height + slab)
 * unless it carries an explicit elevation override. Pure — memoize at the
 * call site if needed (cheap enough to recompute per render commit).
 */
export function levelElevations(doc: ProjectDocument): number[] {
  const out: number[] = []
  let z = 0
  for (let i = 0; i < doc.levels.length; i++) {
    const level = doc.levels[i]!
    if (level.elevation !== undefined) z = level.elevation
    else if (i === 0) z = 0
    out.push(z)
    z += levelHeight(level) + SLAB_THICKNESS
  }
  return out
}

export function levelById(doc: ProjectDocument, id: LevelId): Level | undefined {
  return doc.levels.find((l) => l.id === id)
}

export function levelIndex(doc: ProjectDocument, id: LevelId): number {
  return doc.levels.findIndex((l) => l.id === id)
}

/** Build the working view over one level. Plain object whose properties
 * alias the level's maps + the doc's assets/settings — works identically
 * over an immer draft (mutations write through the aliased drafts) and
 * over a frozen committed doc (read paths). NOT memoized — see
 * store/levelView.ts for the identity-stable render-side cache. */
export function makeLevelDoc(doc: ProjectDocument, level: Level): LevelDoc {
  return {
    levelId: level.id,
    settings: doc.settings,
    nodes: level.nodes,
    walls: level.walls,
    openings: level.openings,
    rooms: level.rooms,
    furniture: level.furniture,
    annotations: level.annotations,
    assets: doc.assets,
  }
}
