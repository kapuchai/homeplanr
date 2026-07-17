import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Vec2 } from '../../geometry/vec'

/**
 * Walk-mode session state — never undoable, never persisted. The state
 * machine is off → arming (Walk button) → walking (first floor click);
 * clicks while walking queue a teleport target. WalkControls (inside the
 * Canvas) owns the camera choreography: it consumes pendingTarget per
 * frame and answers exit requests with the glide back to the orbit pose,
 * resetting the store via the underscored internals when it lands.
 */
export type WalkMode = 'off' | 'arming' | 'walking'

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
  arm: () => void
  disarm: () => void
  /** arming → enter walk mode at p; walking → teleport to p. */
  requestWalkTo: (p: Vec2) => void
  /** Leave walk mode: arming resets here; walking asks WalkControls to glide out. */
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
    arm: () => set({ mode: 'arming', hint: null }),
    disarm: () => set({ mode: 'off', pendingTarget: null, hint: null }),
    requestWalkTo: (p) => {
      const { mode } = get()
      if (mode === 'off') return
      if (mode === 'arming') set({ mode: 'walking', pendingTarget: p, hint: null })
      else set({ pendingTarget: p, hint: null })
    },
    exit: () => {
      const { mode } = get()
      if (mode === 'arming') get().disarm()
      else if (mode === 'walking') set((s) => ({ exitSeq: s.exitSeq + 1 }))
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
