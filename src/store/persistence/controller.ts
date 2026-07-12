import { create } from 'zustand'
import { useDocStore } from '../docStore'
import { clearHistory, isTxActive } from '../transactions'
import type { ProjectDocument } from '../../model/types'
import { emptyDocument } from '../../model/types'
import { newProjectId } from '../../model/ids'
import type { StorageAdapter } from './adapter'
import { createTauriStorage } from './tauriStorage'
import { createBrowserStorage } from './browserStorage'
import {
  ForwardVersionError,
  InvalidDocumentError,
  parseDocument,
  serializeDocument,
} from './serialize'
import {
  decideLaunchIntent,
  decideRecovery,
  decodeRecovery,
  encodeRecovery,
  RECOVERY_KEY,
  type RecoveryBlob,
} from './recovery'
import { useConfirmStore } from '../../app/confirmStore'

/**
 * Persistence controller — owns currentFilePath/lastSavedDoc and applies
 * the plan-pinned STATE MATRIX:
 *   New     → replace(fresh), clear(), path=null, lastSaved=fresh, recovery×
 *   Open    → replace, clear(), path=file, lastSaved=loaded (dirty iff
 *             self-healed), recovery×
 *   Save ok → lastSaved=current, path/recents updated, recovery×
 *   Save ✗  → nothing changes
 *   Restore → replace, clear(), path=blob.path, lastSaved=NONE (always
 *             dirty), recovery kept until the next successful save
 * guardDirty() (in-app 3-button modal) runs before EVERY doc-replacing
 * action AND the window close.
 */
const RECENTS_KEY = 'homeplanr:v1:recents'
const MAX_RECENTS = 8

/** Sentinel: recovery-restored docs are dirty until explicitly saved. */
const NEVER_SAVED: ProjectDocument | null = null

export interface RecentEntry {
  path: string
  name: string
  at: number
}

interface PersistState {
  adapter: StorageAdapter
  currentFilePath: string | null
  lastSavedDoc: ProjectDocument | null
  dirty: boolean
  recents: RecentEntry[]
}

export const usePersistStore = create<PersistState>()(() => ({
  adapter: null as unknown as StorageAdapter,
  currentFilePath: null,
  lastSavedDoc: null,
  dirty: false,
  recents: [],
}))

const state = () => usePersistStore.getState()
const doc = () => useDocStore.getState().doc

// ---------- recents ----------
function loadRecents(): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as RecentEntry[]
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.path === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(path: string, name: string): void {
  const next = [
    { path, name, at: Date.now() },
    ...state().recents.filter((r) => r.path !== path),
  ].slice(0, MAX_RECENTS)
  usePersistStore.setState({ recents: next })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
}

function dropRecent(path: string): void {
  const next = state().recents.filter((r) => r.path !== path)
  usePersistStore.setState({ recents: next })
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
}

// ---------- dirty + title ----------
function recomputeDirty(): void {
  const { lastSavedDoc, adapter, currentFilePath } = state()
  const dirty = doc() !== lastSavedDoc
  if (dirty !== state().dirty) usePersistStore.setState({ dirty })
  const marker = dirty ? ' •' : ''
  const base = currentFilePath
    ? (currentFilePath.split(/[/\\]/).pop() ?? doc().name)
    : doc().name
  adapter?.setTitle(`${base}${marker} — homeplanr`)
}

// ---------- recovery autosave ----------
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRecoveryAutosave(): void {
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    if (!state().dirty) return // skip-when-clean kills the launch race
    try {
      localStorage.setItem(
        RECOVERY_KEY,
        encodeRecovery({
          v: 1,
          filePath: state().currentFilePath,
          docId: doc().id,
          savedAt: Date.now(),
          doc: doc(),
        }),
      )
    } catch {
      // QuotaExceeded — recovery is best-effort; real saves still work
    }
  }, 500)
}

const clearRecovery = () => localStorage.removeItem(RECOVERY_KEY)

// ---------- guard ----------
export type GuardChoice = 'save' | 'discard' | 'cancel'

export async function guardDirty(): Promise<GuardChoice> {
  if (!state().dirty) return 'discard' // clean: nothing to guard
  const choice = await useConfirmStore.getState().prompt<GuardChoice>(
    'Unsaved changes',
    `“${doc().name}” has unsaved changes.`,
    [
      { label: 'Save', value: 'save', variant: 'primary' },
      { label: 'Discard', value: 'discard', variant: 'danger' },
      { label: 'Cancel', value: 'cancel', variant: 'plain' },
    ],
  )
  if (choice === 'save') {
    const ok = await saveProject()
    return ok ? 'save' : 'cancel' // failed/cancelled save aborts the action
  }
  return choice
}

// ---------- core ops (the state matrix) ----------
export async function newProject(): Promise<void> {
  if (isTxActive()) return
  if ((await guardDirty()) === 'cancel') return
  const fresh = emptyDocument(newProjectId(), 'Untitled', new Date().toISOString())
  useDocStore.getState().replaceDocument(fresh)
  clearHistory()
  usePersistStore.setState({
    currentFilePath: null,
    lastSavedDoc: useDocStore.getState().doc, // pristine, not dirty
  })
  clearRecovery()
  recomputeDirty()
}

async function applyOpened(
  json: string,
  path: string | null,
  displayName?: string,
  opts?: { preserveRecovery?: boolean },
): Promise<boolean> {
  const { adapter } = state()
  try {
    const { doc: parsed, warnings, healed } = parseDocument(json)
    if (displayName && parsed.name === 'Untitled') parsed.name = displayName.replace(/\.homeplanr$/, '')
    useDocStore.getState().replaceDocument(parsed)
    clearHistory()
    usePersistStore.setState({
      currentFilePath: path,
      // self-healed docs no longer match the file — mark dirty
      lastSavedDoc: healed ? NEVER_SAVED : useDocStore.getState().doc,
    })
    // an argv-opened file must not destroy an UNRELATED crash blob — it
    // stays offerable on a later plain launch
    if (!opts?.preserveRecovery) clearRecovery()
    recomputeDirty()
    if (path) pushRecent(path, parsed.name)
    if (healed) {
      await adapter.message(
        'Repaired file',
        `The file needed repairs while opening${warnings.length ? `: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}` : '.'} Review and save to keep the repaired version.`,
      )
    }
    return true
  } catch (err) {
    if (err instanceof ForwardVersionError) {
      await adapter.message('Newer file', err.message)
    } else if (err instanceof InvalidDocumentError) {
      await adapter.message('Could not open', err.message)
    } else {
      await adapter.message('Could not open', String(err))
    }
    return false
  }
}

export async function openProject(): Promise<void> {
  if (isTxActive()) return
  if ((await guardDirty()) === 'cancel') return
  const { adapter } = state()
  try {
    const result = await adapter.openDialog()
    if (!result) return // cancelled
    await applyOpened(result.json, result.path, result.name)
  } catch (err) {
    await adapter.message('Could not open', String(err))
  }
}

/**
 * Read + open a known path (recents, argv, second-instance relay). Returns
 * success; failures surface a dialog and prune the recents entry. Callers
 * resolve dirty state (guardDirty) themselves.
 */
export async function openPath(
  path: string,
  opts?: { preserveRecovery?: boolean },
): Promise<boolean> {
  const { adapter } = state()
  if (!adapter.readPath) return false
  try {
    const json = await adapter.readPath(path)
    return await applyOpened(json, path, undefined, opts)
  } catch (err) {
    dropRecent(path) // unreadable/missing — prune the entry
    await adapter.message('Could not open', `${path}\n\n${String(err)}`)
    return false
  }
}

export async function openRecent(path: string): Promise<void> {
  if (isTxActive()) return
  if (!state().adapter.readPath) return
  if ((await guardDirty()) === 'cancel') return
  await openPath(path)
}

export async function saveProject(): Promise<boolean> {
  if (isTxActive()) return false
  const { adapter, currentFilePath } = state()
  const json = serializeDocument(doc())
  try {
    let path: string | null
    if (currentFilePath && adapter.savePath) {
      path = await adapter.savePath(currentFilePath, json)
    } else {
      path = await adapter.saveAsDialog(json, doc().name)
      if (!path) return false // cancelled
    }
    usePersistStore.setState({
      currentFilePath: adapter.kind === 'tauri' ? path : null,
      lastSavedDoc: doc(),
    })
    if (adapter.kind === 'tauri') pushRecent(path, doc().name)
    clearRecovery()
    recomputeDirty()
    return true
  } catch (err) {
    await adapter.message('Save failed', String(err))
    return false // dirty/title/recovery untouched
  }
}

export async function saveProjectAs(): Promise<boolean> {
  if (isTxActive()) return false
  const { adapter } = state()
  const json = serializeDocument(doc())
  try {
    const path = await adapter.saveAsDialog(json, doc().name)
    if (!path) return false
    usePersistStore.setState({
      currentFilePath: adapter.kind === 'tauri' ? path : null,
      lastSavedDoc: doc(),
    })
    if (adapter.kind === 'tauri') pushRecent(path, doc().name)
    clearRecovery()
    recomputeDirty()
    return true
  } catch (err) {
    await adapter.message('Save failed', String(err))
    return false
  }
}

/**
 * The M3b recovery offer: prompt Restore/Discard (silently discarding a
 * stale blob) → true when the blob was restored into the editor.
 */
async function offerRecovery(blob: RecoveryBlob, mtime: number | null): Promise<boolean> {
  const decision = decideRecovery(blob, mtime)
  if (decision.action === 'discard') {
    clearRecovery()
    return false
  }
  const choice = await useConfirmStore.getState().prompt(
    'Restore unsaved work?',
    decision.action === 'offer-unsaved'
      ? `“${blob.doc.name}” has unsaved changes from a previous session.`
      : `“${blob.doc.name}” has changes newer than ${decision.filePath}.`,
    [
      { label: 'Restore', value: 'restore', variant: 'primary' },
      { label: 'Discard', value: 'discard', variant: 'danger' },
    ],
  )
  if (choice !== 'restore') {
    clearRecovery()
    return false
  }
  useDocStore.getState().replaceDocument(blob.doc)
  clearHistory()
  usePersistStore.setState({
    currentFilePath: blob.filePath,
    lastSavedDoc: NEVER_SAVED, // always dirty until saved
  })
  // recovery blob KEPT until the next successful save
  return true
}

// ---------- launch (plan-pinned order) ----------
export async function launchPersistence(): Promise<void> {
  const tauri = await isTauriRuntime()
  const adapter = tauri ? createTauriStorage() : createBrowserStorage()
  usePersistStore.setState({ adapter, recents: loadRecents() })

  adapter.installCloseGuard({
    isDirty: () => state().dirty,
    confirmAndClose: async () => {
      const choice = await guardDirty()
      // an explicit Discard on close is a decision — never re-offer that
      // work as crash recovery on the next launch
      if (choice === 'discard') clearRecovery()
      return choice !== 'cancel'
    },
  })

  // 1. argv .homeplanr path (file association / CLI) — tauri cold start
  const argvPath = tauri ? await takeLaunchFile() : null

  // 2. resolve recovery BEFORE autosave subscription and auto-reopen,
  //    routed against the argv path (argv wins over auto-reopen)
  const blob = decodeRecovery(localStorage.getItem(RECOVERY_KEY))
  const mtime =
    blob?.filePath && adapter.statMtime ? await adapter.statMtime(blob.filePath) : null
  const intent = decideLaunchIntent({ argvPath, blob, fileMtimeMs: mtime })

  let opened = false
  let recoveryOffered = false
  if (argvPath && blob && intent.kind === 'restore-prompt-then-argv') {
    // the blob shadows the argv file itself — the recovery prompt decides;
    // Discard falls back to opening the file from disk
    recoveryOffered = true
    opened = await offerRecovery(blob, mtime)
    if (!opened) opened = await openPath(argvPath)
  } else if (argvPath && intent.kind === 'open-argv') {
    opened = await openPath(argvPath, { preserveRecovery: intent.preserveRecovery })
  }
  // open failure falls through to the normal chain, starting at recovery
  if (!opened && !recoveryOffered && blob) {
    opened = await offerRecovery(blob, mtime)
  }

  // 3. auto-reopen the most recent file
  if (!opened && adapter.readPath) {
    const recent = state().recents[0]
    if (recent) {
      try {
        const json = await adapter.readPath(recent.path)
        opened = await applyOpened(json, recent.path)
      } catch {
        dropRecent(recent.path) // ENOENT etc. — silent fallback to new doc
      }
    }
  }

  // 4. fresh document
  if (!opened) {
    usePersistStore.setState({ lastSavedDoc: doc() })
  }
  recomputeDirty()

  // 5. subscriptions: dirty/title + recovery autosave
  useDocStore.subscribe(
    (s) => s.doc,
    () => {
      recomputeDirty()
      scheduleRecoveryAutosave()
    },
  )

  // 6. second-instance argv relay (Rust single-instance plugin)
  if (tauri) installOpenFileListener()
}

async function takeLaunchFile(): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<string | null>('take_launch_file')) ?? null
  } catch {
    return null
  }
}

// registered ONCE for the app's lifetime (module-level guard, like the
// onCloseRequested close guard) — launch may re-run under StrictMode
let openFileListenerInstalled = false
function installOpenFileListener(): void {
  if (openFileListenerInstalled) return
  openFileListenerInstalled = true
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<string>('open-file', ({ payload }) => {
      void (async () => {
        if (isTxActive()) return
        if ((await guardDirty()) === 'cancel') return
        // normal clearRecovery inside the open is correct here: guardDirty
        // just resolved this session's unsaved work
        await openPath(payload)
      })()
    }),
  )
}

async function isTauriRuntime(): Promise<boolean> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core')
    return isTauri()
  } catch {
    return false
  }
}
