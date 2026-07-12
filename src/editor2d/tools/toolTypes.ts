import type { Vec2 } from '../../geometry/vec'
import type { ProjectDocument } from '../../model/types'
import type { DerivedGeometry } from '../../store/derived'
import type { DocState } from '../../store/docStore'
import type { UiState } from '../../store/uiStore'
import type { InteractionState } from '../session/interactionStore'

/**
 * Tools are plain TS state machines — no React, no DOM. They receive
 * normalized pointer/key events plus a context of live store accessors,
 * and are unit-testable with scripted event sequences.
 */
export interface EditorPointerEvent {
  world: Vec2
  screen: Vec2
  mods: { shift: boolean; ctrl: boolean; alt: boolean }
  button: number
  pointerId: number
}

export interface ToolContext {
  doc: () => ProjectDocument
  derived: () => DerivedGeometry
  actions: () => DocState
  ui: () => UiState
  interaction: () => InteractionState
  /** meters per screen px at current zoom. */
  pxToWorld: () => number
}

export type ToolId = 'select' | 'draw-wall' | 'place-opening' | 'place-furniture' | 'measure'

export interface Tool {
  id: ToolId
  cursor: (ctx: ToolContext) => string
  onPointerDown: (e: EditorPointerEvent, ctx: ToolContext) => void
  onPointerMove: (e: EditorPointerEvent, ctx: ToolContext) => void
  onPointerUp: (e: EditorPointerEvent, ctx: ToolContext) => void
  /** Double-click (select: numeric edit focus M3b; draw-wall: end chain). */
  onDoubleClick?: (e: EditorPointerEvent, ctx: ToolContext) => void
  /** Return true when the key was handled. */
  onKeyDown?: (key: string, ctx: ToolContext) => boolean
  /** Cancel semantics: called on tool switch; MUST abort open gestures. */
  onDeactivate: (ctx: ToolContext) => void
}
