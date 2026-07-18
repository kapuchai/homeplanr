import { CATALOG } from '../../catalog'
import { levelDocOf } from '../../store/levelView'
import { levelElevations } from '../../model/levels'
import type { ProjectDocument } from '../../model/types'
import type { LevelId } from '../../model/ids'
import type { Vec2 } from '../../geometry/vec'

/**
 * Walk-mode storey transitions (0.13.0, v1 = deterministic teleport
 * zones): every connector stair links its own level N to N+1.
 *
 * Ascend: the walker steps into a strip just in FRONT of the stair's
 * bottom tread (the stair's own OBB blocks walking through it) and
 * arrives on N+1 just PAST the stairwell's top edge. Descend: on N+1 the
 * stairwell is a carved hole with the stair's top treads in it — stepping
 * onto the TOP strip of the stair footprint drops the walker to N at the
 * bottom-front arrival. Zones/arrivals are stair-local strips mapped to
 * plan space; a latch in WalkControls keeps an arrival inside the twin
 * zone from bouncing straight back.
 */
export interface StairTransition {
  /** Plan-space quad — standing inside it triggers the switch. */
  zone: Vec2[]
  /** Plan-space arrival point on the target storey. */
  arrival: Vec2
  targetLevelId: LevelId
  targetElevation: number
}

/** Zone strip depth (m) and how far past the stair edge arrivals land. */
const ZONE_DEPTH = 0.55
const ARRIVAL_CLEAR = 0.45

/** Stair-local rect → plan quad for instance f. */
const localRect = (
  f: { x: number; y: number; rotation: number },
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Vec2[] => {
  const cos = Math.cos(f.rotation)
  const sin = Math.sin(f.rotation)
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((p) => ({
    x: f.x + p.x * cos - p.y * sin,
    y: f.y + p.x * sin + p.y * cos,
  }))
}

const localPoint = (
  f: { x: number; y: number; rotation: number },
  x: number,
  y: number,
): Vec2 => {
  const cos = Math.cos(f.rotation)
  const sin = Math.sin(f.rotation)
  return { x: f.x + x * cos - y * sin, y: f.y + x * sin + y * cos }
}

/** Transitions AVAILABLE FROM the given storey (both directions). */
export function buildStairTransitions(
  doc: ProjectDocument,
  activeLevelId: LevelId | null,
): StairTransition[] {
  const idx = Math.max(
    0,
    activeLevelId ? doc.levels.findIndex((l) => l.id === activeLevelId) : 0,
  )
  const elevations = levelElevations(doc)
  const out: StairTransition[] = []

  const connectors = (levelIndex: number) => {
    const view = levelDocOf(doc, doc.levels[levelIndex]!.id)
    return Object.values(view.furniture).filter(
      (f) => CATALOG[f.catalogItemId]?.connectsLevels,
    )
  }

  // ascend: stairs ON this storey that lead to an existing storey above
  if (idx + 1 < doc.levels.length) {
    const above = doc.levels[idx + 1]!
    for (const f of connectors(idx)) {
      const hw = f.size.w / 2
      const hd = f.size.d / 2
      out.push({
        zone: localRect(f, -hw, hw, -hd - ZONE_DEPTH, -hd),
        arrival: localPoint(f, 0, hd + ARRIVAL_CLEAR),
        targetLevelId: above.id,
        targetElevation: elevations[idx + 1]!,
      })
    }
  }

  // descend: stairs on the storey BELOW — their top strip is the hole edge
  if (idx > 0) {
    const below = doc.levels[idx - 1]!
    for (const f of connectors(idx - 1)) {
      const hw = f.size.w / 2
      const hd = f.size.d / 2
      out.push({
        zone: localRect(f, -hw, hw, hd - ZONE_DEPTH, hd),
        arrival: localPoint(f, 0, -hd - ARRIVAL_CLEAR),
        targetLevelId: below.id,
        targetElevation: elevations[idx - 1]!,
      })
    }
  }

  return out
}
