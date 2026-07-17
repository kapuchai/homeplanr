/**
 * Storage adapter contract — one interface, two implementations:
 * TauriStorage (native dialogs + fs, the product) and BrowserStorage
 * (download/upload; dev-in-browser + future web deploy).
 */
export interface OpenResult {
  json: string
  /** Absolute path (Tauri) or null (browser upload). */
  path: string | null
  /** Display name for browser uploads. */
  name?: string
}

export interface StorageAdapter {
  kind: 'tauri' | 'browser'
  /** Show an open dialog. null = user cancelled. Throws on read errors. */
  openDialog(): Promise<OpenResult | null>
  /** Read a known path (launch auto-reopen / recents). Tauri only. */
  readPath?(path: string): Promise<string>
  /**
   * Save to a known path (atomic tmp+rename with direct-write fallback).
   * Returns the path. Throws on write errors.
   */
  savePath?(path: string, json: string): Promise<string>
  /** Save-As dialog. Returns the chosen path/name, null = cancelled. */
  saveAsDialog(json: string, suggestedName: string): Promise<string | null>
  /** Binary export save-as. Returns the saved path/name, null when cancelled. */
  saveBinaryDialog(
    bytes: Uint8Array,
    suggestedName: string,
    filter: { name: string; extensions: string[] },
  ): Promise<string | null>
  /** Pick an image (wall-art upload). Returns the RAW file as a data-URL —
   * ingest (downscale/re-encode/cap) is the caller's job, never the
   * adapter's. null = cancelled. Throws on read errors. */
  openImageDialog(): Promise<{ dataUrl: string; name: string } | null>
  /** File mtime in epoch ms; null when missing/unstattable. */
  statMtime?(path: string): Promise<number | null>
  /** Window title (dirty marker). No-op in browser. */
  setTitle(title: string): void
  /**
   * Install the close guard. Tauri awaits `confirmAndClose` (Save/Discard/
   * Cancel modal → true allows the close). Browsers can't await inside
   * beforeunload — they use the sync `isDirty` for the generic prompt.
   */
  installCloseGuard(guard: {
    isDirty: () => boolean
    confirmAndClose: () => Promise<boolean>
  }): void
  /** Native error/warning surface (plan: no toast system). */
  message(title: string, body: string): Promise<void>
}
