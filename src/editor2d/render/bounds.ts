import type { ProjectDocument } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'
import type { Vec2 } from '../../geometry/vec'

/** Point sets covering everything visible — input to zoom-to-fit. */
export function docContentBounds(doc: ProjectDocument, derived: DerivedGeometry): Vec2[][] {
  const polys: Vec2[][] = [
    ...Object.values(derived.outlines.wallPolygons),
    ...Object.values(derived.outlines.nodePatches),
  ]
  for (const f of Object.values(doc.furniture)) {
    const r = Math.hypot(f.size.w, f.size.d) / 2
    polys.push([
      { x: f.x - r, y: f.y - r },
      { x: f.x + r, y: f.y + r },
    ])
  }
  return polys
}
