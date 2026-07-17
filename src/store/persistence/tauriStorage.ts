import { nanoid } from 'nanoid'
import type { StorageAdapter } from './adapter'
import { defaultDialogDir, defaultDialogPath, rememberDialogDir } from './defaultDirs'

/**
 * Native storage: plugin-dialog + plugin-fs. Dialog-granted paths persist
 * across restarts via tauri-plugin-persisted-scope (registered in lib.rs) —
 * launch auto-reopen and Recents depend on that.
 *
 * Dialogs open in a sensible directory (B7): exports → Downloads, saves
 * and opens → Documents, with the user's last-picked directory remembered
 * per dialog kind (defaultDirs.ts).
 *
 * Atomic save: write `${path}.tmp-<id>` then rename() over the target;
 * scope/rename failures fall back to a direct write (the localStorage
 * recovery blob remains the corruption backstop).
 */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
}

/** btoa needs a binary string; build it in chunks — a spread would blow the
 * argument limit on multi-MB photos. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function createTauriStorage(): StorageAdapter {
  return {
    kind: 'tauri',

    async openDialog() {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: false,
        directory: false,
        defaultPath: await defaultDialogDir('open'),
        filters: [{ name: 'homeplanr project', extensions: ['homeplanr'] }],
      })
      if (!picked || typeof picked !== 'string') return null
      void rememberDialogDir('open', picked)
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      return { json: await readTextFile(picked), path: picked }
    },

    async readPath(path) {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      return readTextFile(path)
    },

    async savePath(path, json) {
      const fs = await import('@tauri-apps/plugin-fs')
      const tmp = `${path}.tmp-${nanoid(6)}`
      try {
        await fs.writeTextFile(tmp, json)
        await fs.rename(tmp, path)
      } catch {
        // scope may not cover the tmp sibling — direct write fallback
        try {
          await fs.remove(tmp)
        } catch {
          /* tmp may not exist */
        }
        await fs.writeTextFile(path, json)
      }
      return path
    },

    async saveAsDialog(json, suggestedName) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const name = suggestedName.endsWith('.homeplanr')
        ? suggestedName
        : `${suggestedName}.homeplanr`
      const picked = await save({
        defaultPath: await defaultDialogPath('save', name),
        filters: [{ name: 'homeplanr project', extensions: ['homeplanr'] }],
      })
      if (!picked) return null
      void rememberDialogDir('save', picked)
      return this.savePath!(picked, json)
    },

    async openImageDialog() {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: false,
        directory: false,
        defaultPath: await defaultDialogDir('image'),
        filters: [{ name: 'Images', extensions: Object.keys(IMAGE_MIME) }],
      })
      if (!picked || typeof picked !== 'string') return null
      void rememberDialogDir('image', picked)
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const bytes = await readFile(picked)
      const ext = picked.split('.').pop()?.toLowerCase() ?? ''
      // extensions are dialog-filtered to the map's keys; png is a safe
      // decode hint for anything that slips through (Image sniffs content)
      const mime = IMAGE_MIME[ext] ?? 'image/png'
      return {
        dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
        name: picked.split(/[/\\]/).pop() ?? 'image',
      }
    },

    async saveBinaryDialog(bytes, suggestedName, filter) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const picked = await save({
        defaultPath: await defaultDialogPath('export', suggestedName),
        filters: [filter],
      })
      if (!picked) return null
      void rememberDialogDir('export', picked)
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(picked, bytes)
      return picked
    },

    async statMtime(path) {
      try {
        const { stat } = await import('@tauri-apps/plugin-fs')
        const s = await stat(path)
        return s.mtime ? new Date(s.mtime).getTime() : null
      } catch {
        return null
      }
    },

    setTitle(title) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(title),
      )
    },

    installCloseGuard(guard) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        void win.onCloseRequested(async (event) => {
          if (!guard.isDirty()) return // clean: allow the close through
          // preventDefault SYNCHRONOUSLY, then decide; destroy() explicitly
          // (close() would re-fire this handler in a loop)
          event.preventDefault()
          if (await guard.confirmAndClose()) await win.destroy()
        })
      })
    },

    async message(title, body) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      await message(body, { title, kind: 'error' })
    },
  }
}
