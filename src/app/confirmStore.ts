import { create } from 'zustand'

/**
 * In-app modal prompt (plugin-dialog maxes out at two buttons — the
 * Save/Discard/Cancel guard needs three). One pending prompt at a time;
 * ConfirmDialog renders it, resolve() settles the awaiting promise.
 */
export interface ConfirmButton<T extends string = string> {
  label: string
  value: T
  variant?: 'primary' | 'danger' | 'plain'
}

interface PendingPrompt {
  title: string
  message: string
  buttons: ConfirmButton[]
  resolve: (value: string) => void
}

interface ConfirmState {
  pending: PendingPrompt | null
  prompt: <T extends string>(
    title: string,
    message: string,
    buttons: ConfirmButton<T>[],
  ) => Promise<T>
  resolve: (value: string) => void
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  pending: null,
  prompt: (title, message, buttons) =>
    new Promise((resolve) => {
      // settle any orphaned prompt as its last (cancel-ish) button
      const prev = get().pending
      if (prev) prev.resolve(prev.buttons[prev.buttons.length - 1]!.value)
      set({
        pending: { title, message, buttons, resolve: resolve as (v: string) => void },
      })
    }),
  resolve: (value) => {
    const p = get().pending
    set({ pending: null })
    p?.resolve(value)
  },
}))
