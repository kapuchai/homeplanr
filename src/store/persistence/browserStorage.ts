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
        let fileChosen = false
        input.onchange = () => {
          fileChosen = true
          const file = input.files?.[0]
          if (!file) return resolve(null)
          const reader = new FileReader()
          reader.onload = () =>
            resolve({ json: String(reader.result), path: null, name: file.name })
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          reader.readAsText(file)
        }
        // cancel fires no event reliably — resolve(null) if focus returns
        // WITHOUT a chosen file (a slow FileReader must not lose the race
        // against this timer and read as a cancel)
        window.addEventListener(
          'focus',
          () =>
            setTimeout(() => {
              if (!fileChosen) resolve(null)
            }, 400),
          { once: true },
        )
        input.click()
      })
    },

    openImageDialog() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif'
        let fileChosen = false
        input.onchange = () => {
          fileChosen = true
          const file = input.files?.[0]
          if (!file) return resolve(null)
          const reader = new FileReader()
          reader.onload = () => resolve({ dataUrl: String(reader.result), name: file.name })
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          reader.readAsDataURL(file)
        }
        // same cancel detection as openDialog: focus returning without a
        // chosen file reads as cancel (slow readers must not lose the race)
        window.addEventListener(
          'focus',
          () =>
            setTimeout(() => {
              if (!fileChosen) resolve(null)
            }, 400),
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

    async saveBinaryDialog(bytes, suggestedName) {
      const ext = suggestedName.split('.').pop()?.toLowerCase()
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'svg'
            ? 'image/svg+xml'
            : 'application/octet-stream'
      // BlobPart requires an ArrayBuffer-backed view — re-wrap the bytes
      const blob = new Blob([new Uint8Array(bytes)], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggestedName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      return suggestedName
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
