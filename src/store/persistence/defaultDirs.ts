import { useAppSettings, type DialogDirKind } from '../appSettings'

/**
 * Native-dialog default directories (B7, 0.5.0): exports land in Downloads,
 * .homeplanr saves/opens in Documents — until the user picks somewhere
 * else, which is remembered PER DIALOG KIND as a device pref. Tauri-only
 * (the browser adapter has no real paths). A remembered directory that no
 * longer exists is harmless: the GTK/native chooser falls back on its own.
 */

/** Pure policy — remembered dir wins, else the kind's system default
 * (exports → Downloads, images → Pictures, the rest → Documents). */
export const pickDefaultDir = (
  kind: DialogDirKind,
  remembered: string | null,
  sys: { downloads: string; documents: string; pictures?: string },
): string =>
  remembered ??
  (kind === 'export'
    ? sys.downloads
    : kind === 'image'
      ? (sys.pictures ?? sys.documents)
      : sys.documents)

/** Default dir joined with the suggested name, or bare name if the path
 * API is unavailable (dialog then opens wherever the OS decides). */
export async function defaultDialogPath(kind: DialogDirKind, name: string): Promise<string> {
  try {
    const path = await import('@tauri-apps/api/path')
    const s = useAppSettings.getState()
    const remembered =
      kind === 'save'
        ? s.lastDirSave
        : kind === 'export'
          ? s.lastDirExport
          : kind === 'image'
            ? s.lastDirImage
            : s.lastDirOpen
    const documents = await path.documentDir()
    const dir = pickDefaultDir(kind, remembered, {
      downloads: await path.downloadDir(),
      documents,
      // xdg Pictures may be unset on minimal setups — never let that break
      // the dialog, just fall back to Documents
      pictures: kind === 'image' ? await path.pictureDir().catch(() => documents) : undefined,
    })
    return name ? await path.join(dir, name) : dir
  } catch {
    return name
  }
}

/** Directory-only variant (open dialogs take a dir, not a file path). */
export const defaultDialogDir = (kind: DialogDirKind): Promise<string> =>
  defaultDialogPath(kind, '')

/** Best-effort: remember the picked file's directory for this dialog kind. */
export async function rememberDialogDir(kind: DialogDirKind, filePath: string): Promise<void> {
  try {
    const { dirname } = await import('@tauri-apps/api/path')
    useAppSettings.getState().setLastDir(kind, await dirname(filePath))
  } catch {
    // path API unavailable — the fixed defaults keep working
  }
}
