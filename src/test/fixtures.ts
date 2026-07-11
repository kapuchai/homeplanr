import { asNodeId, asWallId, type NodeId, type WallId } from '../model/ids'
import type { Wall, WallNode } from '../model/types'

/** Compact wall-graph fixture builder for geometry/model tests. */
export function fixture(
  nodeDefs: [string, number, number][],
  wallDefs: [string, string, string, number?][],
): { nodes: Record<NodeId, WallNode>; walls: Record<WallId, Wall> } {
  const nodes: Record<NodeId, WallNode> = {}
  for (const [id, x, y] of nodeDefs) {
    nodes[asNodeId(id)] = { id: asNodeId(id), x, y }
  }
  const walls: Record<WallId, Wall> = {}
  for (const [id, a, b, t] of wallDefs) {
    walls[asWallId(id)] = {
      id: asWallId(id),
      a: asNodeId(a),
      b: asNodeId(b),
      thickness: t ?? 0.2,
      height: 2.5,
    }
  }
  return { nodes, walls }
}

/** Rectangle ring of walls; returns the wall ids used. */
export function rectWalls(
  prefix: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { nodeDefs: [string, number, number][]; wallDefs: [string, string, string, number?][] } {
  const n = (i: number) => `${prefix}n${i}`
  const w = (i: number) => `${prefix}w${i}`
  return {
    nodeDefs: [
      [n(0), x0, y0],
      [n(1), x1, y0],
      [n(2), x1, y1],
      [n(3), x0, y1],
    ],
    wallDefs: [
      [w(0), n(0), n(1)],
      [w(1), n(1), n(2)],
      [w(2), n(2), n(3)],
      [w(3), n(3), n(0)],
    ],
  }
}
