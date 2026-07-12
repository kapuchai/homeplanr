import { beforeEach, describe, expect, it } from 'vitest'
import { useConfirmStore } from './confirmStore'

/**
 * FIFO prompt queue (0.3.0 R1b): a prompt arriving while another is visible
 * must WAIT — the old policy force-resolved the visible prompt as its last
 * button, silently answering questions the user never saw (Discard, for the
 * recovery prompt).
 */
beforeEach(() => {
  useConfirmStore.setState({ pending: null, queue: [] })
})

describe('confirm prompt queue', () => {
  it('a second prompt queues; both settle in FIFO order with their own answers', async () => {
    const s = useConfirmStore.getState()
    const p1 = s.prompt('One', '', [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ])
    const p2 = s.prompt('Two', '', [{ label: 'C', value: 'c' }])
    expect(useConfirmStore.getState().pending?.title).toBe('One')
    expect(useConfirmStore.getState().queue).toHaveLength(1)
    useConfirmStore.getState().resolve('a')
    expect(await p1).toBe('a')
    expect(useConfirmStore.getState().pending?.title).toBe('Two')
    useConfirmStore.getState().resolve('c')
    expect(await p2).toBe('c')
    expect(useConfirmStore.getState().pending).toBeNull()
    expect(useConfirmStore.getState().queue).toHaveLength(0)
  })

  it('escValue defaults to the last button; an explicit escValue overrides it', () => {
    const s = useConfirmStore.getState()
    void s.prompt('Guard', '', [
      { label: 'Save', value: 'save' },
      { label: 'Cancel', value: 'cancel' },
    ])
    expect(useConfirmStore.getState().pending?.escValue).toBe('cancel')
    useConfirmStore.getState().resolve('cancel')
    void s.prompt(
      'Restore?',
      '',
      [
        { label: 'Restore', value: 'restore' },
        { label: 'Discard', value: 'discard' },
      ],
      { escValue: 'dismiss' },
    )
    expect(useConfirmStore.getState().pending?.escValue).toBe('dismiss')
    useConfirmStore.getState().resolve('dismiss')
  })

  it('resolve with nothing pending is a no-op', () => {
    useConfirmStore.getState().resolve('x') // must not throw or corrupt state
    expect(useConfirmStore.getState().pending).toBeNull()
  })

  it('a prompt fired from a resolution continuation queues behind the promoted head', async () => {
    const s = useConfirmStore.getState()
    const order: string[] = []
    const p1 = s.prompt('One', '', [{ label: 'A', value: 'a' }]).then((v) => {
      order.push(`one:${v}`)
      // continuation immediately asks again — must queue behind 'Two'
      return s.prompt('Three', '', [{ label: 'E', value: 'e' }]).then((v3) => {
        order.push(`three:${v3}`)
      })
    })
    const p2 = s.prompt('Two', '', [{ label: 'D', value: 'd' }]).then((v) => {
      order.push(`two:${v}`)
    })
    useConfirmStore.getState().resolve('a')
    await Promise.resolve() // let the continuation enqueue 'Three'
    expect(useConfirmStore.getState().pending?.title).toBe('Two')
    useConfirmStore.getState().resolve('d')
    await Promise.resolve()
    expect(useConfirmStore.getState().pending?.title).toBe('Three')
    useConfirmStore.getState().resolve('e')
    await Promise.all([p1, p2])
    expect(order).toEqual(['one:a', 'two:d', 'three:e'])
  })
})
