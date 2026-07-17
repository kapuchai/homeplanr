import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ZERO_DELTA_LIMIT,
  _resetLockVerdictForTests,
  attemptLock,
  lockVerdict,
  markLockDead,
  noteLockedMove,
  resetLockProbe,
} from './pointerLock'

const fakeEl = (impl?: () => unknown) => {
  const spy = vi.fn(impl ?? (() => undefined))
  return { el: { requestPointerLock: spy } as unknown as Element, spy }
}

beforeEach(() => _resetLockVerdictForTests())

describe('lock verdict probe', () => {
  it('starts unknown', () => {
    expect(lockVerdict()).toBe('unknown')
  })

  it('one nonzero locked move proves the plumbing (verdict ok)', () => {
    expect(noteLockedMove(3, 0)).toBe('ok')
    expect(lockVerdict()).toBe('ok')
  })

  it('a stream of zero-delta locked moves marks broken at the limit', () => {
    for (let i = 0; i < ZERO_DELTA_LIMIT - 1; i++) {
      expect(noteLockedMove(0, 0)).toBe('pending')
    }
    expect(noteLockedMove(0, 0)).toBe('broken')
    expect(lockVerdict()).toBe('broken')
  })

  it('a nonzero move resets the zero streak', () => {
    for (let i = 0; i < ZERO_DELTA_LIMIT - 1; i++) noteLockedMove(0, 0)
    noteLockedMove(0, 2)
    for (let i = 0; i < ZERO_DELTA_LIMIT - 1; i++) {
      expect(noteLockedMove(0, 0)).toBe('pending')
    }
    expect(lockVerdict()).toBe('ok') // the nonzero verdict sticks
  })

  it('resetLockProbe restarts the streak without touching the verdict', () => {
    for (let i = 0; i < ZERO_DELTA_LIMIT - 1; i++) noteLockedMove(0, 0)
    resetLockProbe()
    expect(noteLockedMove(0, 0)).toBe('pending')
    expect(lockVerdict()).toBe('unknown')
  })

  it('markLockDead (deadman: locked but zero events) marks broken', () => {
    markLockDead()
    expect(lockVerdict()).toBe('broken')
    const { el, spy } = fakeEl()
    attemptLock(el)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('attemptLock', () => {
  it('requests while the verdict is not broken', () => {
    const { el, spy } = fakeEl()
    attemptLock(el)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('stops requesting after a broken verdict (drag fallback takes over)', () => {
    for (let i = 0; i < ZERO_DELTA_LIMIT; i++) noteLockedMove(0, 0)
    const { el, spy } = fakeEl()
    attemptLock(el)
    expect(spy).not.toHaveBeenCalled()
  })

  it('swallows a throwing implementation', () => {
    const { el } = fakeEl(() => {
      throw new Error('NotSupportedError')
    })
    expect(() => attemptLock(el)).not.toThrow()
  })

  it('swallows a rejecting promise implementation', async () => {
    const { el } = fakeEl(() => Promise.reject(new Error('NotAllowedError')))
    attemptLock(el)
    await new Promise((r) => setTimeout(r, 0)) // an unhandled rejection would fail the run
  })

  it('ignores elements without the API', () => {
    expect(() => attemptLock({} as Element)).not.toThrow()
  })
})
