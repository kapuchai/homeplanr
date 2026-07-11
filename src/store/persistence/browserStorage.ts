import type { StorageAdapter } from './adapter'

/**
 * Browser fallback (dev mode / future web deploy): Blob download +
 * file-input upload; beforeunload as the (boolean-only) close guard.
 * Clearing dirty on download is unverifiable — accepted (plan).
 */
export function createBrowserStorage(): StorageAdapter {
  return {
    kind: 'browser',

    openDialog() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.homeplanr,.json,application/json'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          const reader = new FileReader()
          reader.onload = () =>
            resolve({ json: String(reader.result), path: null, name: file.name })
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          reader.readAsText(file)
        }
        // cancel fires no event reliably — resolve(null) if focus returns
        window.addEventListener(
          'focus',
          () => setTimeout(() => resolve(null), 400),
          { once: true },
        )
        input.click()
      })
    },

    async saveAsDialog(json, suggestedName) {
      const name = suggestedName.endsWith('.homeplanr')
        ? suggestedName
        : `${suggestedName}.homeplanr`
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      return name // pseudo-path: browser saves are always Save-As downloads
    },

    setTitle(title) {
      document.title = title
    },

    installCloseGuard(guard) {
      window.addEventListener('beforeunload', (e) => {
        // browsers only allow the generic leave-page prompt, decided sync
        if (guard.isDirty()) e.preventDefault()
      })
    },

    async message(title, body) {
      window.alert(`${title}\n\n${body}`)
    },
  }
}
