/**
 * Pointer Lock capability probe + session verdict (0.11.0 M1).
 *
 * WebKitGTK support is historically shaky, so lock is opportunistic: an
 * attempt is one cheap API call made while capture-drag is ALREADY armed,
 * and every failure path lands back on drag with no UX cliff. Requests
 * that never resolve or fire pointerlockerror simply leave drag in
 * charge — the one failure that must be remembered is a lock that
 * ENGAGES with dead movement plumbing (the pointer would be held
 * hostage with no way to look). That comes in two shapes: move events
 * that flow with zero deltas (the zero-delta streak below), and no move
 * events at all (WalkControls' deadman timer — an unproven lock that
 * stays silent for LOCK_DEADMAN_MS is released via markLockDead). The
 * verdict is module-scoped for the session and never persisted: a
 * driver or compositor change across launches may fix it.
 */
export type LockVerdict = 'unknown' | 'ok' | 'broken'

export type LookMode = 'auto' | 'lock' | 'drag'

/** Consecutive locked pointermoves with zero deltas before declaring the
 * movement plumbing broken. A stationary mouse emits no move events at
 * all, so a real zero-delta STREAM only comes from an implementation
 * that locks the pointer without reporting deltas. */
export const ZERO_DELTA_LIMIT = 8

/** How long an UNPROVEN lock (verdict not yet 'ok') may stay engaged
 * without a single move event before it is declared dead and released.
 * A user fresh off the entering click virtually always jiggles the mouse
 * within this window; the false-positive cost is a quiet demotion to
 * capture-drag, the true-positive win is escaping a hostage lock. */
export const LOCK_DEADMAN_MS = 3000

let verdict: LockVerdict = 'unknown'
let zeroStreak = 0

export function lockVerdict(): LockVerdict {
  return verdict
}

/** New lock engagement (or release): the zero-delta streak starts over. */
export function resetLockProbe(): void {
  zeroStreak = 0
}

/**
 * Bookkeep one pointermove received WHILE locked. 'broken' tells the
 * caller to unlock and stay on capture-drag for the session; 'pending'
 * deltas still apply (they are zero — harmless).
 */
export function noteLockedMove(dx: number, dy: number): 'ok' | 'broken' | 'pending' {
  if (dx !== 0 || dy !== 0) {
    verdict = 'ok'
    zeroStreak = 0
    return 'ok'
  }
  zeroStreak += 1
  if (zeroStreak >= ZERO_DELTA_LIMIT) {
    verdict = 'broken'
    return 'broken'
  }
  return 'pending'
}

/** Deadman verdict: a lock engaged but never produced a move event. */
export function markLockDead(): void {
  verdict = 'broken'
}

/**
 * Fire a lock request if the mode and verdict allow one. Rejections and
 * silent no-ops are swallowed — capture-drag is already running, and
 * pointerlockchange is the only success signal anyone listens to.
 * 'lock' retries even a broken verdict (explicit user override).
 */
export function attemptLock(el: Element, mode: LookMode): void {
  if (mode === 'drag') return
  if (mode === 'auto' && verdict === 'broken') return
  if (typeof el.requestPointerLock !== 'function') return
  try {
    // older implementations return void, newer a Promise — absorb both
    const ret = el.requestPointerLock() as unknown
    void Promise.resolve(ret).catch(() => {})
  } catch {
    /* NotSupportedError etc. — drag stays in charge */
  }
}

/** Test seam: reset the module verdict between cases. */
export function _resetLockVerdictForTests(): void {
  verdict = 'unknown'
  zeroStreak = 0
}
