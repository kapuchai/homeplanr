import { describe, expect, it } from 'vitest'
import type { WallSolid } from '../geometry/wallSolids'
import type { WallId } from '../model/ids'
import { hiddenWallIds, sameWallSet } from './wallOcclusion'

/** Minimal solid — occlusion only reads wallId + frame. */
const solid = (id: string, origin: [number, number], to: [number, number]): WallSolid => {
  const dx = to[0] - origin[0]
  const dy = to[1] - origin[1]
  const length = Math.hypot(dx, dy)
  return {
    wallId: id as WallId,
    frame: {
      origin: { x: origin[0], y: origin[1] },
      dir: { x: dx / length, y: dy / length },
      length,
    },
    prisms: [],
    openings: [],
    clamped: false,
  }
}

/** 6×4 m rectangle room, anchor at its center (3, 2). Plan y-down. */
const ROOM: WallSolid[] = [
  solid('north', [0, 0], [6, 0]), // top edge (y=0)
  solid('east', [6, 0], [6, 4]),
  solid('south', [6, 4], [0, 4]),
  solid('west', [0, 4], [0, 0]),
]
const ANCHOR = { x: 3, y: 2 }

describe('hiddenWallIds', () => {
  it('camera outside a corner hides the two near walls, keeps the far pair', () => {
    // above-left of the room in plan coords → beyond north AND west lines
    const hidden = hiddenWallIds({ x: -5, y: -5 }, ANCHOR, ROOM)
    expect(hidden).toEqual(new Set(['north', 'west']))
  })

  it('camera straight out from one side hides only that wall', () => {
    const hidden = hiddenWallIds({ x: 3, y: -6 }, ANCHOR, ROOM)
    expect(hidden).toEqual(new Set(['north']))
  })

  it('camera at the anchor (top preset: plan position ≈ anchor) hides nothing', () => {
    expect(hiddenWallIds(ANCHOR, ANCHOR, ROOM).size).toBe(0)
  })

  it('camera inside the room hides nothing', () => {
    expect(hiddenWallIds({ x: 1.5, y: 1.5 }, ANCHOR, ROOM).size).toBe(0)
  })

  it('camera within the dead-zone of a wall line does not hide it', () => {
    // 0.3 m beyond the north line — under CAM_SIDE_MIN (0.4)
    expect(hiddenWallIds({ x: 3, y: -0.3 }, ANCHOR, ROOM).size).toBe(0)
  })

  it('a partition through the anchor is ambiguous and never hides', () => {
    const partition = solid('mid', [3, 0], [3, 4]) // vertical wall through x=3
    const hidden = hiddenWallIds({ x: -5, y: 2 }, ANCHOR, [...ROOM, partition])
    expect(hidden.has('mid' as WallId)).toBe(false)
    expect(hidden).toEqual(new Set(['west']))
  })

  it('an off-center partition hides when the camera looks across it', () => {
    const partition = solid('mid', [5, 0], [5, 4]) // x=5, anchor clearly west of it
    const hidden = hiddenWallIds({ x: 12, y: 2 }, ANCHOR, [...ROOM, partition])
    expect(hidden.has('mid' as WallId)).toBe(true)
    expect(hidden.has('east' as WallId)).toBe(true)
  })
})

describe('sameWallSet', () => {
  it('equal, different, and size-mismatched sets', () => {
    const a = new Set(['x', 'y'] as WallId[])
    expect(sameWallSet(a, new Set(['y', 'x'] as WallId[]))).toBe(true)
    expect(sameWallSet(a, new Set(['x', 'z'] as WallId[]))).toBe(false)
    expect(sameWallSet(a, new Set(['x'] as WallId[]))).toBe(false)
  })
})
