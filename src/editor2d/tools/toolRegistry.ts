import type { Tool, ToolContext, ToolId } from './toolTypes'
import { createSelectTool } from './selectTool'
import { createDrawWallTool } from './drawWallTool'
import { createPlaceOpeningTool } from './placeOpeningTool'
import { createPlaceFurnitureTool } from './placeFurnitureTool'
import { createMeasureTool } from './measureTool'
import { createAnnotateTextTool } from './annotateTextTool'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { useInteractionStore } from '../session/interactionStore'
import { useViewportStore } from '../viewport/viewportStore'
import { getDerived } from '../../store/derived'

/** Tool instances are singletons; switching deactivates the outgoing tool. */
export function createToolRegistry() {
  const tools = new Map<ToolId, Tool>()
  tools.set('select', createSelectTool())
  tools.set('draw-wall', createDrawWallTool())
  tools.set('place-opening', createPlaceOpeningTool())
  tools.set('place-furniture', createPlaceFurnitureTool())
  tools.set('measure', createMeasureTool())
  tools.set('annotate-text', createAnnotateTextTool())

  return {
    get(id: ToolId): Tool {
      return tools.get(id) ?? tools.get('select')!
    },
    switchTo(ctx: ToolContext, id: ToolId): void {
      const ui = ctx.ui()
      if (ui.activeTool === id) return
      tools.get(ui.activeTool)?.onDeactivate(ctx)
      ui.setActiveTool(tools.has(id) ? id : 'select')
    },
  }
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>

/**
 * THE app registry + context (Editor2D, keymap, and toolbar all share them).
 * Every accessor reads module-level stores, so nothing here is
 * component-scoped.
 */
export const toolContext: ToolContext = {
  doc: () => useDocStore.getState().doc,
  derived: () => getDerived(useDocStore.getState().doc),
  actions: () => useDocStore.getState(),
  ui: () => useUiStore.getState(),
  interaction: () => useInteractionStore.getState(),
  pxToWorld: () => 1 / useViewportStore.getState().k,
}

export const toolRegistry = createToolRegistry()

/**
 * THE tool-switch entry point for UI chrome and hotkeys. Tool switches must
 * never call ui.setActiveTool directly: only switching on the shared
 * registry runs the outgoing tool's onDeactivate against the instance that
 * actually holds its gesture state (previews, pending anchors, pills).
 */
export function switchTool(id: ToolId): void {
  toolRegistry.switchTo(toolContext, id)
}
