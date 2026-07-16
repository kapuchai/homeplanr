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
 * Fit `width` into the free gaps a start-sorted `occupied` interval list
 * leaves inside `core` (margins applied); returns the legal center-u closest
 * to `u`, or null when no gap can take it. The shared slotting core of
 * findOpeningSlot and revalidateOpenings' demoted pass.
 */
function fitIntoGaps(
  core: readonly [number, number],
  occupied: readonly (readonly [number, number])[],
  u: number,
  width: number,
): number | null {
  const m = DEFAULTS.openingCoreMargin
  const half = width / 2

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
    if (e - s < width - 1e-9) continue // float-noise tolerance on gap width
    const c = Math.min(Math.max(u, s + half), e - half)
    const d = Math.abs(c - u)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

/**
 * How far a demoted (pasted) opening may shift to fit and still be kept.
 * Weld displacement (≤ MERGE_EPS) plus junction-miter core shrinkage stay
 * comfortably under this; dodging around a kept opening needs at least the
 * two half-widths (≥ ~0.5 m for doors) and lands well over it — so squeezes
 * survive and would-be phantom duplicates drop.
 */
const DEMOTED_FIT_TOLERANCE = 0.1

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
  const L = dist(na, nb)

  // occupied intervals (current doc is legal — no overlaps)
  const occupied = Object.values(doc.openings)
    .filter((o) => o.wallId === wallId)
    .map((o) => [o.t * L - o.width / 2, o.t * L + o.width / 2] as const)
    .sort((a, b) => a[0] - b[0])

  return fitIntoGaps(core, occupied, u, width)
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
 * overlaps in t-order, and clamp vertical extents; delete what cannot fit —
 * in COMMIT mode only. Live mode (per-frame drags) clamps what it can and
 * leaves non-fitting openings UNTOUCHED: a transiently-too-short wall during
 * a node drag must never permanently destroy its doors (the pointer-up
 * commit re-run decides for real; wallSolids' defensive re-check keeps the
 * render legal in the meantime).
 * With a `demoted` set (paste), demoted openings run in a SECOND pass:
 * near-exact-fit-or-drop against the kept ones (DEMOTED_FIT_TOLERANCE) —
 * they never evict kept content and never relocate beyond a weld-sized
 * squeeze (an overlay paste must be a no-op, not a phantom door).
 * Runs on every pipeline pass (cheap: one outline computation per call).
 */
export function revalidateOpenings(
  doc: ProjectDocument,
  mode: MutationMode = 'commit',
  demoted?: ReadonlySet<string>,
): void {
  const byWall = new Map<WallId, Opening[]>()
  for (const op of Object.values(doc.openings)) {
    const w = doc.walls[op.wallId]
    if (!w) {
      if (mode === 'commit') delete doc.openings[op.id] // orphaned
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
      if (mode === 'commit') for (const op of ops) delete doc.openings[op.id]
      continue
    }
    const L = dist(na, nb)
    const H = w.height
    const lo = core[0] + m
    const hi = core[1] - m

    ops.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))

    // NOTE: assign fields only when they actually change — spurious writes
    // would mark the immer draft modified, churn opening identity, and
    // defeat the derived layer's per-entity reference stability.
    const assign = <K extends 't' | 'height' | 'sillHeight'>(
      op: Opening,
      key: K,
      value: number,
    ) => {
      if (Math.abs((op as Record<K, number>)[key] - value) > 1e-12) {
        ;(op as Record<K, number>)[key] = value
      }
    }
    // --- vertical clamps (independent of position; compute-then-assign so
    // live mode never writes a value it would then delete); false = cannot
    // fit (deleted in commit mode, left untouched live) ---
    const clampVertical = (op: Opening): boolean => {
      if (op.kind === 'door') {
        const h = Math.min(op.height, H - DEFAULTS.openingHeadroom)
        if (h <= 0) {
          if (mode === 'commit') delete doc.openings[op.id]
          return false
        }
        assign(op, 'height', h)
      } else {
        const sill = Math.min(Math.max(op.sillHeight, 0), H - DEFAULTS.openingHeadroom)
        const h = Math.min(op.height, H - DEFAULTS.openingHeadroom - sill)
        if (h < DEFAULTS.minWindowHeight) {
          if (mode === 'commit') delete doc.openings[op.id]
          return false
        }
        assign(op, 'sillHeight', sill)
        assign(op, 'height', h)
      }
      return true
    }

    // Pass 1 — kept openings: t-order cursor walk. Without a demoted set
    // this is ALL openings — identical to the pre-demotion behavior.
    const demotedOps = demoted ? ops.filter((o) => demoted.has(o.id)) : []
    const kept = demotedOps.length ? ops.filter((o) => !demoted!.has(o.id)) : ops
    let cursor = lo
    for (const op of kept) {
      if (!clampVertical(op)) continue
      // --- horizontal clamp + overlap serialization ---
      const half = op.width / 2
      if (hi - cursor < op.width) {
        if (mode === 'commit') delete doc.openings[op.id]
        continue // live: leave untouched — never delete mid-gesture
      }
      let u = op.t * L
      if (u - half < cursor) u = cursor + half
      if (u + half > hi) u = hi - half
      if (u - half < cursor - 1e-12) {
        if (mode === 'commit') delete doc.openings[op.id]
        continue
      }
      assign(op, 't', u / L)
      cursor = u + half + m
    }

    // Pass 2 — demoted (pasted) openings: NEAR-EXACT-FIT-OR-DROP. Kept
    // openings are fixed obstacles; a demoted opening survives only where
    // its requested spot is free within DEMOTED_FIT_TOLERANCE (absorbs weld
    // displacement + miter squeeze) — relocating further would leave a
    // phantom door after an overlay paste, so overlap drops instead.
    // Commit-only: paste never runs live, and live must never delete.
    if (demotedOps.length && mode === 'commit') {
      const placed: [number, number][] = []
      for (const op of kept) {
        if (!doc.openings[op.id]) continue
        placed.push([op.t * L - op.width / 2, op.t * L + op.width / 2])
      }
      placed.sort((a, b) => a[0] - b[0])
      for (const op of demotedOps) {
        if (!clampVertical(op)) continue
        const want = op.t * L
        const u = fitIntoGaps(core, placed, want, op.width)
        if (u === null || Math.abs(u - want) > DEMOTED_FIT_TOLERANCE) {
          delete doc.openings[op.id]
          continue
        }
        assign(op, 't', u / L)
        const iv: [number, number] = [u - op.width / 2, u + op.width / 2]
        const at = placed.findIndex((p) => p[0] > iv[0])
        if (at === -1) placed.push(iv)
        else placed.splice(at, 0, iv)
      }
    }
  }
}
