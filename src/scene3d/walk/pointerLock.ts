/**
 * Pointer Lock capability probe + session verdict (0.11.0).
 *
 * Walk mode looks with Pointer Lock: entering walk requests the lock from
 * the Walk-button gesture so the cursor vanishes at once (WebKitGTK grants
 * it only from inside a user-activation handler — see PlannerCanvas). The
 * ONE failure that must be remembered is a lock that ENGAGES with dead
 * movement plumbing (the pointer held hostage with no way to look): two
 * shapes — move events that flow with zero deltas (the zero-delta streak
 * below) and no move events at all (WalkControls' deadman timer releases
 * an unproven lock silent for LOCK_DEADMAN_MS via markLockDead). A broken
 * verdict falls back to the invisible capture-drag path so look never
 * dies entirely. The verdict is module-scoped for the session and never
 * persisted: a driver or compositor change across launches may fix it.
 */
export type LockVerdict = 'unknown' | 'ok' | 'broken'

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
 * Fire a lock request unless the session already proved lock broken.
 * Rejections and silent no-ops are swallowed — the capture-drag fallback
 * is always armed, and pointerlockchange is the only success signal
 * anyone listens to.
 */
export function attemptLock(el: Element): void {
  if (verdict === 'broken') return
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
