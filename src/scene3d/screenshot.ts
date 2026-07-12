import type { Camera, Scene, WebGLRenderer } from 'three'
import { usePersistStore } from '../store/persistence/controller'

/**
 * 3D view → PNG through the storage adapter (native save dialog on Tauri,
 * download in the browser). preserveDrawingBuffer stays FALSE: the draw
 * buffer only survives until the browser composites, so render and read
 * MUST happen in the same task — toBlob captures the bitmap synchronously
 * at call time (only the encoding is async), which keeps the await safe.
 */
export interface CaptureApi {
  gl: WebGLRenderer
  scene: Scene
  camera: Camera
}

const sanitizeFileName = (name: string): string =>
  name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'floorplan'

export async function captureAndSave(api: CaptureApi, projectName: string): Promise<void> {
  const { adapter } = usePersistStore.getState()
  try {
    api.gl.render(api.scene, api.camera)
    const blob = await new Promise<Blob | null>((resolve) =>
      api.gl.domElement.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('The canvas produced no image data.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await adapter.saveBinaryDialog(bytes, `${sanitizeFileName(projectName)}.png`, {
      name: 'PNG image',
      extensions: ['png'],
    })
  } catch (err) {
    await adapter.message('Screenshot failed', String(err))
  }
}
