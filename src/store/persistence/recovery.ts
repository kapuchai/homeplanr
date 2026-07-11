import type { ProjectDocument } from '../../model/types'
import { validateParsedObject } from './serialize'

/**
 * Crash-recovery blob — pure logic; localStorage/file glue lives in the
 * storage adapters (M3b).
 *
 * Launch policy (plan-pinned): resolve recovery BEFORE subscribing autosave
 * and before auto-reopen; autosave SKIPS when the doc is not dirty (kills
 * the launch race); decline deletes the blob immediately.
 */
export const RECOVERY_KEY = 'homeplanr:v1:recovery'

export interface RecoveryBlob {
  v: 1
  /** null = never-saved project. */
  filePath: string | null
  docId: string
  /** epoch ms at autosave time (compared against file mtime). */
  savedAt: number
  doc: ProjectDocument
}

export function encodeRecovery(blob: RecoveryBlob): string {
  return JSON.stringify(blob)
}

/** Decode + validate; returns null for anything unusable (never throws). */
export function decodeRecovery(json: string | null): RecoveryBlob | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as Partial<RecoveryBlob>
    if (raw?.v !== 1 || typeof raw.savedAt !== 'number' || typeof raw.docId !== 'string') {
      return null
    }
    const filePath = typeof raw.filePath === 'string' ? raw.filePath : null
    const { doc } = validateParsedObject(raw.doc)
    return { v: 1, filePath, docId: raw.docId, savedAt: raw.savedAt, doc }
  } catch {
    return null
  }
}

export type RecoveryDecision =
  | { action: 'offer-unsaved' }
  | { action: 'offer-restore'; filePath: string }
  | { action: 'discard' }

/**
 * - filePath null → offer "Restore unsaved project"
 * - file exists && savedAt > mtime → offer restore as that path
 * - otherwise (file missing, or file newer than the blob) → discard silently
 */
export function decideRecovery(
  blob: RecoveryBlob,
  fileMtimeMs: number | null,
): RecoveryDecision {
  if (blob.filePath === null) return { action: 'offer-unsaved' }
  if (fileMtimeMs !== null && blob.savedAt > fileMtimeMs) {
    return { action: 'offer-restore', filePath: blob.filePath }
  }
  return { action: 'discard' }
}
