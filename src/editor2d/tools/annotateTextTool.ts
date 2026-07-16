import type { Tool } from './toolTypes'
import { useAppSettings } from '../../store/appSettings'

/**
 * Text label tool (v3, 'T'): each click drops a label with placeholder text
 * and selects it — the properties panel autofocuses the text field for a
 * fresh label, so click → type is the whole flow. Stays armed for more
 * labels; Esc/V exits via the keymap ladder. Never opens a transaction
 * (addLabel is a single recorded mutation = one undo entry).
 */
export const LABEL_PLACEHOLDER = 'Text'

export function createAnnotateTextTool(): Tool {
  return {
    id: 'annotate-text',
    cursor: () => 'text',

    onPointerMove() {},

    onPointerDown(e, ctx) {
      if (e.button !== 0) return
      const id = ctx.actions().addLabel(e.world, LABEL_PLACEHOLDER)
      if (id) {
        ctx.ui().setSelection([id])
        // a label dropped into a hidden layer would vanish silently —
        // creating an annotation re-enables visibility (0.7.0)
        const settings = useAppSettings.getState()
        if (!settings.showAnnotations) settings.setShowAnnotations(true)
      }
    },

    onPointerUp() {},

    onKeyDown() {
      return false // Esc bubbles: the keymap ladder switches back to select
    },

    onDeactivate(ctx) {
      ctx.interaction().clear()
    },
  }
}
