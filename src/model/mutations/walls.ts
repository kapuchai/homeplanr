import type { ProjectDocument, Wall, WallNode } from '../types'
import { DEFAULTS } from '../types'
import { WALL_PAINT_IDS } from '../../catalog/palette'
import { newNodeId, newWallId, type AnnotationId, type FurnitureId, type NodeId, type OpeningId, type WallId } from '../ids'
import type { Vec2 } from '../../geometry/vec'
import { dist } from '../../geometry/vec'
import { closestPointOnSegment, segSegIntersection } from '../../geometry/segment'
import { GEOM_EPS, MERGE_EPS, NORMALIZE_MAX_PASSES } from '../../geometry/constants'
import { runPipeline, type MutationMode } from './pipeline'

/** Node position lookup (throwing accessor — invariants guarantee presence). */
const pos = (doc: ProjectDocument, id: NodeId): Vec2 => {
  const n = doc.nodes[id]!
  return { x: n.x, y: n.y }
}

const wallLength = (doc: ProjectDocument, w: Wall): number =>
  dist(pos(doc, w.a), pos(doc, w.b))

/** Find an existing node within MERGE_EPS of p, else create one. */
export function getOrCreateNode(doc: ProjectDocument, p: Vec2): NodeId {
  let best: WallNode | null = null
  let bestD = MERGE_EPS
  for (const n of Object.values(doc.nodes)) {
    const d = dist(n, p)
    if (d <= bestD) {
      best = n
      bestD = d
    }
  }
  if (best) return best.id
  const id = newNodeId()
  doc.nodes[id] = { id, x: p.x, y: p.y }
  return id
}

export interface AddWallResult {
  wallId: WallId | null
  a: NodeId
  b: NodeId
}

/**
 * Add one wall segment between two points (nodes reused/created within
 * MERGE_EPS). Rejects micro-walls and duplicate node pairs (returns
 * wallId: null but still reports the nodes).
 */
export function addWallSegment(
  doc: ProjectDocument,
  p1: Vec2,
  p2: Vec2,
  opts: { thickness?: number; height?: number; mode?: MutationMode } = {},
): AddWallResult {
  const a = getOrCreateNode(doc, p1)
  const b = getOrCreateNode(doc, p2)
  const result = connectNodes(doc, a, b, opts)
  runPipeline(doc, opts.mode ?? 'commit')
  return result
}

/** Add a chain of wall segments through the given points. */
export function addWallChain(
  doc: ProjectDocument,
  points: readonly Vec2[],
  opts: { thickness?: number; height?: number; mode?: MutationMode } = {},
): WallId[] {
  const ids: WallId[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const a = getOrCreateNode(doc, points[i]!)
    const b = getOrCreateNode(doc, points[i + 1]!)
    const r = connectNodes(doc, a, b, opts)
    if (r.wallId) ids.push(r.wallId)
  }
  runPipeline(doc, opts.mode ?? 'commit')
  return ids
}

function connectNodes(
  doc: ProjectDocument,
  a: NodeId,
  b: NodeId,
  opts: { thickness?: number; height?: number },
): AddWallResult {
  if (a === b) return { wallId: null, a, b }
  if (dist(pos(doc, a), pos(doc, b)) < DEFAULTS.minWallLength) {
    return { wallId: null, a, b }
  }
  for (const w of Object.values(doc.walls)) {
    if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) {
      return { wallId: null, a, b } // duplicate pair
    }
  }
  const id = newWallId()
  doc.walls[id] = {
    id,
    a,
    b,
    thickness: opts.thickness ?? doc.settings.defaultWallThickness,
    height: opts.height ?? doc.settings.defaultWallHeight,
  }
  return { wallId: id, a, b }
}

/** Move a node. 'live' during drags; 'commit' at pointer-up. */
export function moveNode(
  doc: ProjectDocument,
  nodeId: NodeId,
  p: Vec2,
  opts: { mode?: MutationMode } = {},
): void {
  const n = doc.nodes[nodeId]
  if (!n) return
  n.x = p.x
  n.y = p.y
  runPipeline(doc, opts.mode ?? 'commit')
}

/** Translate a wall segment perpendicular/freely by moving both nodes. */
export function moveWall(
  doc: ProjectDocument,
  wallId: WallId,
  delta: Vec2,
  opts: { mode?: MutationMode } = {},
): void {
  const w = doc.walls[wallId]
  if (!w) return
  const na = doc.nodes[w.a]
  const nb = doc.nodes[w.b]
  if (!na || !nb) return
  na.x += delta.x
  na.y += delta.y
  nb.x += delta.x
  nb.y += delta.y
  runPipeline(doc, opts.mode ?? 'commit')
}

/**
 * Numeric length edit (properties panel). One deterministic rule
 * (plan-pinned): node b moves along the a→b axis; a stays put.
 */
export function setWallLength(
  doc: ProjectDocument,
  wallId: WallId,
  length: number,
  opts: { mode?: MutationMode } = {},
): void {
  const w = doc.walls[wallId]
  const na = w && doc.nodes[w.a]
  const nb = w && doc.nodes[w.b]
  if (!w || !na || !nb) return
  const L = dist(na, nb)
  if (L < GEOM_EPS) return
  const target = Math.max(DEFAULTS.minWallLength * 5, length)
  const s = target / L
  nb.x = na.x + (nb.x - na.x) * s
  nb.y = na.y + (nb.y - na.y) * s
  runPipeline(doc, opts.mode ?? 'commit')
}

/**
 * Apply a per-side paint value: a known WALL_PAINTS id assigns, anything
 * else (undefined/unknown) deletes the field. Writes only on actual change
 * (immer derived-reference stability). Shared with paintRoomWalls.
 */
export function applyWallPaint(
  w: Wall,
  key: 'paintFront' | 'paintBack',
  paintId: string | undefined,
): void {
  const next = paintId !== undefined && WALL_PAINT_IDS.has(paintId) ? paintId : undefined
  if (next === undefined) {
    if (w[key] !== undefined) delete w[key]
  } else if (w[key] !== next) {
    w[key] = next
  }
}

/** Known non-default finish ids (mutation-level gate, paint parity: the
 * UI writes only known ids; unknown ids arrive via files and are
 * preserved by the open-registry validator, never by mutations). */
const KNOWN_FINISH_IDS = new Set<string>(['brick', 'concrete', 'tile'])

/** Per-side finish rules (v5): known non-'paint' ids assign; anything else
 * deletes. Writes only on actual change (derived-reference stability). */
export function applyWallFinish(
  w: Wall,
  key: 'finishFront' | 'finishBack',
  finishId: string | undefined,
): void {
  const next =
    finishId !== undefined && KNOWN_FINISH_IDS.has(finishId) ? finishId : undefined
  if (next === undefined) {
    if (w[key] !== undefined) delete w[key]
  } else if (w[key] !== next) {
    w[key] = next
  }
}

export function updateWall(
  doc: ProjectDocument,
  wallId: WallId,
  patch: Partial<
    Pick<Wall, 'thickness' | 'height' | 'paintFront' | 'paintBack' | 'finishFront' | 'finishBack'>
  >,
  opts: { mode?: MutationMode } = {},
): void {
  const w = doc.walls[wallId]
  if (!w) return
  if (patch.thickness !== undefined) w.thickness = Math.max(0.03, patch.thickness)
  if (patch.height !== undefined) w.height = Math.max(0.3, patch.height)
  // key-presence checks: an explicit undefined value means "reset to default"
  if ('paintFront' in patch) applyWallPaint(w, 'paintFront', patch.paintFront)
  if ('paintBack' in patch) applyWallPaint(w, 'paintBack', patch.paintBack)
  if ('finishFront' in patch) applyWallFinish(w, 'finishFront', patch.finishFront)
  if ('finishBack' in patch) applyWallFinish(w, 'finishBack', patch.finishBack)
  runPipeline(doc, opts.mode ?? 'commit')
}

/**
 * Split a wall at parameter s ∈ (0,1).
 * ID policy (pinned): the a-side keeps the original WallId (openings keep
 * wallId, t rescaled ×1/s); the b-side gets a fresh id (openings re-hosted,
 * t → (t−s)/(1−s)); straddlers are deleted.
 * Fragments of a demoted wall inherit demotion (ids minted here are ADDED to
 * the set) — otherwise a pasted wall's split fragment would re-enter the
 * weld/dedupe tiebreaks as "kept" and could beat genuinely existing walls.
 * Returns the new middle node. Does NOT run the pipeline (internal helper
 * used by normalizeGraph; public callers use splitWall below).
 */
export function splitWallRaw(
  doc: ProjectDocument,
  wallId: WallId,
  s: number,
  atNode?: NodeId,
  demoted?: Set<string>,
): NodeId | null {
  const w = doc.walls[wallId]
  if (!w || s <= 0 || s >= 1) return null
  const A = pos(doc, w.a)
  const B = pos(doc, w.b)
  const L = dist(A, B)
  if (L < GEOM_EPS) return null

  let mid = atNode
  if (!mid) {
    mid = newNodeId()
    doc.nodes[mid] = { id: mid, x: A.x + (B.x - A.x) * s, y: A.y + (B.y - A.y) * s }
    if (demoted?.has(wallId)) demoted.add(mid)
  }

  const bSide = newWallId()
  doc.walls[bSide] = {
    id: bSide,
    a: mid,
    b: w.b,
    thickness: w.thickness,
    height: w.height,
    // both halves are the same physical wall — sides keep their look
    ...(w.paintFront ? { paintFront: w.paintFront } : {}),
    ...(w.paintBack ? { paintBack: w.paintBack } : {}),
    ...(w.finishFront ? { finishFront: w.finishFront } : {}),
    ...(w.finishBack ? { finishBack: w.finishBack } : {}),
  }
  if (demoted?.has(wallId)) demoted.add(bSide)
  w.b = mid // a-side keeps the original id

  // Re-anchor openings.
  for (const op of Object.values(doc.openings)) {
    if (op.wallId !== wallId) continue
    const uCenter = op.t * L
    const uSplit = s * L
    const half = op.width / 2
    if (Math.abs(uCenter - uSplit) < half) {
      delete doc.openings[op.id] // straddler
    } else if (uCenter < uSplit) {
      op.t = uCenter / uSplit
    } else {
      op.wallId = bSide
      op.t = (uCenter - uSplit) / (L - uSplit)
    }
  }
  return mid
}

export function splitWall(
  doc: ProjectDocument,
  wallId: WallId,
  s: number,
  opts: { mode?: MutationMode } = {},
): NodeId | null {
  const mid = splitWallRaw(doc, wallId, s)
  runPipeline(doc, opts.mode ?? 'commit')
  return mid
}

/**
 * Delete entities with cascades: wall → its openings; node → attached walls
 * (and their openings); furniture/openings → plain remove. Orphan nodes are
 * GC'd by the pipeline. Rooms are derived — never directly deletable.
 */
export function deleteEntities(
  doc: ProjectDocument,
  ids: readonly (WallId | NodeId | OpeningId | FurnitureId | AnnotationId)[],
  opts: { mode?: MutationMode } = {},
): void {
  const idSet = new Set<string>(ids)
  // nodes first: collect attached walls
  for (const n of Object.values(doc.nodes)) {
    if (!idSet.has(n.id)) continue
    for (const w of Object.values(doc.walls)) {
      if (w.a === n.id || w.b === n.id) idSet.add(w.id)
    }
  }
  for (const w of Object.values(doc.walls)) {
    if (!idSet.has(w.id)) continue
    for (const op of Object.values(doc.openings)) {
      if (op.wallId === w.id) idSet.add(op.id)
    }
    delete doc.walls[w.id]
  }
  for (const key of Object.keys(doc.openings)) {
    if (idSet.has(key)) delete doc.openings[key as OpeningId]
  }
  for (const key of Object.keys(doc.furniture)) {
    if (idSet.has(key)) delete doc.furniture[key as FurnitureId]
  }
  for (const key of Object.keys(doc.annotations)) {
    if (idSet.has(key)) delete doc.annotations[key as AnnotationId]
  }
  for (const key of Object.keys(doc.nodes)) {
    if (idSet.has(key)) delete doc.nodes[key as NodeId]
  }
  gcOrphanNodes(doc)
  runPipeline(doc, opts.mode ?? 'commit')
}

/**
 * Merge node `loser` into `survivor` explicitly (drop-on-node drags).
 * The caller decides which node survives; normalizeGraph's automatic welds
 * use the lexicographic rule instead.
 */
export function mergeNodes(
  doc: ProjectDocument,
  survivor: NodeId,
  loser: NodeId,
  opts: { mode?: MutationMode } = {},
): void {
  if (survivor === loser || !doc.nodes[survivor] || !doc.nodes[loser]) return
  rewireNode(doc, loser, survivor)
  runPipeline(doc, opts.mode ?? 'commit')
}

/** Rewire all walls from `from` to `to`, dropping degenerates + dupes. */
function rewireNode(
  doc: ProjectDocument,
  from: NodeId,
  to: NodeId,
  demoted?: ReadonlySet<string>,
): void {
  for (const w of Object.values(doc.walls)) {
    if (w.a === from) w.a = to
    if (w.b === from) w.b = to
    if (w.a === w.b) {
      for (const op of Object.values(doc.openings)) {
        if (op.wallId === w.id) delete doc.openings[op.id]
      }
      delete doc.walls[w.id]
    }
  }
  delete doc.nodes[from]
  dedupeWalls(doc, demoted)
}

/** Remove duplicate node-pair walls. Survivor = smallest id, except a
 * demoted (pasted) wall never survives against a kept one. */
function dedupeWalls(doc: ProjectDocument, demoted?: ReadonlySet<string>): void {
  const rank = (w: Wall) => (demoted?.has(w.id) ? 1 : 0)
  const byPair = new Map<string, Wall>()
  for (const w of Object.values(doc.walls).sort(
    (x, y) => rank(x) - rank(y) || (x.id < y.id ? -1 : 1),
  )) {
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`
    const kept = byPair.get(key)
    if (!kept) {
      byPair.set(key, w)
    } else {
      // move openings onto the surviving wall (same endpoints ⇒ same length);
      // an opposite-orientation duplicate mirrors the wall-local frame, so
      // t, hinge, and swing (front ≡ +perp(a→b)) all flip with it
      const reversed = w.a === kept.b
      for (const op of Object.values(doc.openings)) {
        if (op.wallId !== w.id) continue
        op.wallId = kept.id
        if (reversed) {
          op.t = 1 - op.t
          if (op.kind === 'door') {
            op.hinge = op.hinge === 'a' ? 'b' : 'a'
            op.swing = op.swing === 'front' ? 'back' : 'front'
          }
        }
      }
      delete doc.walls[w.id]
    }
  }
}

function gcOrphanNodes(doc: ProjectDocument): void {
  const used = new Set<NodeId>()
  for (const w of Object.values(doc.walls)) {
    used.add(w.a)
    used.add(w.b)
  }
  for (const n of Object.values(doc.nodes)) {
    if (!used.has(n.id)) delete doc.nodes[n.id]
  }
}

/**
 * Graph normalization to a planar straight-line graph (bounded fixed point):
 * 1. weld nodes within MERGE_EPS (survivor = lexicographically-smallest id,
 *    keeps ITS position — no averaging; a demoted id never survives against
 *    a kept one — paste determinism, see pipeline.ts PipelineOpts);
 * 2. endpoint-on-segment → T-split (weld tolerance MERGE_EPS);
 * 3. proper segment crossings → X-split both walls at a new node;
 * 4. dedupe duplicate-pair walls, GC orphan nodes;
 * repeated until stable or NORMALIZE_MAX_PASSES (best-effort + dev warning).
 */
export function normalizeGraph(doc: ProjectDocument, demoted?: ReadonlySet<string>): void {
  // Working copy — splits mint fresh ids mid-normalization, and fragments of
  // demoted walls must stay demoted (splitWallRaw adds them here).
  const demo = demoted ? new Set(demoted) : undefined
  for (let pass = 0; pass < NORMALIZE_MAX_PASSES; pass++) {
    let changed = false

    // 1. node welds — deterministic order
    const nodeIds = (Object.keys(doc.nodes) as NodeId[]).sort()
    outer: for (let i = 0; i < nodeIds.length; i++) {
      const a = doc.nodes[nodeIds[i]!]
      if (!a) continue
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = doc.nodes[nodeIds[j]!]
        if (!b) continue
        if (dist(a, b) < MERGE_EPS) {
          // a (lexicographically smaller) survives — unless it is demoted
          // and b is kept, in which case b wins and keeps ITS position
          if (demo?.has(a.id) && !demo.has(b.id)) {
            rewireNode(doc, a.id, b.id, demo)
          } else {
            rewireNode(doc, b.id, a.id, demo)
          }
          changed = true
          continue outer
        }
      }
    }

    // 2. endpoint-on-segment T-splits (exhaust per pass)
    const wallIds = (Object.keys(doc.walls) as WallId[]).sort()
    for (const wid of wallIds) {
      const w = doc.walls[wid]
      if (!w) continue
      const A = pos(doc, w.a)
      const B = pos(doc, w.b)
      // collect nodes lying on this wall's interior
      const hits: { nodeId: NodeId; t: number }[] = []
      for (const n of Object.values(doc.nodes)) {
        if (n.id === w.a || n.id === w.b) continue
        const { point, t } = closestPointOnSegment(n, A, B)
        if (dist(n, point) < MERGE_EPS && t > 0 && t < 1) {
          const L = dist(A, B)
          if (t * L > MERGE_EPS && (1 - t) * L > MERGE_EPS) {
            hits.push({ nodeId: n.id, t })
          }
        }
      }
      if (!hits.length) continue
      hits.sort((x, y) => x.t - y.t)
      // split sequentially; after the first split the a-side keeps the id
      let curId: WallId | null = wid
      let consumed = 0
      for (const h of hits) {
        if (!curId) break
        const cw: Wall | undefined = doc.walls[curId]
        if (!cw) break
        const t = (h.t - consumed) / (1 - consumed)
        const beforeB: NodeId = cw.b
        const mid = splitWallRaw(doc, curId, t, h.nodeId, demo)
        if (mid) {
          changed = true
          // continue splitting on the b-side (the fresh wall)
          const next: Wall | undefined = Object.values(doc.walls).find(
            (x) => x.a === h.nodeId && x.b === beforeB,
          )
          curId = next?.id ?? null
          consumed = h.t
        }
      }
    }

    // 3. proper X-crossings — exhaust within the pass (each split reduces
    // the remaining crossing count, so this inner loop terminates)
    for (;;) {
      if (!splitOneCrossing(doc, demo)) break
      changed = true
    }

    dedupeWalls(doc, demo)
    gcOrphanNodes(doc)
    if (!changed) return
  }
  if (import.meta.env?.DEV) {
    console.warn('normalizeGraph: did not converge within pass budget (best-effort graph kept)')
  }
}

/** Find and split the first proper interior wall×wall crossing. */
function splitOneCrossing(doc: ProjectDocument, demoted?: Set<string>): boolean {
  const list = (Object.keys(doc.walls) as WallId[]).sort()
  for (let i = 0; i < list.length; i++) {
    const w1 = doc.walls[list[i]!]
    if (!w1) continue
    for (let j = i + 1; j < list.length; j++) {
      const w2 = doc.walls[list[j]!]
      if (!w2) continue
      if (w1.a === w2.a || w1.a === w2.b || w1.b === w2.a || w1.b === w2.b) continue
      const r = segSegIntersection(pos(doc, w1.a), pos(doc, w1.b), pos(doc, w2.a), pos(doc, w2.b))
      if (!r) continue
      // proper interior crossings only (ends handled by welds/T-splits)
      const L1 = wallLength(doc, w1)
      const L2 = wallLength(doc, w2)
      if (
        r.t * L1 <= MERGE_EPS ||
        (1 - r.t) * L1 <= MERGE_EPS ||
        r.u * L2 <= MERGE_EPS ||
        (1 - r.u) * L2 <= MERGE_EPS
      ) {
        continue
      }
      const mid = splitWallRaw(doc, w1.id, r.t, undefined, demoted)
      if (mid) splitWallRaw(doc, w2.id, r.u, mid, demoted)
      return true
    }
  }
  return false
}
