import type { ProjectDocument, ProjectSettings } from '../types'

export function renameProject(doc: ProjectDocument, name: string): void {
  const trimmed = name.trim()
  if (trimmed) doc.name = trimmed
}

/** Project notes (pulled forward from 0.15.0): plain text, trimmed-empty
 * clears the field so untouched files stay clean. */
export function setNotes(doc: ProjectDocument, notes: string): void {
  if (notes.trim()) doc.notes = notes
  else delete doc.notes
}

export function updateSettings(
  doc: ProjectDocument,
  patch: Partial<ProjectSettings>,
): void {
  const s = doc.settings
  if (patch.gridSize !== undefined) {
    s.gridSize = Math.min(1, Math.max(0.01, patch.gridSize))
  }
  if (patch.defaultWallThickness !== undefined) {
    s.defaultWallThickness = Math.min(0.6, Math.max(0.03, patch.defaultWallThickness))
  }
  if (patch.defaultWallHeight !== undefined) {
    s.defaultWallHeight = Math.min(6, Math.max(0.3, patch.defaultWallHeight))
  }
}
