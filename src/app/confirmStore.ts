import { create } from 'zustand'

/**
 * In-app modal prompt (plugin-dialog maxes out at two buttons — the
 * Save/Discard/Cancel guard needs three). Prompts QUEUE in FIFO order: a
 * prompt arriving while another is visible waits its turn — the old policy
 * force-resolved the visible one as its last button, silently answering a
 * question the user never saw (for the recovery prompt that answer was
 * Discard, i.e. destroying the crash blob).
 *
 * Escape resolves the VISIBLE prompt to its `escValue` — non-destructive by
 * contract. It defaults to the last button (cancel-shaped in every 3-button
 * guard); any prompt whose last button is destructive (Restore/Discard)
 * MUST pass an explicit safe escValue.
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
  escValue: string
  resolve: (value: string) => void
}

interface ConfirmState {
  pending: PendingPrompt | null
  queue: PendingPrompt[]
  prompt: <T extends string>(
    title: string,
    message: string,
    buttons: ConfirmButton<T>[],
    opts?: { escValue?: T },
  ) => Promise<T>
  resolve: (value: string) => void
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  pending: null,
  queue: [],
  prompt: (title, message, buttons, opts) =>
    new Promise((resolve) => {
      const entry: PendingPrompt = {
        title,
        message,
        buttons,
        escValue: opts?.escValue ?? buttons[buttons.length - 1]!.value,
        resolve: resolve as (v: string) => void,
      }
      if (get().pending) set((s) => ({ queue: [...s.queue, entry] }))
      else set({ pending: entry })
    }),
  resolve: (value) => {
    const p = get().pending
    if (!p) return
    const [next, ...rest] = get().queue
    set({ pending: next ?? null, queue: rest })
    p.resolve(value)
  },
}))

// Dev-only HMR guard (0.13.0 session lesson): this module holds LIVE STATE.
// Hot-swapping it creates a SECOND instance while older importers keep the
// first — clicks write to one store, renderers read another ("switching
// does nothing" in a long dev session). Decline HMR: edits here always
// full-reload the page. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate())
}
