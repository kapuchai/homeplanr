import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { realizeItem } from './realize'
import type { CatalogItem } from './types'

/**
 * Isometric catalog thumbnails — one 256×256 transparent PNG data-URL per
 * item, rendered lazily through a SINGLE shared WebGLRenderer and cached
 * for the app lifetime. After the last warmup item the renderer is disposed
 * and the pipeline dropped (steady state: zero extra GL contexts; the
 * data-URLs are plain strings and stay valid).
 *
 * Everything except the renderer factory is CPU-only (realizeItem +
 * three.js math), so buildThumbScene/frameOrtho run under vitest's node
 * environment; tests inject a fake renderer via
 * __setRendererFactoryForTests.
 *
 * Failure latch: if the factory throws (no WebGL, no DOM) or the context is
 * lost, thumbnails are off for good — getThumbnail returns null forever and
 * the cards fall back to their derived SVG symbols.
 */

const SIZE = 256
const AZIMUTH = Math.PI / 4 // 45°
const ELEVATION = Math.PI / 6 // 30°
const MARGIN = 0.05
const CHUNK = 3 // items per idle slice

/** The renderer surface this module uses — WebGLRenderer or a test fake. */
export interface ThumbRendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void
  setClearColor(color: number, alpha?: number): void
  render(scene: Scene, camera: OrthographicCamera): void
  dispose(): void
  domElement: {
    toDataURL(type?: string): string
    addEventListener(type: string, listener: () => void): void
  }
  outputColorSpace: string
  toneMapping: number
}

type RendererFactory = () => ThumbRendererLike

let rendererFactory: RendererFactory | null = null
let renderer: ThumbRendererLike | null = null
let failed = false
const thumbs = new Map<string, string>()
let queue: Promise<void> = Promise.resolve()

/** Test hook: swap the renderer factory and reset pipeline, latch, cache. */
export function __setRendererFactoryForTests(fn: RendererFactory | null): void {
  rendererFactory = fn
  renderer = null
  failed = false
  thumbs.clear()
}

function defaultFactory(): ThumbRendererLike {
  return new WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: true,
    antialias: true,
  })
}

function acquireRenderer(): ThumbRendererLike | null {
  if (failed) return null
  if (renderer) return renderer
  try {
    const r = (rendererFactory ?? defaultFactory)()
    r.setSize(SIZE, SIZE, false)
    r.setClearColor(0x000000, 0)
    r.outputColorSpace = SRGBColorSpace
    r.toneMapping = NoToneMapping
    r.domElement.addEventListener('webglcontextlost', () => {
      failed = true
    })
    renderer = r
    return r
  } catch {
    failed = true
    return null
  }
}

function disposePipeline(): void {
  if (!renderer) return
  try {
    renderer.dispose()
  } catch {
    // dispose failures don't matter — the pipeline is gone either way
  }
  renderer = null
}

/** ONE neutral override material shared by every thumbnail mesh (glass
 *  slots too — the uniform matte-white look reads better at 64px). */
let neutral: MeshStandardMaterial | null = null
function neutralMaterial(): MeshStandardMaterial {
  neutral ??= new MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.85, metalness: 0 })
  return neutral
}

/**
 * Assemble the thumbnail scene for an item — CPU-only (realizeItem
 * geometries are shared module-cached singletons; NEVER disposed here).
 * root carries the plan→world rotation (item z-up → scene y-up).
 */
export function buildThumbScene(item: CatalogItem): { scene: Scene; root: Group } {
  const scene = new Scene()
  const root = new Group()
  root.rotation.x = -Math.PI / 2
  const mat = neutralMaterial()
  for (const group of realizeItem(item).groups) {
    root.add(new Mesh(group.geometry, mat))
  }
  scene.add(root)
  scene.add(new HemisphereLight(0xffffff, 0xcfcfcf, 1.0))
  const key = new DirectionalLight(0xffffff, 1.15)
  key.position.set(2, 3, 4).normalize()
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, 0.35)
  fill.position.set(-2, 1, -1).normalize()
  scene.add(fill)
  return { scene, root }
}

export interface OrthoFrame {
  position: Vector3
  left: number
  right: number
  top: number
  bottom: number
  near: number
  far: number
}

/**
 * PURE ortho framing: place the camera along the view direction
 * dir = (cos e·cos a, sin e, cos e·sin a), project the 8 bbox corners onto
 * the camera's right/up/forward axes (lookAt basis with world up +y), and
 * fit a SQUARE frustum (the canvas is square) around the projection.
 * `margin` is a fraction of the larger projected span, padded per side.
 */
export function frameOrtho(
  box: Box3,
  azimuthRad: number,
  elevationRad: number,
  margin = MARGIN,
): OrthoFrame {
  const dir = new Vector3(
    Math.cos(elevationRad) * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    Math.cos(elevationRad) * Math.sin(azimuthRad),
  )
  const center = box.getCenter(new Vector3())
  const distance = box.getSize(new Vector3()).length() + 1
  const position = center.clone().addScaledVector(dir, distance)
  const forward = dir.clone().negate()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward)

  let minR = Infinity
  let maxR = -Infinity
  let minU = Infinity
  let maxU = -Infinity
  let minF = Infinity
  let maxF = -Infinity
  const corner = new Vector3()
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      )
      .sub(position)
    const r = corner.dot(right)
    const u = corner.dot(up)
    const f = corner.dot(forward)
    minR = Math.min(minR, r)
    maxR = Math.max(maxR, r)
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minF = Math.min(minF, f)
    maxF = Math.max(maxF, f)
  }

  const span = Math.max(maxR - minR, maxU - minU, 1e-3)
  const pad = margin * span
  const half = span / 2 + pad
  const cR = (minR + maxR) / 2
  const cU = (minU + maxU) / 2
  return {
    position,
    left: cR - half,
    right: cR + half,
    top: cU + half,
    bottom: cU - half,
    near: minF - pad,
    far: maxF + pad,
  }
}

function renderOne(item: CatalogItem): void {
  if (failed || thumbs.has(item.id)) return
  const r = acquireRenderer()
  if (!r) return
  try {
    const { scene, root } = buildThumbScene(item)
    const box = new Box3().setFromObject(root)
    const f = frameOrtho(box, AZIMUTH, ELEVATION, MARGIN)
    const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far)
    camera.position.copy(f.position)
    camera.lookAt(box.getCenter(new Vector3()))
    camera.updateMatrixWorld(true)
    r.render(scene, camera)
    thumbs.set(item.id, r.domElement.toDataURL('image/png'))
  } catch {
    failed = true
  }
}

/** Cached thumbnail data-URL, or null (not rendered yet / pipeline failed). */
export function getThumbnail(item: CatalogItem): string | null {
  if (failed) return null
  return thumbs.get(item.id) ?? null
}

const idleSlice: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => {
        requestIdleCallback(() => cb())
      }
    : (cb) => {
        setTimeout(cb, 0)
      }

function runBatch(
  items: readonly CatalogItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const total = items.length
    if (total === 0) {
      resolve()
      return
    }
    let index = 0
    const step = () => {
      const end = Math.min(index + CHUNK, total)
      for (; index < end; index++) renderOne(items[index]!)
      onProgress?.(index, total)
      if (index < total) {
        idleSlice(step)
      } else {
        // last warmup item done — drop the GL pipeline; data-URLs stay valid
        disposePipeline()
        resolve()
      }
    }
    idleSlice(step)
  })
}

/**
 * Warm the cache for `items`, 2–3 per idle slice; onProgress(done, total)
 * after each slice (monotonic). Batches are serialized; never rejects.
 */
export function ensureThumbnails(
  items: readonly CatalogItem[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const run = queue.then(() => runBatch(items, onProgress))
  queue = run
  return run
}
