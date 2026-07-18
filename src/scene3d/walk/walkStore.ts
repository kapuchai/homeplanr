import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Vec2 } from '../../geometry/vec'

/**
 * Walk-mode session state — never undoable, never persisted. The state
 * machine is off → walking: the Walk button enters directly at a default
 * spot (0.11.0 — no floor pick) via enterWalk; clicks while walking queue
 * a teleport target (the capture-drag fallback only — under Pointer Lock
 * there is no cursor). WalkControls (inside the Canvas) owns the camera
 * choreography: it consumes pendingTarget per frame and answers exit
 * requests with the glide back to the orbit pose, resetting the store via
 * the underscored internals when it lands.
 */
export type WalkMode = 'off' | 'walking'

export interface WalkState {
  mode: WalkMode
  /** Validated plan-space point queued for enter/teleport. */
  pendingTarget: Vec2 | null
  /** Transient overlay message (e.g. rejected teleport). */
  hint: string | null
  /** Bumped by exit() while walking — WalkControls glides out, then resets. */
  exitSeq: number
  /** Pointer Lock currently engaged (0.11.0 FPS look). Set by WalkControls
   * from pointerlockchange; read by the hint line and the teleport gate
   * (no cursor under lock — floor clicks must not teleport). */
  locked: boolean
  /** Enter walk mode straight from the Walk button at a default spot
   * (0.11.0 — no floor pick): off → walking, WalkControls glides in and
   * the button's gesture requests Pointer Lock. */
  enterWalk: (p: Vec2) => void
  /** Teleport to p while walking (the capture-drag fallback's floor
   * click — a no-op unless already walking). */
  requestWalkTo: (p: Vec2) => void
  /** Leave walk mode: asks WalkControls to glide back to the orbit pose. */
  exit: () => void
  setHint: (hint: string | null) => void
  _setMode: (mode: WalkMode) => void
  _setLocked: (locked: boolean) => void
  _consumeTarget: () => Vec2 | null
}

export const useWalkStore = create<WalkState>()(
  subscribeWithSelector((set, get) => ({
    mode: 'off',
    pendingTarget: null,
    hint: null,
    exitSeq: 0,
    locked: false,
    enterWalk: (p) => set({ mode: 'walking', pendingTarget: p, hint: null }),
    requestWalkTo: (p) => {
      if (get().mode !== 'walking') return
      set({ pendingTarget: p, hint: null })
    },
    exit: () => {
      if (get().mode === 'walking') set((s) => ({ exitSeq: s.exitSeq + 1 }))
    },
    setHint: (hint) => set({ hint }),
    _setMode: (mode) => set({ mode }),
    _setLocked: (locked) => set({ locked }),
    _consumeTarget: () => {
      const t = get().pendingTarget
      if (t) set({ pendingTarget: null })
      return t
    },
  })),
)

// Dev-only HMR guard (0.13.0 session lesson): this module holds LIVE STATE.
// Hot-swapping it creates a SECOND instance while older importers keep the
// first — clicks write to one store, renderers read another ("switching
// does nothing" in a long dev session). Decline HMR: edits here always
// full-reload the page. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate())
}
