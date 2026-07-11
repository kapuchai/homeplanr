import type { Opening, ProjectDocument } from '../types'
import { DEFAULTS } from '../types'
import { newOpeningId, type OpeningId, type WallId } from '../ids'
import { dist } from '../../geometry/vec'
import { computeWallOutlines } from '../../geometry/wallOutline'
import { runPipeline, type MutationMode } from './pipeline'

/**
 * Opening mutations + the single horizontal/vertical clamp (mirrors the
 * wallSolids realization logic, but MUTATES the document so the stored model
 * itself is always legal — wallSolids' own clamp is a defensive re-check).
 */

export type AddOpeningParams =
  | {
      kind: 'door'
      wallId: WallId
      t: number
      width?: number
      height?: number
      hinge?: 'a' | 'b'
      swing?: 'front' | 'back'
    }
  | {
      kind: 'window'
      wallId: WallId
      t: number
      width?: number
      height?: number
      sillHeight?: number
    }

/**
 * Find a legal center-u for a new opening of `width` on `wallId`, as close
 * as possible to the requested center `u`. Existing openings are fixed
 * obstacles — a new opening NEVER evicts existing content. Returns null when
 * no gap can take it. (Also the place-opening tool's ghost-validity oracle.)
 */
export function findOpeningSlot(
  doc: ProjectDocument,
  wallId: WallId,
  u: number,
  width: number,
): number | null {
  const w = doc.walls[wallId]
  const na = w && doc.nodes[w.a]
  const nb = w && doc.nodes[w.b]
  if (!w || !na || !nb) return null
  const outlines = computeWallOutlines(doc.nodes, doc.walls)
  const core = outlines.wallCores[wallId]
  if (!core) return null
  const m = DEFAULTS.openingCoreMargin
  const L = dist(na, nb)
  const half = width / 2

  // occupied intervals (current doc is legal — no overlaps)
  const occupied = Object.values(doc.openings)
    .filter((o) => o.wallId === wallId)
    .map((o) => [o.t * L - o.width / 2, o.t * L + o.width / 2] as const)
    .sort((a, b) => a[0] - b[0])

  // free gaps within the core
  const gaps: [number, number][] = []
  let cursor = core[0] + m
  for (const [s, e] of occupied) {
    if (s - m > cursor) gaps.push([cursor, s - m])
    cursor = Math.max(cursor, e + m)
  }
  if (core[1] - m > cursor) gaps.push([cursor, core[1] - m])

  let best: number | null = null
  let bestDist = Infinity
  for (const [s, e] of gaps) {
    if (e - s < width) continue
    const c = Math.min(Math.max(u, s + half), e - half)
    const d = Math.abs(c - u)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

export function addOpening(
  doc: ProjectDocument,
  params: AddOpeningParams,
  opts: { mode?: MutationMode } = {},
): OpeningId | null {
  const wall = doc.walls[params.wallId]
  const na = wall && doc.nodes[wall.a]
  const nb = wall && doc.nodes[wall.b]
  if (!wall || !na || !nb) return null

  // Pre-place into a free gap — never evict existing openings.
  const width =
    params.width ?? (params.kind === 'door' ? DEFAULTS.door.width : DEFAULTS.window.width)
  const L = dist(na, nb)
  const slot = findOpeningSlot(doc, params.wallId, params.t * L, width)
  if (slot === null) return null

  const id = newOpeningId()
  const base = { id, wallId: params.wallId, t: slot / L }
  if (params.kind === 'door') {
    doc.openings[id] = {
      ...base,
      kind: 'door',
      width,
      height: params.height ?? DEFAULTS.door.height,
      hinge: params.hinge ?? DEFAULTS.door.hinge,
      swing: params.swing ?? 'front',
    }
  } else {
    doc.openings[id] = {
      ...base,
      kind: 'window',
      width,
      height: params.height ?? DEFAULTS.window.height,
      sillHeight: params.sillHeight ?? DEFAULTS.window.sillHeight,
    }
  }
  runPipeline(doc, opts.mode ?? 'commit')
  return doc.openings[id] ? id : null // revalidation may have deleted it
}

export function updateOpening(
  doc: ProjectDocument,
  id: OpeningId,
  patch: Partial<{
    t: number
    width: number
    height: number
    sillHeight: number
    hinge: 'a' | 'b'
    swing: 'front' | 'back'
  }>,
  opts: { mode?: MutationMode } = {},
): void {
  const op = doc.openings[id]
  if (!op) return
  if (patch.t !== undefined) op.t = patch.t
  if (patch.width !== undefined) op.width = Math.max(0.3, patch.width)
  if (patch.height !== undefined) op.height = Math.max(0.3, patch.height)
  if (op.kind === 'window' && patch.sillHeight !== undefined) {
    op.sillHeight = Math.max(0, patch.sillHeight)
  }
  if (op.kind === 'door') {
    if (patch.hinge !== undefined) op.hinge = patch.hinge
    if (patch.swing !== undefined) op.swing = patch.swing
  }
  runPipeline(doc, opts.mode ?? 'commit')
}

/**
 * Clamp every opening into its wall's straight core with margins, serialize
 * overlaps in t-order, and clamp vertical extents; delete what cannot fit.
 * Runs on every pipeline pass (cheap: one outline computation per call).
 */
export function revalidateOpenings(doc: ProjectDocument): void {
  const byWall = new Map<WallId, Opening[]>()
  for (const op of Object.values(doc.openings)) {
    const w = doc.walls[op.wallId]
    if (!w) {
      delete doc.openings[op.id] // orphaned
      continue
    }
    ;(byWall.get(op.wallId) ?? byWall.set(op.wallId, []).get(op.wallId)!).push(op)
  }
  if (byWall.size === 0) return

  const outlines = computeWallOutlines(doc.nodes, doc.walls)
  const m = DEFAULTS.openingCoreMargin

  for (const [wallId, ops] of byWall) {
    const w = doc.walls[wallId]!
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    const core = outlines.wallCores[wallId]
    if (!na || !nb || !core) {
      for (const op of ops) delete doc.openings[op.id]
      continue
    }
    const L = dist(na, nb)
    const H = w.height
    const lo = core[0] + m
    const hi = core[1] - m

    ops.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
    let cursor = lo
    for (const op of ops) {
      // --- vertical clamps first (independent of position) ---
      if (op.kind === 'door') {
        op.height = Math.min(op.height, H - DEFAULTS.openingHeadroom)
        if (op.height <= 0) {
          delete doc.openings[op.id]
          continue
        }
      } else {
        op.sillHeight = Math.min(Math.max(op.sillHeight, 0), H - DEFAULTS.openingHeadroom)
        op.height = Math.min(op.height, H - DEFAULTS.openingHeadroom - op.sillHeight)
        if (op.height < DEFAULTS.minWindowHeight) {
          delete doc.openings[op.id]
          continue
        }
      }
      // --- horizontal clamp + overlap serialization ---
      const half = op.width / 2
      if (hi - cursor < op.width) {
        delete doc.openings[op.id]
        continue
      }
      let u = op.t * L
      if (u - half < cursor) u = cursor + half
      if (u + half > hi) u = hi - half
      if (u - half < cursor - 1e-12) {
        delete doc.openings[op.id]
        continue
      }
      op.t = u / L
      cursor = u + half + m
    }
  }
}
