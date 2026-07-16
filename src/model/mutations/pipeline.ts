import type { ProjectDocument } from '../types'
import { normalizeGraph } from './walls'
import { revalidateOpenings } from './openings'
import { reconcileRooms } from './rooms'

/**
 * Mutation execution mode.
 * - 'commit' (default): full pipeline — normalizeGraph → revalidateOpenings
 *   → reconcileRooms — runs inside the mutation, so cascades land in the
 *   same undo entry.
 * - 'live': per-frame drag updates — graph normalization and room
 *   reconciliation are skipped (topology fixes happen at pointer-up when the
 *   tool re-runs the final mutation in 'commit' mode); opening clamps run
 *   where possible but NEVER delete — a transiently non-fitting opening is
 *   left untouched in the doc (wallSolids re-clamps defensively at render)
 *   so an overshoot mid-drag can't destroy doors/windows permanently.
 */
export type MutationMode = 'live' | 'commit'

export interface PipelineOpts {
  /**
   * Ids that LOSE every tie during normalization (paste demotion): a demoted
   * node/wall never survives a weld/dedupe against a kept one, and demoted
   * openings are re-slotted around kept openings (never evict them). Absent
   * everywhere except pasteSubgraph — behavior is bit-identical without it.
   */
  demoted?: ReadonlySet<string>
}

export function runPipeline(
  doc: ProjectDocument,
  mode: MutationMode,
  opts: PipelineOpts = {},
): void {
  if (mode === 'commit') {
    normalizeGraph(doc, opts.demoted)
    revalidateOpenings(doc, 'commit', opts.demoted)
    reconcileRooms(doc)
  } else {
    revalidateOpenings(doc, 'live')
  }
}
