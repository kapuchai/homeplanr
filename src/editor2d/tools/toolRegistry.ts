import type { Tool, ToolContext, ToolId } from './toolTypes'
import { createSelectTool } from './selectTool'
import { createDrawWallTool } from './drawWallTool'

/** Tool instances are singletons; switching deactivates the outgoing tool. */
export function createToolRegistry() {
  const tools = new Map<ToolId, Tool>()
  tools.set('select', createSelectTool())
  tools.set('draw-wall', createDrawWallTool())
  // place-opening / place-furniture land in M3b

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
