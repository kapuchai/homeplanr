import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocStore } from '../docStore'
import { useConfirmStore } from '../../app/confirmStore'
import { beginTx, clearHistory, commitTx, isTxActive } from '../transactions'
import { emptyDocument } from '../../model/types'
import { newProjectId } from '../../model/ids'
import type { StorageAdapter } from './adapter'
import { guardDirty, offerRecovery, openPath, openRecent, saveProject, scheduleFileAutosave, usePersistStore } from './controller'
import { decideLaunchIntent, RECOVERY_KEY } from './recovery'
import { serializeDocument } from './serialize'

// unit env is node — back localStorage (recents + recovery blob) with a Map
const backing = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: () => null,
    get length() {
      return backing.size
    },
  },
})

const blob = (filePath: string | null, savedAt: number) => ({
  v: 1 as const,
  filePath,
  docId: 'p_x',
  savedAt,
  doc: emptyDocument('p_x', 'X', '2026-07-11T00:00:00.000Z'),
})

describe('launch intent decisions (argv vs recovery blob)', () => {
  it('no argv → default chain, with or without a blob', () => {
    expect(decideLaunchIntent({ argvPath: null, blob: null, fileMtimeMs: null })).toEqual({
      kind: 'default-chain',
    })
    expect(
      decideLaunchIntent({ argvPath: null, blob: blob('/a.homeplanr', 2000), fileMtimeMs: 1000 }),
    ).toEqual({ kind: 'default-chain' })
  })

  it('argv wins with no blob', () => {
    expect(
      decideLaunchIntent({ argvPath: '/b.homeplanr', blob: null, fileMtimeMs: null }),
    ).toEqual({ kind: 'open-argv' })
  })

  // 0.3.0 rewrite: ANY offerable blob prompts before an argv open — the old
  // "open argv now, preserve the unrelated blob" policy let the first edit's
  // autosave destroy the preserved blob (single recovery slot)
  it('argv with any OFFERABLE blob prompts recovery first', () => {
    expect(
      decideLaunchIntent({
        argvPath: '/b.homeplanr',
        blob: blob('/a.homeplanr', 2000), // unrelated file, newer than disk
        fileMtimeMs: 1000,
      }),
    ).toEqual({ kind: 'restore-prompt-then-argv' })
    expect(
      decideLaunchIntent({ argvPath: '/b.homeplanr', blob: blob(null, 2000), fileMtimeMs: null }),
    ).toEqual({ kind: 'restore-prompt-then-argv' })
    expect(
      decideLaunchIntent({
        argvPath: '/a.homeplanr',
        blob: blob('/a.homeplanr', 2000), // the argv file's own shadow
        fileMtimeMs: 1000,
      }),
    ).toEqual({ kind: 'restore-prompt-then-argv' })
  })

  it('a STALE blob never blocks the argv open', () => {
    expect(
      decideLaunchIntent({
        argvPath: '/a.homeplanr',
        blob: blob('/a.homeplanr', 1000), // file on disk is newer
        fileMtimeMs: 2000,
      }),
    ).toEqual({ kind: 'open-argv' })
  })
})

describe('openPath recovery preservation (applyOpened)', () => {
  const files: Record<string, string> = {
    '/a.homeplanr': serializeDocument(emptyDocument('p_file', 'FromDisk', '2026-07-11T00:00:00.000Z')),
  }
  const adapter: StorageAdapter = {
    kind: 'tauri',
    async openImageDialog() {
      return null
    },
    async openDialog() {
      return null
    },
    async readPath(path) {
      const json = files[path]
      if (json === undefined) throw new Error('missing')
      return json
    },
    async saveAsDialog() {
      return null
    },
    async saveBinaryDialog() {
      return null
    },
    setTitle() {},
    installCloseGuard() {},
    async message() {},
  }

  beforeEach(() => {
    backing.clear()
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z'),
    })
    clearHistory()
    usePersistStore.setState({
      adapter,
      currentFilePath: null,
      lastSavedDoc: null,
      dirty: false,
      recents: [],
    })
    localStorage.setItem(RECOVERY_KEY, '{"unrelated":"blob"}')
  })

  it('clears the recovery blob on a normal open (state matrix: Open → recovery×)', async () => {
    expect(await openPath('/a.homeplanr')).toBe(true)
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
    expect(usePersistStore.getState().currentFilePath).toBe('/a.homeplanr')
  })

  it('preserves the blob when asked (argv open over an unrelated crash blob)', async () => {
    expect(await openPath('/a.homeplanr', { preserveRecovery: true })).toBe(true)
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('{"unrelated":"blob"}')
    expect(usePersistStore.getState().currentFilePath).toBe('/a.homeplanr')
  })

  it('open failure reports false and leaves the blob alone', async () => {
    expect(await openPath('/missing.homeplanr')).toBe(false)
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('{"unrelated":"blob"}')
  })
})

describe('save race (S1, 0.3.0): edits during an in-flight save', () => {
  const madeAdapter = (
    savePath: (path: string, json: string) => Promise<string>,
  ): StorageAdapter => ({
    kind: 'tauri',
    async openImageDialog() {
      return null
    },
    async openDialog() {
      return null
    },
    savePath,
    async saveAsDialog() {
      return null
    },
    async saveBinaryDialog() {
      return null
    },
    setTitle() {},
    installCloseGuard() {},
    async message() {},
  })

  beforeEach(() => {
    backing.clear()
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z'),
    })
    clearHistory()
  })

  it('stays dirty and pins lastSavedDoc to the WRITTEN snapshot, not the live doc', async () => {
    let release!: () => void
    let written: string | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    let reachedWrite!: () => void
    const atWrite = new Promise<void>((r) => {
      reachedWrite = r
    })
    usePersistStore.setState({
      adapter: madeAdapter(async (path, json) => {
        written = json
        reachedWrite() // the snapshot is taken by now
        await gate
        return path
      }),
      currentFilePath: '/a.homeplanr',
      lastSavedDoc: null,
      dirty: true,
      recents: [],
    })
    const snapshot = useDocStore.getState().doc
    const saving = saveProject()
    await atWrite // saveProject snapshotted and is inside the write
    // an edit lands while the file write is in flight
    useDocStore.getState().addFurniture({
      catalogItemId: 'test-box',
      x: 1,
      y: 1,
      size: { w: 1, d: 1, h: 1 },
    })
    release()
    expect(await saving).toBe(true)
    // the file holds the pre-edit snapshot…
    expect(written).toContain('"furniture": {}')
    // …and lastSavedDoc matches IT, so the mid-save edit keeps us dirty
    expect(usePersistStore.getState().lastSavedDoc).toBe(snapshot)
    expect(usePersistStore.getState().dirty).toBe(true)
  })

  it('clean save marks clean (control)', async () => {
    usePersistStore.setState({
      adapter: madeAdapter(async (path) => path),
      currentFilePath: '/a.homeplanr',
      lastSavedDoc: null,
      dirty: true,
      recents: [],
    })
    expect(await saveProject()).toBe(true)
    expect(usePersistStore.getState().dirty).toBe(false)
    expect(usePersistStore.getState().lastSavedDoc).toBe(useDocStore.getState().doc)
  })
})

describe('tx-idle wait (R4, 0.3.0)', () => {
  it('openRecent waits for a live tx to end instead of dropping the request', async () => {
    backing.clear()
    const files: Record<string, string> = {
      '/w.homeplanr': serializeDocument(
        emptyDocument('p_w', 'Waited', '2026-07-11T00:00:00.000Z'),
      ),
    }
    let txLiveAtRead: boolean | null = null
    usePersistStore.setState({
      adapter: {
        kind: 'tauri',
        async openImageDialog() {
          return null
        },
        async openDialog() {
          return null
        },
        async readPath(path: string) {
          txLiveAtRead = isTxActive() // the open must run AFTER the commit
          return files[path]!
        },
        async saveAsDialog() {
          return null
        },
        async saveBinaryDialog() {
          return null
        },
        setTitle() {},
        installCloseGuard() {},
        async message() {},
      },
      currentFilePath: null,
      lastSavedDoc: useDocStore.getState().doc, // clean → guardDirty passes
      dirty: false,
      recents: [],
    })
    const tx = beginTx()
    const opening = openRecent('/w.homeplanr')
    setTimeout(() => commitTx(tx), 120)
    await opening
    expect(txLiveAtRead).toBe(false)
    expect(usePersistStore.getState().currentFilePath).toBe('/w.homeplanr')
  })
})

describe('guardDirty re-guards mid-save edits (S1 follow-through)', () => {
  it('a Save that raced an edit prompts AGAIN instead of letting the caller destroy it', async () => {
    backing.clear()
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z'),
    })
    clearHistory()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let reachedWrite!: () => void
    const atWrite = new Promise<void>((r) => {
      reachedWrite = r
    })
    usePersistStore.setState({
      adapter: {
        kind: 'tauri',
        async openImageDialog() {
          return null
        },
        async openDialog() {
          return null
        },
        savePath: async (path: string) => {
          reachedWrite() // snapshot is taken by now — edits after this race
          await gate
          return path
        },
        async saveAsDialog() {
          return null
        },
        async saveBinaryDialog() {
          return null
        },
        setTitle() {},
        installCloseGuard() {},
        async message() {},
      },
      currentFilePath: '/a.homeplanr',
      lastSavedDoc: null, // dirty
      dirty: true,
      recents: [],
    })
    const guarding = guardDirty()
    await Promise.resolve()
    // first prompt: choose Save (write is gated open)
    useConfirmStore.getState().resolve('save')
    await atWrite // saveProject has snapshotted and is inside the write
    // an edit lands while the save is in flight
    useDocStore.getState().addFurniture({
      catalogItemId: 'test-box',
      x: 1,
      y: 1,
      size: { w: 1, d: 1, h: 1 },
    })
    release()
    // the guard must come back with a SECOND prompt for the mid-save edit
    await new Promise((r) => setTimeout(r, 20))
    const second = useConfirmStore.getState().pending
    expect(second?.title).toBe('Unsaved changes')
    useConfirmStore.getState().resolve('discard')
    expect(await guarding).toBe('discard')
  })
})

describe('op serialization (queued guards cannot interleave flows)', () => {
  it('two concurrent opens run strictly one after the other', async () => {
    backing.clear()
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z'),
    })
    clearHistory()
    const order: string[] = []
    const files: Record<string, string> = {
      '/one.homeplanr': serializeDocument(emptyDocument('p_1', 'One', '2026-07-11T00:00:00.000Z')),
      '/two.homeplanr': serializeDocument(emptyDocument('p_2', 'Two', '2026-07-11T00:00:00.000Z')),
    }
    usePersistStore.setState({
      adapter: {
        kind: 'tauri',
        async openImageDialog() {
          return null
        },
        async openDialog() {
          return null
        },
        async readPath(path: string) {
          order.push(`read:${path}`)
          await new Promise((r) => setTimeout(r, 30))
          order.push(`done:${path}`)
          return files[path]!
        },
        async saveAsDialog() {
          return null
        },
        async saveBinaryDialog() {
          return null
        },
        setTitle() {},
        installCloseGuard() {},
        async message() {},
      },
      currentFilePath: null,
      lastSavedDoc: useDocStore.getState().doc,
      dirty: false,
      recents: [],
    })
    await Promise.all([openRecent('/one.homeplanr'), openRecent('/two.homeplanr')])
    // no interleaving: one fully completes before two starts
    expect(order).toEqual([
      'read:/one.homeplanr',
      'done:/one.homeplanr',
      'read:/two.homeplanr',
      'done:/two.homeplanr',
    ])
    expect(usePersistStore.getState().currentFilePath).toBe('/two.homeplanr')
  })
})

describe('recovery prompt Esc = dismiss (R1b, 0.3.0)', () => {
  it('Esc keeps the blob; Discard clears it', async () => {
    backing.clear()
    usePersistStore.setState({
      adapter: {
        kind: 'tauri',
        async openImageDialog() {
          return null
        },
        async openDialog() {
          return null
        },
        async saveAsDialog() {
          return null
        },
        async saveBinaryDialog() {
          return null
        },
        setTitle() {},
        installCloseGuard() {},
        async message() {},
      },
      currentFilePath: null,
      lastSavedDoc: null,
      dirty: false,
      recents: [],
    })
    const b = blob(null, 100)
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(b))
    // Esc → dismissed, blob kept
    const first = offerRecovery(b, null)
    let pending = useConfirmStore.getState().pending!
    expect(pending.escValue).toBe('dismiss')
    useConfirmStore.getState().resolve(pending.escValue)
    expect(await first).toBe('dismissed')
    expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull()
    // explicit Discard → declined, blob cleared
    const second = offerRecovery(b, null)
    pending = useConfirmStore.getState().pending!
    useConfirmStore.getState().resolve('discard')
    expect(await second).toBe('declined')
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
  })
})

describe('autosave-to-file (M8)', () => {
  const writes: string[] = []
  let failNext = false
  const autosaveAdapter = (): StorageAdapter => ({
    kind: 'tauri',
    async openImageDialog() {
      return null
    },
    async openDialog() {
      return null
    },
    savePath: async (path: string) => {
      if (failNext) {
        failNext = false
        throw new Error('disk full')
      }
      writes.push(path)
      return path
    },
    async saveAsDialog() {
      return null
    },
    async saveBinaryDialog() {
      return null
    },
    setTitle() {},
    installCloseGuard() {},
    async message() {
      throw new Error('autosave must NEVER open a dialog')
    },
  })

  beforeEach(async () => {
    const { useAppSettings } = await import('../appSettings')
    useAppSettings.setState({ autosaveEnabled: true })
    writes.length = 0
    failNext = false
    backing.clear()
    useDocStore.setState({
      doc: emptyDocument(newProjectId(), 'test', '2026-07-11T00:00:00.000Z'),
    })
    clearHistory()
    usePersistStore.setState({
      adapter: autosaveAdapter(),
      currentFilePath: '/auto.homeplanr',
      lastSavedDoc: null, // dirty
      dirty: true,
      recents: [],
      lastSavedAt: null,
      autosaveError: false,
    })
  })

  afterEach(async () => {
    const { useAppSettings } = await import('../appSettings')
    useAppSettings.setState({ autosaveEnabled: false })
    vi.useRealTimers()
  })

  it('writes the current path after the debounce and clears dirty', async () => {
    vi.useFakeTimers()
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual(['/auto.homeplanr'])
    expect(usePersistStore.getState().dirty).toBe(false)
    expect(usePersistStore.getState().lastSavedAt).not.toBeNull()
  })

  it('disabled ⇒ zero writes; no path ⇒ silent skip', async () => {
    vi.useFakeTimers()
    const { useAppSettings } = await import('../appSettings')
    useAppSettings.setState({ autosaveEnabled: false })
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual([])
    useAppSettings.setState({ autosaveEnabled: true })
    usePersistStore.setState({ currentFilePath: null })
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual([])
    expect(usePersistStore.getState().autosaveError).toBe(false)
  })

  it('a live transaction defers the write until after the gesture', async () => {
    vi.useFakeTimers()
    const tx = beginTx()
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual([]) // rescheduled, not written mid-gesture
    commitTx(tx)
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual(['/auto.homeplanr'])
  })

  it('failure sets the flag with NO dialog; the next success clears it', async () => {
    vi.useFakeTimers()
    failNext = true
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(usePersistStore.getState().autosaveError).toBe(true)
    expect(usePersistStore.getState().dirty).toBe(true) // nothing lied
    scheduleFileAutosave()
    await vi.advanceTimersByTimeAsync(3000)
    expect(writes).toEqual(['/auto.homeplanr'])
    expect(usePersistStore.getState().autosaveError).toBe(false)
  })
})
