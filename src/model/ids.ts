import { nanoid } from 'nanoid'

/**
 * Branded entity IDs. The brand is purely compile-time: it prevents passing
 * a WallId where a NodeId is expected. Runtime values are prefixed nanoids
 * (`n_V1StGXR8_Z`) so raw documents stay debuggable.
 */
declare const brand: unique symbol
type Id<B extends string> = string & { readonly [brand]: B }

export type NodeId = Id<'node'>
export type WallId = Id<'wall'>
export type OpeningId = Id<'opening'>
export type RoomId = Id<'room'>
export type FurnitureId = Id<'furniture'>
export type AnnotationId = Id<'annotation'>
export type AssetId = Id<'asset'>

const id = (prefix: string) => `${prefix}_${nanoid(10)}`

export const newNodeId = (): NodeId => id('n') as NodeId
export const newWallId = (): WallId => id('w') as WallId
export const newOpeningId = (): OpeningId => id('o') as OpeningId
export const newRoomId = (): RoomId => id('r') as RoomId
export const newFurnitureId = (): FurnitureId => id('f') as FurnitureId
export const newAnnotationId = (): AnnotationId => id('a') as AnnotationId
export const newAssetId = (): AssetId => id('i') as AssetId
export const newProjectId = (): string => id('p')

/** Cast helpers for validated/parsed input (validator's responsibility). */
export const asNodeId = (s: string): NodeId => s as NodeId
export const asWallId = (s: string): WallId => s as WallId
export const asOpeningId = (s: string): OpeningId => s as OpeningId
export const asRoomId = (s: string): RoomId => s as RoomId
export const asFurnitureId = (s: string): FurnitureId => s as FurnitureId
export const asAnnotationId = (s: string): AnnotationId => s as AnnotationId
export const asAssetId = (s: string): AssetId => s as AssetId
