import type { ProjectDocument, FurnitureInstance } from '../../model/types'
import type { NodeId, WallId } from '../../model/ids'
import type { DerivedGeometry } from '../../store/derived'
import type { RigStarts, RoomRig } from '../../model/mutations/roomRig'
import type { SnapCandidate } from '../../geometry/snapping'
import type { Vec2 } from '../../geometry/vec'
import { add, dist, normalize, perp, scale, sub } from '../../geometry/vec'
import { closestPointOnSegment } from '../../geometry/segment'
import { gridTier } from '../viewport/viewportMath'

/**
 * Snap candidate GENERATORS (plan-pinned: geometry/snapping.ts is the only
 * resolver; these produce concrete candidates per tool per frame).
 */

export function nodeCandidates(
  doc: ProjectDocument,
  exclude?: ReadonlySet<NodeId>,
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  for (const n of Object.values(doc.nodes)) {
    if (exclude?.has(n.id)) continue
    out.push({ kind: 'node', point: { x: n.x, y: n.y }, nodeId: n.id })
  }
  return out
}

/** Closest point on each wall centerline (drives T-join splits). */
export function wallPointCandidates(
  doc: ProjectDocument,
  raw: Vec2,
  exclude?: ReadonlySet<WallId>,
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  for (const w of Object.values(doc.walls)) {
    if (exclude?.has(w.id)) continue
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const { point, t } = closestPointOnSegment(raw, na, nb)
    if (t > 0.001 && t < 0.999) {
      out.push({
        kind: 'wallPoint',
        point,
        wallId: w.id,
        t,
        a: { x: na.x, y: na.y },
        b: { x: nb.x, y: nb.y },
      })
    }
  }
  return out
}

/** Grid candidate: step = the DISPLAYED minor tier (snap what you see). */
export function gridCandidate(doc: ProjectDocument, k: number): SnapCandidate {
  return { kind: 'grid', step: gridTier(k, doc.settings.gridSize).minor }
}

/** 0/45/90° family rays through the draw-wall anchor. */
export function angleRayCandidates(anchor: Vec2): SnapCandidate[] {
  const out: SnapCandidate[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    out.push({
      kind: 'angleRay',
      origin: anchor,
      dir: { x: Math.cos(a), y: Math.sin(a) },
      label: `${i * 45}°`,
    })
  }
  return out
}

const isAxisAligned = (rotation: number): boolean => {
  const r = ((rotation % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
  return r < 0.035 || Math.PI / 2 - r < 0.035
}

/** AABB of an axis-aligned-enough furniture item. */
function itemAabb(f: FurnitureInstance): { cx: number; cy: number; hw: number; hh: number } {
  const quarter = Math.round(f.rotation / (Math.PI / 2)) % 2 !== 0
  const hw = (quarter ? f.size.d : f.size.w) / 2
  const hh = (quarter ? f.size.w : f.size.d) / 2
  return { cx: f.x, cy: f.y, hw, hh }
}

/**
 * Figma-style alignment guides for a furniture drag: the dragged item's
 * edges/centers align to other items' edges/centers and to wall faces.
 * `value` = snapped CENTER coordinate; `display` = the shared line.
 * Only axis-aligned(±2°) participants emit guides.
 */
export function alignmentGuideCandidates(
  doc: ProjectDocument,
  dragged: { hw: number; hh: number; rotation: number },
  draggedIds: ReadonlySet<string>,
): SnapCandidate[] {
  if (!isAxisAligned(dragged.rotation)) return []
  const out: SnapCandidate[] = []
  const offsetsX = [0, dragged.hw, -dragged.hw]
  const offsetsY = [0, dragged.hh, -dragged.hh]

  const emit = (axis: 'x' | 'y', line: number, refId: string) => {
    if (axis === 'x') {
      for (const off of offsetsX) {
        out.push({ kind: 'guideX', value: line - off, display: line, refIds: [refId] })
      }
    } else {
      for (const off of offsetsY) {
        out.push({ kind: 'guideY', value: line - off, display: line, refIds: [refId] })
      }
    }
  }

  for (const f of Object.values(doc.furniture)) {
    if (draggedIds.has(f.id) || !isAxisAligned(f.rotation)) continue
    const b = itemAabb(f)
    for (const x of [b.cx, b.cx - b.hw, b.cx + b.hw]) emit('x', x, f.id)
    for (const y of [b.cy, b.cy - b.hh, b.cy + b.hh]) emit('y', y, f.id)
  }
  // wall faces (axis-aligned walls only)
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const half = w.thickness / 2
    if (Math.abs(na.x - nb.x) < 1e-9) {
      emit('x', na.x - half, w.id)
      emit('x', na.x + half, w.id)
    } else if (Math.abs(na.y - nb.y) < 1e-9) {
      emit('y', na.y - half, w.id)
      emit('y', na.y + half, w.id)
    }
  }
  return out
}

/**
 * Room-drag snap candidates (0.8.0). The snap SUBJECT is the grab point,
 * and every candidate is prepositioned by FROZEN start offsets — the list
 * is constant for the whole gesture, so compute it ONCE at drag-arm.
 *
 * - Corner-node candidates: grab positions at which a rig corner lands
 *   EXACTLY on a stationary node — the PRIMARY weld mechanism (only node
 *   coincidence merges walls; normalizeGraph has no collinear-overlap
 *   merge). `display` = the stationary node, so the indicator ring
 *   renders on the welding corner instead of at the cursor.
 * - guideX/guideY: grab positions at which an axis-aligned rig wall's
 *   CENTERLINE becomes collinear with a stationary wall's — release
 *   T-splits the stationary wall at the rig corners and dedupes the
 *   coincident fragment into a shared segment. `display` = the stationary
 *   centerline, so the guide line renders on the target wall.
 * Non-axis-aligned walls emit no guides (furniture-guide parity); corner
 * snapping works at any angle.
 */
export function roomSnapCandidates(
  doc: ProjectDocument,
  rig: RoomRig,
  starts: RigStarts,
  grab: Vec2,
): SnapCandidate[] {
  const out: SnapCandidate[] = []
  const rigNodes = new Set<string>(rig.nodeIds)
  const rigWalls = new Set<string>(rig.wallIds)

  const cornerOffsets = [...starts.nodes.values()].map((p) => sub(p, grab))
  for (const n of Object.values(doc.nodes)) {
    if (rigNodes.has(n.id)) continue
    for (const off of cornerOffsets) {
      out.push({
        kind: 'node',
        point: { x: n.x - off.x, y: n.y - off.y },
        nodeId: n.id,
        display: { x: n.x, y: n.y },
      })
    }
  }

  const xOffs = new Set<number>()
  const yOffs = new Set<number>()
  for (const id of rig.wallIds) {
    const w = doc.walls[id]
    const a = w && starts.nodes.get(w.a)
    const b = w && starts.nodes.get(w.b)
    if (!a || !b) continue
    if (Math.abs(a.x - b.x) < 1e-9) xOffs.add(a.x - grab.x)
    else if (Math.abs(a.y - b.y) < 1e-9) yOffs.add(a.y - grab.y)
  }
  for (const w of Object.values(doc.walls)) {
    if (rigWalls.has(w.id)) continue
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    if (Math.abs(na.x - nb.x) < 1e-9) {
      for (const off of xOffs) {
        out.push({ kind: 'guideX', value: na.x - off, display: na.x, refIds: [w.id] })
      }
    } else if (Math.abs(na.y - nb.y) < 1e-9) {
      for (const off of yOffs) {
        out.push({ kind: 'guideY', value: na.y - off, display: na.y, refIds: [w.id] })
      }
    }
  }
  return out
}

/**
 * Back-against-wall capture for a single wallSnap item: candidate point is
 * the item CENTER position at which its back edge kisses the nearest wall
 * face; carries the auto-rotation and the 1-DOF slide line.
 */
export function wallBackCandidate(
  doc: ProjectDocument,
  _derived: DerivedGeometry,
  raw: Vec2,
  itemDepth: number,
): SnapCandidate | null {
  let best: SnapCandidate | null = null
  let bestD = Infinity
  for (const w of Object.values(doc.walls)) {
    const na = doc.nodes[w.a]
    const nb = doc.nodes[w.b]
    if (!na || !nb) continue
    const dir = normalize(sub(nb, na))
    const n = perp(dir)
    const half = w.thickness / 2
    for (const side of [1, -1]) {
      // face line offset from the centerline; outward normal = side·perp
      const faceNormal = scale(n, side)
      const { point: onCenter, t } = closestPointOnSegment(raw, na, nb)
      if (t <= 0 || t >= 1) continue
      const facePoint = add(onCenter, scale(faceNormal, half))
      // item center target: back edge flush → center offset by depth/2
      const target = add(facePoint, scale(faceNormal, itemDepth / 2))
      const d = dist(raw, target)
      if (d < bestD) {
        bestD = d
        // rotation: item local +y (back) must face the wall (−faceNormal)
        const rotation = Math.atan2(faceNormal.x, -faceNormal.y)
        best = {
          kind: 'wallBack',
          point: target,
          wallId: w.id,
          rotation,
          slideOrigin: target,
          slideDir: dir,
        }
      }
    }
  }
  return best
}
