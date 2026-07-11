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
 *   tool re-runs the final mutation in 'commit' mode); opening clamps still
 *   run so drags can never leave openings outside their walls.
 */
export type MutationMode = 'live' | 'commit'

export function runPipeline(doc: ProjectDocument, mode: MutationMode): void {
  if (mode === 'commit') {
    normalizeGraph(doc)
    revalidateOpenings(doc)
    reconcileRooms(doc)
  } else {
    revalidateOpenings(doc)
  }
}
