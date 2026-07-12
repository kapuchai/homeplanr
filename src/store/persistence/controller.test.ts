import { beforeEach, describe, expect, it } from 'vitest'
import { useDocStore } from '../docStore'
import { clearHistory } from '../transactions'
import { emptyDocument } from '../../model/types'
import { newProjectId } from '../../model/ids'
import type { StorageAdapter } from './adapter'
import { openPath, usePersistStore } from './controller'
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

  it('argv wins with no blob — nothing to preserve', () => {
    expect(
      decideLaunchIntent({ argvPath: '/b.homeplanr', blob: null, fileMtimeMs: null }),
    ).toEqual({ kind: 'open-argv', preserveRecovery: false })
  })

  it('argv with an unrelated blob opens argv but preserves the blob', () => {
    expect(
      decideLaunchIntent({
        argvPath: '/b.homeplanr',
        blob: blob('/a.homeplanr', 2000),
        fileMtimeMs: 1000,
      }),
    ).toEqual({ kind: 'open-argv', preserveRecovery: true })
    // a never-saved blob is unrelated to any argv path
    expect(
      decideLaunchIntent({ argvPath: '/b.homeplanr', blob: blob(null, 2000), fileMtimeMs: null }),
    ).toEqual({ kind: 'open-argv', preserveRecovery: true })
  })

  it('argv naming the blob’s own file: newer blob prompts, stale blob does not', () => {
    expect(
      decideLaunchIntent({
        argvPath: '/a.homeplanr',
        blob: blob('/a.homeplanr', 2000),
        fileMtimeMs: 1000,
      }),
    ).toEqual({ kind: 'restore-prompt-then-argv' })
    expect(
      decideLaunchIntent({
        argvPath: '/a.homeplanr',
        blob: blob('/a.homeplanr', 1000),
        fileMtimeMs: 2000,
      }),
    ).toEqual({ kind: 'open-argv', preserveRecovery: true })
  })
})

describe('openPath recovery preservation (applyOpened)', () => {
  const files: Record<string, string> = {
    '/a.homeplanr': serializeDocument(emptyDocument('p_file', 'FromDisk', '2026-07-11T00:00:00.000Z')),
  }
  const adapter: StorageAdapter = {
    kind: 'tauri',
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
