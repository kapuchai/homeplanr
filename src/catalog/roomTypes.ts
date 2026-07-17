/**
 * Room type registry (0.8.0) — Room.roomType references these ids (field
 * shipped schema-only in v4). OPEN registry: unknown ids in documents are
 * preserved and simply render no badge. Display names are raw strings by
 * the catalog convention (rendered plan content, shared with the i18n-free
 * SVG exporter — not chrome).
 *
 * `suggestedFloorId` seeds the floor material when a type is set on a room
 * whose floor was never explicitly chosen — it must never overwrite a user
 * choice (setRoomType enforces this).
 */
export interface RoomTypeSpec {
  id: string
  name: string
  suggestedFloorId?: string
}

export const ROOM_TYPES: readonly RoomTypeSpec[] = [
  { id: 'living', name: 'Living room', suggestedFloorId: 'woodFloor' },
  { id: 'bedroom', name: 'Bedroom', suggestedFloorId: 'carpetFloor' },
  { id: 'kids', name: 'Kids room', suggestedFloorId: 'carpetFloor' },
  { id: 'kitchen', name: 'Kitchen', suggestedFloorId: 'tileGray' },
  { id: 'dining', name: 'Dining room', suggestedFloorId: 'woodFloor' },
  { id: 'bathroom', name: 'Bathroom', suggestedFloorId: 'ceramicFloor' },
  { id: 'wc', name: 'WC', suggestedFloorId: 'ceramicFloor' },
  { id: 'hallway', name: 'Hallway', suggestedFloorId: 'laminateGray' },
  { id: 'office', name: 'Office', suggestedFloorId: 'laminateOak' },
  { id: 'balcony', name: 'Balcony', suggestedFloorId: 'concrete' },
  { id: 'storage', name: 'Storage', suggestedFloorId: 'concrete' },
  { id: 'laundry', name: 'Laundry', suggestedFloorId: 'tileGray' },
]

export const ROOM_TYPE_IDS: ReadonlySet<string> = new Set(ROOM_TYPES.map((r) => r.id))

/** Known id → spec; unknown/absent → null (no badge, no suggestion). */
export function roomTypeSpec(id: string | undefined): RoomTypeSpec | null {
  return (id !== undefined && ROOM_TYPES.find((r) => r.id === id)) || null
}
