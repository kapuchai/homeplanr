import { DEFAULTS, type ProjectDocument } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'
import type { AnnotationId, FurnitureId, NodeId, OpeningId, RoomId, WallId } from '../../model/ids'

/** Point sets covering everything visible — input to zoom-to-fit. */
export function docContentBounds(doc: ProjectDocument, derived: DerivedGeometry): Vec2[][] {
  const polys: Vec2[][] = [
    ...Object.values(derived.outlines.wallPolygons),
    ...Object.values(derived.outlines.nodePatches),
  ]
  for (const f of Object.values(doc.furniture)) {
    polys.push(furnitureBounds(f))
  }
  for (const ann of Object.values(doc.annotations)) {
    polys.push(annotationBounds(ann))
  }
  return polys
}

const annotationBounds = (ann: ProjectDocument['annotations'][AnnotationId] & object): Vec2[] => {
  if (ann.kind === 'dimension') {
    const dx = ann.b.x - ann.a.x
    const dy = ann.b.y - ann.a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * ann.offset
    const ny = (dx / len) * ann.offset
    return [
      { x: ann.a.x, y: ann.a.y },
      { x: ann.b.x, y: ann.b.y },
      { x: ann.a.x + nx, y: ann.a.y + ny },
      { x: ann.b.x + nx, y: ann.b.y + ny },
    ]
  }
  const size = ann.fontSize ?? DEFAULTS.labelFontSize
  const r = Math.max(size, (ann.text.length * size * 0.62) / 2)
  return [
    { x: ann.x - r, y: ann.y - r },
    { x: ann.x + r, y: ann.y + r },
  ]
}

const furnitureBounds = (f: ProjectDocument['furniture'][FurnitureId] & object): Vec2[] => {
  const r = Math.hypot(f.size.w, f.size.d) / 2
  return [
    { x: f.x - r, y: f.y - r },
    { x: f.x + r, y: f.y + r },
  ]
}

/** Point sets covering just the given selection — input to zoom-to-selection. */
export function selectionContentBounds(
  doc: ProjectDocument,
  derived: DerivedGeometry,
  ids: readonly string[],
): Vec2[][] {
  const polys: Vec2[][] = []
  for (const id of ids) {
    const w = doc.walls[id as WallId]
    if (w) {
      const poly = derived.outlines.wallPolygons[w.id]
      const na = doc.nodes[w.a]
      const nb = doc.nodes[w.b]
      if (poly) polys.push(poly)
      else if (na && nb) polys.push([{ ...na }, { ...nb }])
      continue
    }
    const f = doc.furniture[id as FurnitureId]
    if (f) {
      polys.push(furnitureBounds(f))
      continue
    }
    const op = doc.openings[id as OpeningId]
    if (op) {
      const wall = doc.walls[op.wallId]
      const na = wall && doc.nodes[wall.a]
      const nb = wall && doc.nodes[wall.b]
      if (na && nb) polys.push([{ ...na }, { ...nb }])
      continue
    }
    const room = derived.rooms[id as RoomId]
    if (room) {
      polys.push(room.polygon)
      continue
    }
    const n = doc.nodes[id as NodeId]
    if (n) {
      polys.push([{ x: n.x, y: n.y }])
      continue
    }
    const ann = doc.annotations[id as AnnotationId]
    if (ann) polys.push(annotationBounds(ann))
  }
  return polys
}
