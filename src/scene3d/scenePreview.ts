import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import type { LevelDoc } from '../model/types'
import type { DerivedGeometry } from '../store/derived'
import { CATALOG } from '../catalog'
import { realizeItem } from '../catalog/realize'
import type { MaterialId } from '../catalog/types'
import { frameOrtho } from '../catalog/thumbnails'
import { getTheme3d } from '../theme/theme3d'
import {
  buildFloorMeshData,
  buildPrismMeshData,
  buildWallFaceMeshData,
  mergeMeshData,
} from './mesh/prismGeometry'
import { toBufferGeometry } from './mesh/toBufferGeometry'
import {
  floorMaterial,
  furnitureSlotMaterial,
  sceneMaterial,
  wallFaceMaterial,
} from './sceneMaterials'

/**
 * Save-preview renderer (0.11.0 M6): a top-down ortho JPEG of the whole
 * scene, assembled imperatively from the SAME builders the live canvas
 * uses (wall solids, patches, floors, realized furniture) — no r3f, no
 * mounted 3D view required. thumbnails.ts is the template: injected
 * renderer factory as the test seam, failure LATCH (a save must never
 * block on GL — first failure turns previews off for the session), and
 * frameOrtho for the fit. Differences: 512² JPEG needs an OPAQUE clear
 * (fixed light-theme canvasBg so previews read in both dialog themes),
 * and the renderer is TRANSIENT — created and disposed per render, so
 * the one-persistent-context invariant holds.
 *
 * Deliberately excluded: ceilings (top-down would show nothing else),
 * opening fixtures and wall-art textures (r3f-only components/hooks —
 * image slots fall back to their default slot material).
 */

export const PREVIEW_SIZE = 512
/** Top preset orientation (fitCamera presetPose): azimuth −90°, near-
 * vertical elevation — straight-down breaks frameOrtho's +y-up basis. */
const PREVIEW_AZIMUTH = -Math.PI / 2
const PREVIEW_ELEVATION = Math.PI / 2 - 0.12
const PREVIEW_MARGIN = 0.06
const PREVIEW_JPEG_QUALITY = 0.85

/** Renderer surface — WebGLRenderer or a test fake (JPEG needs quality). */
export interface PreviewRendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void
  setClearColor(color: number, alpha?: number): void
  render(scene: Scene, camera: OrthographicCamera): void
  dispose(): void
  domElement: { toDataURL(type?: string, quality?: number): string }
  outputColorSpace: string
  toneMapping: number
}

type RendererFactory = () => PreviewRendererLike

let rendererFactory: RendererFactory | null = null
let failed = false

/** Test hook: swap the renderer factory and reset the failure latch. */
export function __setPreviewRendererFactoryForTests(fn: RendererFactory | null): void {
  rendererFactory = fn
  failed = false
}

function defaultFactory(): PreviewRendererLike {
  return new WebGLRenderer({
    canvas: document.createElement('canvas'),
    alpha: false,
    antialias: true,
  })
}

/**
 * Assemble the preview scene — CPU-only (runs under vitest's node env).
 * `dispose` frees ONLY the geometries built here: realizeItem geometries
 * are shared module-cached singletons and all materials are the app-wide
 * sceneMaterials caches.
 */
export function buildPreviewScene(
  doc: LevelDoc,
  derived: DerivedGeometry,
): { scene: Scene; root: Group; dispose: () => void } {
  const scene = new Scene()
  const root = new Group()
  root.rotation.x = -Math.PI / 2 // the one plan→world mapping
  scene.add(root)
  const owned: BufferGeometry[] = []
  const own = (geo: BufferGeometry): BufferGeometry => {
    owned.push(geo)
    return geo
  }

  // walls — WallMeshes' bucketing: unstyled merge, styled front/back/trim
  for (const s of Object.values(derived.wallSolids)) {
    const wall = doc.walls[s.wallId]
    const group = new Group()
    group.position.set(s.frame.origin.x, s.frame.origin.y, 0)
    group.rotation.z = Math.atan2(s.frame.dir.y, s.frame.dir.x)
    const unstyled =
      wall?.paintFront === undefined &&
      wall?.paintBack === undefined &&
      wall?.finishFront === undefined &&
      wall?.finishBack === undefined
    if (unstyled) {
      if (s.prisms.length) {
        const merged = mergeMeshData(s.prisms.map((p) => buildPrismMeshData(p)))
        group.add(new Mesh(own(toBufferGeometry(merged)), sceneMaterial('wallPaint')))
      }
    } else {
      const faces = buildWallFaceMeshData(s.prisms)
      if (faces.front) {
        group.add(
          new Mesh(
            own(toBufferGeometry(faces.front)),
            wallFaceMaterial(wall?.paintFront, wall?.finishFront),
          ),
        )
      }
      if (faces.back) {
        group.add(
          new Mesh(
            own(toBufferGeometry(faces.back)),
            wallFaceMaterial(wall?.paintBack, wall?.finishBack),
          ),
        )
      }
      if (faces.trim) {
        group.add(new Mesh(own(toBufferGeometry(faces.trim)), sceneMaterial('wallPaint')))
      }
    }
    root.add(group)
  }

  // patches (junction infill) + floors — both already in plan coords
  for (const p of derived.patchSolids) {
    root.add(
      new Mesh(
        own(toBufferGeometry(buildPrismMeshData({ polygon: p.polygon, z0: p.z0, z1: p.z1 }))),
        sceneMaterial('wallPaint'),
      ),
    )
  }
  for (const r of Object.values(derived.rooms)) {
    root.add(
      new Mesh(own(toBufferGeometry(buildFloorMeshData(r.floor))), floorMaterial(r.room.floorMaterialId)),
    )
  }

  // furniture — Furniture3D minus the r3f-only art texture
  for (const f of Object.values(doc.furniture)) {
    const item = CATALOG[f.catalogItemId]
    if (!item) {
      const mesh = new Mesh(own(new BoxGeometry(f.size.w, f.size.d, f.size.h)), sceneMaterial('ground'))
      mesh.position.set(f.x, f.y, f.elevation + f.size.h / 2)
      mesh.rotation.z = f.rotation
      root.add(mesh)
      continue
    }
    const group = new Group()
    group.position.set(f.x, f.y, f.elevation)
    group.rotation.z = f.rotation
    group.scale.set(f.size.w / item.dims.w, f.size.d / item.dims.d, f.size.h / item.dims.h)
    for (const g of realizeItem(item, { mirrored: !!f.mirrored }).groups) {
      group.add(
        new Mesh(
          g.geometry,
          furnitureSlotMaterial(item.materials[g.mat] as MaterialId, f.materialOverrides?.[g.mat]),
        ),
      )
    }
    root.add(group)
  }

  // the thumbnail light rig — neutral and theme-independent
  scene.add(new HemisphereLight(0xffffff, 0xcfcfcf, 1.0))
  const key = new DirectionalLight(0xffffff, 1.15)
  key.position.set(2, 3, 4).normalize()
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, 0.35)
  fill.position.set(-2, 1, -1).normalize()
  scene.add(fill)

  return { scene, root, dispose: () => owned.forEach((g) => g.dispose()) }
}

export interface ScenePreview {
  dataUrl: string
  w: number
  h: number
}

/**
 * Render the top-down preview, or null when there is nothing to show
 * (empty scene) or the pipeline is latched off. NEVER throws.
 */
export function renderScenePreview(
  doc: LevelDoc,
  derived: DerivedGeometry,
): ScenePreview | null {
  if (failed) return null
  let r: PreviewRendererLike | null = null
  let built: ReturnType<typeof buildPreviewScene> | null = null
  try {
    built = buildPreviewScene(doc, derived)
    const box = new Box3().setFromObject(built.root)
    if (box.isEmpty()) return null // empty doc — nothing to preview
    r = (rendererFactory ?? defaultFactory)()
    r.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false)
    r.setClearColor(new Color(getTheme3d('light').canvasBg).getHex(), 1)
    r.outputColorSpace = SRGBColorSpace
    r.toneMapping = NoToneMapping
    const f = frameOrtho(box, PREVIEW_AZIMUTH, PREVIEW_ELEVATION, PREVIEW_MARGIN)
    const camera = new OrthographicCamera(f.left, f.right, f.top, f.bottom, f.near, f.far)
    camera.position.copy(f.position)
    camera.lookAt(box.getCenter(new Vector3()))
    camera.updateMatrixWorld(true)
    r.render(built.scene, camera)
    const dataUrl = r.domElement.toDataURL('image/jpeg', PREVIEW_JPEG_QUALITY)
    return { dataUrl, w: PREVIEW_SIZE, h: PREVIEW_SIZE }
  } catch {
    failed = true // GL is unwell — never let a save trip on it again
    return null
  } finally {
    built?.dispose()
    try {
      r?.dispose() // transient context — the one-persistent-context rule
    } catch {
      // disposal failures don't matter — the context is gone either way
    }
  }
}
