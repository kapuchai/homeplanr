import { nanoid } from 'nanoid'
import type { StorageAdapter } from './adapter'

/**
 * Native storage: plugin-dialog + plugin-fs. Dialog-granted paths persist
 * across restarts via tauri-plugin-persisted-scope (registered in lib.rs) —
 * launch auto-reopen and Recents depend on that.
 *
 * Atomic save: write `${path}.tmp-<id>` then rename() over the target;
 * scope/rename failures fall back to a direct write (the localStorage
 * recovery blob remains the corruption backstop).
 */
export function createTauriStorage(): StorageAdapter {
  return {
    kind: 'tauri',

    async openDialog() {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'homeplanr project', extensions: ['homeplanr'] }],
      })
      if (!picked || typeof picked !== 'string') return null
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
      const picked = await save({
        defaultPath: suggestedName.endsWith('.homeplanr')
          ? suggestedName
          : `${suggestedName}.homeplanr`,
        filters: [{ name: 'homeplanr project', extensions: ['homeplanr'] }],
      })
      if (!picked) return null
      return this.savePath!(picked, json)
    },

    async saveBinaryDialog(bytes, suggestedName, filter) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const picked = await save({
        defaultPath: suggestedName,
        filters: [filter],
      })
      if (!picked) return null
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
