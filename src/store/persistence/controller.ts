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
import { useAppSettings } from '../appSettings'

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
  /** Epoch ms of the last successful write (explicit or autosave). */
  lastSavedAt: number | null
  /** True when that write was an autosave (the status flash stays quiet). */
  lastSaveWasAuto: boolean
  /** Last autosave attempt failed — surfaced in the status line, no modal. */
  autosaveError: boolean
}

export const usePersistStore = create<PersistState>()(() => ({
  adapter: null as unknown as StorageAdapter,
  currentFilePath: null,
  lastSavedDoc: null,
  dirty: false,
  recents: [],
  lastSavedAt: null,
  lastSaveWasAuto: false,
  autosaveError: false,
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

// ---------- autosave-to-file (opt-in; crash recovery above is separate) ----------
let fileAutosaveTimer: ReturnType<typeof setTimeout> | null = null
/** Doc-replacing ops call this after their guard resolves: an autosave that
 * fires mid-open would write the DISCARDED doc back to its old path. */
function cancelFileAutosave(): void {
  if (fileAutosaveTimer) {
    clearTimeout(fileAutosaveTimer)
    fileAutosaveTimer = null
  }
}
export function scheduleFileAutosave(): void {
  if (fileAutosaveTimer) clearTimeout(fileAutosaveTimer)
  fileAutosaveTimer = setTimeout(() => {
    fileAutosaveTimer = null
    void runFileAutosave()
  }, 3000)
}

async function runFileAutosave(): Promise<void> {
  if (!useAppSettings.getState().autosaveEnabled) {
    // turning autosave off must not leave a stale error eating the hint line
    if (state().autosaveError) usePersistStore.setState({ autosaveError: false })
    return
  }
  const { adapter, currentFilePath, dirty } = state()
  // no path ⇒ SILENT skip (never a dialog; the crash blob is the net)
  if (!dirty || !currentFilePath || !adapter?.savePath) return
  if (isTxActive() || useConfirmStore.getState().pending) {
    // mid-gesture, or the user is DECIDING (a guardDirty 'Discard?' prompt):
    // writing now would falsify the prompt's premise — retry later
    scheduleFileAutosave()
    return
  }
  await serializedWrite(async () => {
    // re-check under the lock — an explicit save may have just run, a drag
    // may have started while we were queued
    const { currentFilePath: path, dirty: stillDirty, adapter: a } = state()
    if (!stillDirty || !path || !a.savePath) return
    if (isTxActive()) {
      scheduleFileAutosave()
      return
    }
    const snapshot = doc()
    const json = serializeDocument(snapshot)
    try {
      await a.savePath(path, json)
      usePersistStore.setState({
        lastSavedDoc: snapshot,
        lastSavedAt: Date.now(),
        lastSaveWasAuto: true,
        autosaveError: false,
      })
      clearRecovery()
      recomputeDirty()
      if (state().dirty) scheduleRecoveryAutosave()
    } catch {
      // NO modal mid-flow: flag it for the status line; the next doc change
      // reschedules a retry, and explicit saves keep their error dialog
      usePersistStore.setState({ autosaveError: true })
    }
  })
}

// ---------- op serialization ----------
// Doc-replacing operations run ONE at a time: a second request (second
// window relay, menu click while a guard prompt is up) queues behind the
// first instead of interleaving its awaits with it — each queued op
// re-checks dirty/world state when its turn comes. Never wrap saveProject
// (it runs INSIDE guarded ops via guardDirty — wrapping would deadlock).
let opChain: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn)
  opChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// ---------- write serialization ----------
// ALL file writes (explicit saves AND autosaves) run one at a time through
// this chain — an autosave firing during a Save-As dialog must never
// interleave its write with the explicit one.
let writeChain: Promise<unknown> = Promise.resolve()
function serializedWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// ---------- tx-idle wait ----------
/**
 * Wait briefly for a live drag transaction to finish instead of silently
 * dropping the request (double-clicking a file mid-drag used to focus the
 * window and then do nothing). False after the timeout — caller surfaces it.
 */
async function whenTxIdle(timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (isTxActive()) {
    if (Date.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 50))
  }
  return true
}

async function reportBusy(): Promise<void> {
  await state().adapter.message('Busy', 'A drag is in progress — finish it and try again.')
}

// ---------- guard ----------
export type GuardChoice = 'save' | 'discard' | 'cancel'

export async function guardDirty(): Promise<GuardChoice> {
  // loop: a successful save no longer implies clean — edits landing under
  // the Save-As dialog (S1 snapshot semantics) leave NEW unsaved work that
  // must be re-guarded, not destroyed by the caller's doc replacement
  for (;;) {
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
    if (choice !== 'save') return choice
    if (!(await saveProject())) return 'cancel' // failed/cancelled save aborts
    if (!state().dirty) return 'save'
    // mid-save edits exist — prompt again for them
  }
}

// ---------- core ops (the state matrix) ----------
export function newProject(): Promise<void> {
  return serialized(async () => {
    if (!(await whenTxIdle())) return reportBusy()
    if ((await guardDirty()) === 'cancel') return
    cancelFileAutosave() // a late autosave must not resurrect discarded work
    const fresh = emptyDocument(newProjectId(), 'Untitled', new Date().toISOString())
    useDocStore.getState().replaceDocument(fresh)
    clearHistory()
    usePersistStore.setState({
      currentFilePath: null,
      lastSavedDoc: useDocStore.getState().doc, // pristine, not dirty
      autosaveError: false,
    })
    clearRecovery()
    recomputeDirty()
  })
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
      autosaveError: false,
    })
    // preserveRecovery: only the Esc-DISMISSED launch prompt sets this —
    // the user deferred the decision, so the blob stays offerable on a
    // later launch (until the next edit's autosave, single-slot caveat)
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

export function openProject(): Promise<void> {
  return serialized(async () => {
    if (!(await whenTxIdle())) return reportBusy()
    if ((await guardDirty()) === 'cancel') return
    cancelFileAutosave() // see newProject
    const { adapter } = state()
    try {
      const result = await adapter.openDialog()
      if (!result) return // cancelled
      await applyOpened(result.json, result.path, result.name)
    } catch (err) {
      await adapter.message('Could not open', String(err))
    }
  })
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

export function openRecent(path: string): Promise<void> {
  return serialized(async () => {
    if (!state().adapter.readPath) return
    if (!(await whenTxIdle())) return reportBusy()
    if ((await guardDirty()) === 'cancel') return
    cancelFileAutosave() // see newProject
    await openPath(path)
  })
}

export async function saveProject(): Promise<boolean> {
  if (!(await whenTxIdle())) {
    await reportBusy() // an answered "Save" must never silently do nothing
    return false
  }
  const { adapter, currentFilePath } = state()
  // Snapshot ONCE, before any await: the write can take a while (Save-As
  // keeps the webview interactive under the native dialog) and edits landing
  // mid-save must stay dirty — so the file's content and lastSavedDoc MUST
  // be the same doc reference. Re-reading doc() after the await used to mark
  // mid-save edits as saved without ever writing them.
  return serializedWrite(async () => {
    // Snapshot INSIDE the lock: a queued explicit save must persist the doc
    // as of ITS turn, not a stale pre-autosave reference.
    const snapshot = doc()
    const json = serializeDocument(snapshot)
    try {
      let path: string | null
      if (currentFilePath && adapter.savePath) {
        path = await adapter.savePath(currentFilePath, json)
      } else {
        path = await adapter.saveAsDialog(json, snapshot.name)
        if (!path) return false // cancelled
      }
      usePersistStore.setState({
        currentFilePath: adapter.kind === 'tauri' ? path : null,
        lastSavedDoc: snapshot,
        lastSavedAt: Date.now(),
        lastSaveWasAuto: false,
        autosaveError: false,
      })
      if (adapter.kind === 'tauri') pushRecent(path, snapshot.name)
      clearRecovery()
      recomputeDirty()
      // mid-save edits: still dirty, and the clearRecovery above wiped their
      // crash blob — re-arm it
      if (state().dirty) scheduleRecoveryAutosave()
      return true
    } catch (err) {
      await adapter.message('Save failed', String(err))
      return false // dirty/title/recovery untouched
    }
  })
}

export async function saveProjectAs(): Promise<boolean> {
  if (!(await whenTxIdle())) {
    await reportBusy()
    return false
  }
  return serializedWrite(async () => {
    if (!(await whenTxIdle())) return false // a drag started while queued
    const { adapter } = state()
    const snapshot = doc() // see saveProject: one snapshot for file AND state
    const json = serializeDocument(snapshot)
    try {
      const path = await adapter.saveAsDialog(json, snapshot.name)
      if (!path) return false
      usePersistStore.setState({
        currentFilePath: adapter.kind === 'tauri' ? path : null,
        lastSavedDoc: snapshot,
        lastSavedAt: Date.now(),
        lastSaveWasAuto: false,
        autosaveError: false,
      })
      if (adapter.kind === 'tauri') pushRecent(path, snapshot.name)
      clearRecovery()
      recomputeDirty()
      if (state().dirty) scheduleRecoveryAutosave()
      return true
    } catch (err) {
      await adapter.message('Save failed', String(err))
      return false
    }
  })
}

export type RecoveryOutcome = 'restored' | 'declined' | 'dismissed'

/**
 * The M3b recovery offer: prompt Restore/Discard (silently discarding a
 * stale blob). Escape resolves as 'dismissed' — the blob is KEPT for a
 * later launch instead of being destroyed by a reflexive keypress (the
 * prompt's last button is Discard, so the default esc mapping would delete
 * it). Note the single-slot caveat: a dismissed blob still dies to the
 * autosave on the first edit of whatever opens next.
 */
export async function offerRecovery(
  blob: RecoveryBlob,
  mtime: number | null,
  opts?: { competingPath?: string },
): Promise<RecoveryOutcome> {
  const decision = decideRecovery(blob, mtime)
  if (decision.action === 'discard') {
    clearRecovery()
    return 'declined'
  }
  // when the prompt shadows a file the user just double-clicked, say what
  // Restore means for it — their open-intent must not vanish untold
  const competing =
    opts?.competingPath && opts.competingPath !== blob.filePath
      ? ` Restore keeps “${opts.competingPath.split(/[/\\]/).pop()}” unopened — open it from the File menu afterwards.`
      : ''
  const choice = await useConfirmStore.getState().prompt(
    'Restore unsaved work?',
    (decision.action === 'offer-unsaved'
      ? `“${blob.doc.name}” has unsaved changes from a previous session.`
      : `“${blob.doc.name}” has changes newer than ${decision.filePath}.`) + competing,
    [
      { label: 'Restore', value: 'restore', variant: 'primary' },
      { label: 'Discard', value: 'discard', variant: 'danger' },
    ],
    { escValue: 'dismiss' },
  )
  if (choice === 'dismiss') return 'dismissed' // blob kept
  if (choice !== 'restore') {
    clearRecovery()
    return 'declined'
  }
  useDocStore.getState().replaceDocument(blob.doc)
  clearHistory()
  usePersistStore.setState({
    currentFilePath: blob.filePath,
    lastSavedDoc: NEVER_SAVED, // always dirty until saved
  })
  // recovery blob KEPT until the next successful save
  return 'restored'
}

// ---------- launch (plan-pinned order) ----------
export async function launchPersistence(): Promise<void> {
  const tauri = await isTauriRuntime()
  const adapter = tauri ? createTauriStorage() : createBrowserStorage()
  usePersistStore.setState({ adapter, recents: loadRecents() })

  if (!closeGuardInstalled) {
    // once per app lifetime — StrictMode re-runs launch in dev, and a second
    // onCloseRequested handler would queue the guard prompt twice
    closeGuardInstalled = true
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
  }

  // second-instance argv relay (Rust single-instance plugin) — registered
  // BEFORE the launch chain so a relay arriving during the recovery prompt
  // queues behind it (serialized) instead of vanishing unheard
  if (tauri) installOpenFileListener()

  await serialized(async () => {
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
    // an Esc-dismissed blob must survive whatever opens next in this launch
    let dismissed = false
    if (argvPath && blob && intent.kind === 'restore-prompt-then-argv') {
      // ANY offerable blob prompts before an argv open (single recovery
      // slot: deferring it would let the first edit's autosave destroy it)
      // — Discard falls back to opening the file from disk
      recoveryOffered = true
      const outcome = await offerRecovery(blob, mtime, { competingPath: argvPath })
      dismissed = outcome === 'dismissed'
      opened = outcome === 'restored'
      if (!opened) opened = await openPath(argvPath, { preserveRecovery: dismissed })
    } else if (argvPath && intent.kind === 'open-argv') {
      opened = await openPath(argvPath)
    }
    // open failure falls through to the normal chain, starting at recovery
    if (!opened && !recoveryOffered && blob) {
      const outcome = await offerRecovery(blob, mtime)
      dismissed = outcome === 'dismissed'
      opened = outcome === 'restored'
    }

    // 3. auto-reopen the most recent file
    if (!opened && adapter.readPath) {
      const recent = state().recents[0]
      if (recent) {
        try {
          const json = await adapter.readPath(recent.path)
          opened = await applyOpened(json, recent.path, undefined, {
            preserveRecovery: dismissed,
          })
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
  })

  // 5. subscriptions: dirty/title + recovery autosave
  useDocStore.subscribe(
    (s) => s.doc,
    () => {
      recomputeDirty()
      scheduleRecoveryAutosave()
      scheduleFileAutosave() // no-ops unless enabled + dirty + a path exists
    },
  )
}

async function takeLaunchFile(): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<string | null>('take_launch_file')) ?? null
  } catch {
    return null
  }
}

// registered ONCE for the app's lifetime — launch may re-run under StrictMode
let closeGuardInstalled = false
let openFileListenerInstalled = false
function installOpenFileListener(): void {
  if (openFileListenerInstalled) return
  openFileListenerInstalled = true
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<string>('open-file', ({ payload }) => {
      void serialized(async () => {
        // wait for a live drag instead of silently dropping the relay (the
        // second instance already focused this window — doing nothing after
        // that reads as a broken double-click)
        if (!(await whenTxIdle())) return reportBusy()
        if ((await guardDirty()) === 'cancel') return
        cancelFileAutosave() // see newProject
        // normal clearRecovery inside the open is correct here: guardDirty
        // just resolved this session's unsaved work
        await openPath(payload)
      })
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
