import type { ProjectDocument, ProjectSettings } from '../types'

export function renameProject(doc: ProjectDocument, name: string): void {
  const trimmed = name.trim()
  if (trimmed) doc.name = trimmed
}

export function updateSettings(
  doc: ProjectDocument,
  patch: Partial<ProjectSettings>,
): void {
  const s = doc.settings
  if (patch.gridSize !== undefined) {
    s.gridSize = Math.min(1, Math.max(0.01, patch.gridSize))
  }
  if (patch.snapEnabled !== undefined) s.snapEnabled = patch.snapEnabled
  if (patch.unitDisplay !== undefined) s.unitDisplay = patch.unitDisplay
  if (patch.defaultWallThickness !== undefined) {
    s.defaultWallThickness = Math.min(0.6, Math.max(0.03, patch.defaultWallThickness))
  }
  if (patch.defaultWallHeight !== undefined) {
    s.defaultWallHeight = Math.min(6, Math.max(0.3, patch.defaultWallHeight))
  }
}
