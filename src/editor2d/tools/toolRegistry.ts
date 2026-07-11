import type { Tool, ToolContext, ToolId } from './toolTypes'
import { createSelectTool } from './selectTool'
import { createDrawWallTool } from './drawWallTool'
import { createPlaceOpeningTool } from './placeOpeningTool'
import { createPlaceFurnitureTool } from './placeFurnitureTool'

/** Tool instances are singletons; switching deactivates the outgoing tool. */
export function createToolRegistry() {
  const tools = new Map<ToolId, Tool>()
  tools.set('select', createSelectTool())
  tools.set('draw-wall', createDrawWallTool())
  tools.set('place-opening', createPlaceOpeningTool())
  tools.set('place-furniture', createPlaceFurnitureTool())

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
