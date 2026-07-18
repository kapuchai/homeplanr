import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import {
  emptyDocument,
  type LevelDoc,
  type ProjectDocument,
  type ProjectSettings,
} from '../model/types'
import { makeLevelDoc } from '../model/levels'
import { useActiveLevel } from './activeLevel'
import { newProjectId, type AnnotationId, type FurnitureId, type NodeId, type OpeningId, type RoomId, type WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import * as walls from '../model/mutations/walls'
import * as openings from '../model/mutations/openings'
import * as furniture from '../model/mutations/furniture'
import * as assets from '../model/mutations/assets'
import * as rooms from '../model/mutations/rooms'
import * as project from '../model/mutations/project'
import * as annotations from '../model/mutations/annotations'
import * as paste from '../model/mutations/paste'
import * as attachment from '../model/mutations/attachment'
import * as roomRig from '../model/mutations/roomRig'
import * as levelOps from '../model/mutations/levelOps'
import type { LevelId } from '../model/ids'
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
  rehomeOpening: (id: OpeningId, wallId: WallId, t: number, opts?: { mode?: MutationMode }) => void
  // furniture
  addFurniture: (params: Parameters<typeof furniture.addFurniture>[1]) => FurnitureId
  addFurnitureBatch: (items: Parameters<typeof furniture.addFurnitureBatch>[1]) => FurnitureId[]
  transformFurniture: (id: FurnitureId, patch: Parameters<typeof furniture.transformFurniture>[2], opts?: Parameters<typeof furniture.transformFurniture>[3]) => void
  resizeFurniture: (id: FurnitureId, size: Parameters<typeof furniture.resizeFurniture>[2]) => void
  renameFurniture: (id: FurnitureId, name: string) => void
  /** Ingest-or-dedupe + point the instance at it (null clears); ONE
   * mutation ⇒ one undo entry for the whole upload. */
  setFurnitureImage: (id: FurnitureId, content: assets.AssetContent | null) => void
  /** Custom save preview (0.11.0): set = upload override, null = back
   * to the auto render. One undoable mutation either way. */
  setPreviewImage: (content: assets.AssetContent | null) => void
  // window attachment (v6 curtains)
  attachFurniture: (id: FurnitureId, openingId: OpeningId, ref?: Vec2) => void
  detachFurniture: (id: FurnitureId) => void
  setMaterialOverride: (id: FurnitureId, slot: string, value: string | undefined) => void
  setFurnitureMeta: (id: FurnitureId, patch: Parameters<typeof furniture.setFurnitureMeta>[2]) => void
  setFurnitureLight: (id: FurnitureId, patch: Parameters<typeof furniture.setFurnitureLight>[2]) => void
  duplicateFurniture: (ids: readonly FurnitureId[]) => FurnitureId[]
  alignFurniture: (ids: readonly FurnitureId[], edge: furniture.AlignEdge) => void
  distributeFurniture: (ids: readonly FurnitureId[], axis: 'x' | 'y') => void
  // paste (M9): one mutation ⇒ one undo entry; the commit pipeline welds
  pasteSubgraph: (payload: paste.GraphPayload, target: Vec2) => WallId[]
  // room rig (0.8.0): tear runs INSIDE the gesture tx (abort restores it);
  // collect/captureStarts are pure reads — tools call them on ctx.doc()
  tearRoomRig: (rig: roomRig.RoomRig) => roomRig.RoomRig
  transformRoomRig: (
    rig: roomRig.RoomRig,
    starts: roomRig.RigStarts,
    xform: roomRig.RigTransform,
    opts?: { mode?: MutationMode },
  ) => void
  // annotations
  addDimension: (a: Vec2, b: Vec2, offset?: number) => AnnotationId | null
  addLabel: (pos: Vec2, text: string) => AnnotationId | null
  addArea: (points: readonly Vec2[]) => AnnotationId | null
  updateAnnotation: (id: AnnotationId, patch: annotations.AnnotationPatch) => void
  // rooms / project
  renameRoom: (id: RoomId, name: string) => void
  setRoomFloorMaterial: (id: RoomId, materialId: string | undefined) => void
  setRoomFloorElevation: (id: RoomId, elevation: number | undefined) => void
  setRoomType: (id: RoomId, roomType: string | undefined) => void
  paintRoomWalls: (id: RoomId, paintId: string | undefined) => void
  renameProject: (name: string) => void
  updateSettings: (patch: Partial<ProjectSettings>) => void
  /** Project notes (0.15.0 pull-forward): undoable doc-scoped edit. */
  setNotes: (notes: string) => void
  // storeys (v7) — doc-scoped, all undoable
  addLevel: () => LevelId
  duplicateLevel: (id: LevelId) => LevelId | null
  renameLevel: (id: LevelId, name: string) => void
  moveLevel: (id: LevelId, delta: 1 | -1) => boolean
  /** Floor-wide wall height: stores the storey setting + re-heights every
   * wall on it (user feedback 0.13.0). */
  setLevelWallHeight: (id: LevelId, height: number) => void
  deleteLevel: (id: LevelId) => boolean
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
        /**
         * Run an ENTITY mutation against the ACTIVE level (v7 seam): the
         * mutation receives a throwaway LevelDoc whose maps alias the
         * draft's level + assets/settings — writes go through the immer
         * proxies, so one committed mutation still yields one new doc
         * identity. Every entity action funnels through here; a mutation
         * physically cannot touch doc-scoped fields (they are absent from
         * LevelDoc).
         */
        function mutate<R>(fn: (doc: LevelDoc) => R): R {
          let result!: R
          set((s) => {
            const activeId = useActiveLevel.getState().activeLevelId
            const level =
              (activeId && s.doc.levels.find((l) => l.id === activeId)) || s.doc.levels[0]!
            result = fn(makeLevelDoc(s.doc, level))
          })
          return result
        }
        /** Doc-scoped mutations (name/settings/preview/notes/levels). */
        function mutateDoc<R>(fn: (doc: ProjectDocument) => R): R {
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
          rehomeOpening: (id, wallId, t, opts) => mutate((d) => openings.rehomeOpening(d, id, wallId, t, opts)),
          addFurniture: (params) => mutate((d) => furniture.addFurniture(d, params)),
          addFurnitureBatch: (items) => mutate((d) => furniture.addFurnitureBatch(d, items)),
          transformFurniture: (id, patch, opts) => mutate((d) => furniture.transformFurniture(d, id, patch, opts)),
          resizeFurniture: (id, size) => mutate((d) => furniture.resizeFurniture(d, id, size)),
          renameFurniture: (id, name) => mutate((d) => furniture.renameFurniture(d, id, name)),
          setFurnitureImage: (id, content) =>
            mutate((d) =>
              furniture.setFurnitureAsset(d, id, content ? assets.addAsset(d, content) : undefined),
            ),
          setPreviewImage: (content) => mutateDoc((d) => assets.setPreviewImage(d, content)),
          attachFurniture: (id, openingId, ref) =>
            mutate((d) => attachment.attachFurnitureToOpening(d, id, openingId, ref)),
          detachFurniture: (id) => mutate((d) => attachment.detachFurniture(d, id)),
          setMaterialOverride: (id, slot, value) =>
            mutate((d) => furniture.setMaterialOverride(d, id, slot, value)),
          setFurnitureMeta: (id, patch) => mutate((d) => furniture.setFurnitureMeta(d, id, patch)),
          setFurnitureLight: (id, patch) => mutate((d) => furniture.setFurnitureLight(d, id, patch)),
          duplicateFurniture: (ids) => mutate((d) => furniture.duplicateFurniture(d, ids)),
          alignFurniture: (ids, edge) => mutate((d) => furniture.alignFurniture(d, ids, edge)),
          distributeFurniture: (ids, axis) => mutate((d) => furniture.distributeFurniture(d, ids, axis)),
          pasteSubgraph: (payload, target) => mutate((d) => paste.pasteSubgraph(d, payload, target)),
          tearRoomRig: (rig) => mutate((d) => roomRig.tearRoomRig(d, rig)),
          transformRoomRig: (rig, starts, xform, opts) =>
            mutate((d) => roomRig.transformRigRigid(d, rig, starts, xform, opts)),
          addDimension: (a, b, offset) => mutate((d) => annotations.addDimension(d, a, b, offset)),
          addLabel: (pos, text) => mutate((d) => annotations.addLabel(d, pos, text)),
          addArea: (points) => mutate((d) => annotations.addArea(d, points)),
          updateAnnotation: (id, patch) => mutate((d) => annotations.updateAnnotation(d, id, patch)),
          renameRoom: (id, name) => mutate((d) => rooms.renameRoom(d, id, name)),
          setRoomFloorMaterial: (id, mat) => mutate((d) => rooms.setRoomFloorMaterial(d, id, mat)),
          setRoomFloorElevation: (id, fe) => mutate((d) => rooms.setRoomFloorElevation(d, id, fe)),
          setRoomType: (id, roomType) => mutate((d) => rooms.setRoomType(d, id, roomType)),
          paintRoomWalls: (id, paintId) => mutate((d) => rooms.paintRoomWalls(d, id, paintId)),
          renameProject: (name) => mutateDoc((d) => project.renameProject(d, name)),
          updateSettings: (patch) => mutateDoc((d) => project.updateSettings(d, patch)),
          setNotes: (notes) => mutateDoc((d) => project.setNotes(d, notes)),
          addLevel: () => mutateDoc((d) => levelOps.addLevel(d)),
          duplicateLevel: (id) => mutateDoc((d) => levelOps.duplicateLevel(d, id)),
          renameLevel: (id, name) => mutateDoc((d) => levelOps.renameLevel(d, id, name)),
          moveLevel: (id, delta) => mutateDoc((d) => levelOps.moveLevel(d, id, delta)),
          setLevelWallHeight: (id, h) => mutateDoc((d) => levelOps.setLevelWallHeight(d, id, h)),
          deleteLevel: (id) => mutateDoc((d) => levelOps.deleteLevel(d, id)),
          newDocument: (name = 'Untitled') => {
            useActiveLevel.getState().setActiveLevel(null)
            set((s) => {
              s.doc = emptyDocument(newProjectId(), name, new Date().toISOString())
            })
          },
          replaceDocument: (doc) => {
            useActiveLevel.getState().setActiveLevel(null)
            set((s) => {
              s.doc = doc
            })
          },
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
