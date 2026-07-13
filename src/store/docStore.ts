import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import { emptyDocument, type ProjectDocument, type ProjectSettings } from '../model/types'
import { newProjectId, type AnnotationId, type FurnitureId, type NodeId, type OpeningId, type RoomId, type WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import * as walls from '../model/mutations/walls'
import * as openings from '../model/mutations/openings'
import * as furniture from '../model/mutations/furniture'
import * as rooms from '../model/mutations/rooms'
import * as project from '../model/mutations/project'
import * as annotations from '../model/mutations/annotations'
import * as paste from '../model/mutations/paste'
import type { MutationMode } from '../model/mutations/pipeline'

/**
 * The document store — the ONLY undoable, ONLY persisted state.
 *
 * Middleware composition is pinned (plan §Store):
 *   create<DocState>()(temporal(subscribeWithSelector(immer(init)), opts))
 * - temporal outermost: records exactly the partialized {doc} slice;
 * - subscribeWithSelector inside: the 3D invalidate bridge and selection
 *   pruning subscribe to s.doc with reference equality;
 * - immer innermost: mutations run as recipes on a draft; one committed
 *   mutation ⇒ one new doc identity (the WeakMap derived memo, the dirty
 *   flag, and every renderer memo key off that identity).
 *
 * updatedAt is NEVER touched by mutations — serialize() stamps it on emit.
 */
export interface DocState {
  doc: ProjectDocument
  // wall graph
  addWallSegment: (p1: Vec2, p2: Vec2, opts?: Parameters<typeof walls.addWallSegment>[3]) => walls.AddWallResult
  addWallChain: (points: readonly Vec2[], opts?: Parameters<typeof walls.addWallChain>[2]) => WallId[]
  moveNode: (id: NodeId, p: Vec2, opts?: { mode?: MutationMode }) => void
  moveWall: (id: WallId, delta: Vec2, opts?: { mode?: MutationMode }) => void
  updateWall: (id: WallId, patch: Parameters<typeof walls.updateWall>[2], opts?: { mode?: MutationMode }) => void
  setWallLength: (id: WallId, length: number, opts?: { mode?: MutationMode }) => void
  splitWall: (id: WallId, s: number, opts?: { mode?: MutationMode }) => NodeId | null
  mergeNodes: (survivor: NodeId, loser: NodeId, opts?: { mode?: MutationMode }) => void
  deleteEntities: (ids: readonly (WallId | NodeId | OpeningId | FurnitureId | AnnotationId)[], opts?: { mode?: MutationMode }) => void
  // openings
  addOpening: (params: openings.AddOpeningParams, opts?: { mode?: MutationMode }) => OpeningId | null
  updateOpening: (id: OpeningId, patch: Parameters<typeof openings.updateOpening>[2], opts?: { mode?: MutationMode }) => void
  // furniture
  addFurniture: (params: Parameters<typeof furniture.addFurniture>[1]) => FurnitureId
  addFurnitureBatch: (items: Parameters<typeof furniture.addFurnitureBatch>[1]) => FurnitureId[]
  transformFurniture: (id: FurnitureId, patch: Parameters<typeof furniture.transformFurniture>[2], opts?: Parameters<typeof furniture.transformFurniture>[3]) => void
  resizeFurniture: (id: FurnitureId, size: Parameters<typeof furniture.resizeFurniture>[2]) => void
  renameFurniture: (id: FurnitureId, name: string) => void
  duplicateFurniture: (ids: readonly FurnitureId[]) => FurnitureId[]
  alignFurniture: (ids: readonly FurnitureId[], edge: furniture.AlignEdge) => void
  distributeFurniture: (ids: readonly FurnitureId[], axis: 'x' | 'y') => void
  // paste (M9): one mutation ⇒ one undo entry; the commit pipeline welds
  pasteSubgraph: (payload: paste.GraphPayload, target: Vec2) => WallId[]
  // annotations
  addDimension: (a: Vec2, b: Vec2, offset?: number) => AnnotationId | null
  addLabel: (pos: Vec2, text: string) => AnnotationId | null
  updateAnnotation: (id: AnnotationId, patch: annotations.AnnotationPatch) => void
  // rooms / project
  renameRoom: (id: RoomId, name: string) => void
  setRoomFloorMaterial: (id: RoomId, materialId: string | undefined) => void
  paintRoomWalls: (id: RoomId, paintId: string | undefined) => void
  renameProject: (name: string) => void
  updateSettings: (patch: Partial<ProjectSettings>) => void
  // document lifecycle
  newDocument: (name?: string) => void
  replaceDocument: (doc: ProjectDocument) => void
}

const initialDoc = () =>
  emptyDocument(newProjectId(), 'Untitled', new Date().toISOString())

export const useDocStore = create<DocState>()(
  temporal(
    subscribeWithSelector(
      immer((set) => {
        /** Run a mutation on the draft doc and pass its return value out. */
        function mutate<R>(fn: (doc: ProjectDocument) => R): R {
          let result!: R
          set((s) => {
            result = fn(s.doc)
          })
          return result
        }
        return {
          doc: initialDoc(),
          addWallSegment: (p1, p2, opts) => mutate((d) => walls.addWallSegment(d, p1, p2, opts)),
          addWallChain: (points, opts) => mutate((d) => walls.addWallChain(d, points, opts)),
          moveNode: (id, p, opts) => mutate((d) => walls.moveNode(d, id, p, opts)),
          moveWall: (id, delta, opts) => mutate((d) => walls.moveWall(d, id, delta, opts)),
          updateWall: (id, patch, opts) => mutate((d) => walls.updateWall(d, id, patch, opts)),
          setWallLength: (id, length, opts) => mutate((d) => walls.setWallLength(d, id, length, opts)),
          splitWall: (id, s, opts) => mutate((d) => walls.splitWall(d, id, s, opts)),
          mergeNodes: (survivor, loser, opts) => mutate((d) => walls.mergeNodes(d, survivor, loser, opts)),
          deleteEntities: (ids, opts) => mutate((d) => walls.deleteEntities(d, ids, opts)),
          addOpening: (params, opts) => mutate((d) => openings.addOpening(d, params, opts)),
          updateOpening: (id, patch, opts) => mutate((d) => openings.updateOpening(d, id, patch, opts)),
          addFurniture: (params) => mutate((d) => furniture.addFurniture(d, params)),
          addFurnitureBatch: (items) => mutate((d) => furniture.addFurnitureBatch(d, items)),
          transformFurniture: (id, patch, opts) => mutate((d) => furniture.transformFurniture(d, id, patch, opts)),
          resizeFurniture: (id, size) => mutate((d) => furniture.resizeFurniture(d, id, size)),
          renameFurniture: (id, name) => mutate((d) => furniture.renameFurniture(d, id, name)),
          duplicateFurniture: (ids) => mutate((d) => furniture.duplicateFurniture(d, ids)),
          alignFurniture: (ids, edge) => mutate((d) => furniture.alignFurniture(d, ids, edge)),
          distributeFurniture: (ids, axis) => mutate((d) => furniture.distributeFurniture(d, ids, axis)),
          pasteSubgraph: (payload, target) => mutate((d) => paste.pasteSubgraph(d, payload, target)),
          addDimension: (a, b, offset) => mutate((d) => annotations.addDimension(d, a, b, offset)),
          addLabel: (pos, text) => mutate((d) => annotations.addLabel(d, pos, text)),
          updateAnnotation: (id, patch) => mutate((d) => annotations.updateAnnotation(d, id, patch)),
          renameRoom: (id, name) => mutate((d) => rooms.renameRoom(d, id, name)),
          setRoomFloorMaterial: (id, mat) => mutate((d) => rooms.setRoomFloorMaterial(d, id, mat)),
          paintRoomWalls: (id, paintId) => mutate((d) => rooms.paintRoomWalls(d, id, paintId)),
          renameProject: (name) => mutate((d) => project.renameProject(d, name)),
          updateSettings: (patch) => mutate((d) => project.updateSettings(d, patch)),
          newDocument: (name = 'Untitled') =>
            set((s) => {
              s.doc = emptyDocument(newProjectId(), name, new Date().toISOString())
            }),
          replaceDocument: (doc) =>
            set((s) => {
              s.doc = doc
            }),
        }
      }),
    ),
    {
      // zundo compares PARTIALIZED wrappers — equality must look at .doc,
      // a bare wrapper === wrapper is never true.
      partialize: (s) => ({ doc: s.doc }) as DocState,
      equality: (past, curr) => past.doc === curr.doc,
      limit: 100,
    },
  ),
)

/** The temporal (undo/redo) API — use ONLY through store/transactions.ts. */
export const docTemporal = useDocStore.temporal
