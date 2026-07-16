import type { Annotation, ProjectDocument } from '../types'
import { DEFAULTS } from '../types'
import { newAnnotationId, type AnnotationId } from '../ids'
import { dist, type Vec2 } from '../../geometry/vec'
import { area } from '../../geometry/polygon'

/**
 * Annotation mutations (v3). Annotations are free plan artifacts — they
 * never participate in the graph pipeline (no normalize/revalidate/
 * reconcile), so live-mode drags need no special casing.
 */

export function addDimension(
  doc: ProjectDocument,
  a: Vec2,
  b: Vec2,
  offset = 0,
): AnnotationId | null {
  if (dist(a, b) < DEFAULTS.minWallLength) return null
  const id = newAnnotationId()
  const m = DEFAULTS.maxDimensionOffset
  doc.annotations[id] = {
    id,
    kind: 'dimension',
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    offset: Math.min(m, Math.max(-m, offset)),
  }
  return id
}

export function addLabel(doc: ProjectDocument, pos: Vec2, text: string): AnnotationId | null {
  if (!text.trim()) return null
  const id = newAnnotationId()
  doc.annotations[id] = { id, kind: 'label', x: pos.x, y: pos.y, text }
  return id
}

/** Traces below this shoelace area (m²) are degenerate — rejected. */
export const MIN_AREA_M2 = 0.001

/** Traced area polygon (v4) — single mutation on trace close (one undo
 * entry); rejects < 3 points or a near-zero (collinear) polygon, the
 * addDimension precedent. */
export function addArea(doc: ProjectDocument, points: readonly Vec2[]): AnnotationId | null {
  if (points.length < 3 || area(points) < MIN_AREA_M2) return null
  const id = newAnnotationId()
  doc.annotations[id] = {
    id,
    kind: 'area',
    points: points.map((p) => ({ x: p.x, y: p.y })),
  }
  return id
}

export interface AnnotationPatch {
  /** dimension: slide the line along its normal. */
  offset?: number
  /** label: position / content / orientation / world text size. */
  x?: number
  y?: number
  text?: string
  rotation?: number
  fontSize?: number
  /** area: replace the traced polygon (rigid drags translate every point). */
  points?: { x: number; y: number }[]
}

export function updateAnnotation(
  doc: ProjectDocument,
  id: AnnotationId,
  patch: AnnotationPatch,
): void {
  const ann = doc.annotations[id]
  if (!ann) return
  if (ann.kind === 'dimension') {
    if (patch.offset !== undefined && Number.isFinite(patch.offset)) {
      const m = DEFAULTS.maxDimensionOffset
      ann.offset = Math.min(m, Math.max(-m, patch.offset))
    }
    return
  }
  if (ann.kind === 'area') {
    if (
      patch.points &&
      patch.points.length >= 3 &&
      patch.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ) {
      ann.points = patch.points.map((p) => ({ x: p.x, y: p.y }))
    }
    return
  }
  if (patch.x !== undefined && Number.isFinite(patch.x)) ann.x = patch.x
  if (patch.y !== undefined && Number.isFinite(patch.y)) ann.y = patch.y
  if (patch.text !== undefined) {
    // deleting all text deletes the label (empty labels are unselectable)
    if (!patch.text.trim()) {
      delete doc.annotations[id]
      return
    }
    ann.text = patch.text
  }
  if (patch.rotation !== undefined && Number.isFinite(patch.rotation)) {
    ann.rotation = patch.rotation
  }
  if (patch.fontSize !== undefined && Number.isFinite(patch.fontSize)) {
    ann.fontSize = Math.min(1, Math.max(0.05, patch.fontSize))
  }
}

/** Kept alongside the entity type: the deleteEntities cascade calls this. */
export function deleteAnnotations(doc: ProjectDocument, ids: readonly AnnotationId[]): void {
  for (const id of ids) delete doc.annotations[id]
}

export type { Annotation }
