import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  PMREMGenerator,
  ACESFilmicToneMapping,
  type BufferGeometry,
  type MeshStandardMaterial,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useThemeStore } from '../theme/themeStore'
import { getDerived, type DerivedRoom } from '../store/derived'
import { useSceneDoc } from './useSceneDoc'
import {
  buildFloorMeshData,
  buildPrismMeshData,
  buildWallFaceMeshData,
  mergeMeshData,
} from './mesh/prismGeometry'
import { toBufferGeometry } from './mesh/toBufferGeometry'
import {
  MAX_POLAR,
  MIN_POLAR,
  fitCameraPose,
  presetPose,
  sceneBBox,
  type CameraPose,
  type CameraPresetKind,
  type SceneBBox,
} from './mesh/fitCamera'
import { useAppSettings } from '../store/appSettings'
import {
  floorMaterial,
  furnitureSlotMaterial,
  itemMaterial,
  sceneMaterial,
  wallFaceMaterial,
} from './sceneMaterials'
import { useArtMaterial } from './artTexture'
import { WalkControls } from './walk/WalkControls'
import { useWalkStore } from './walk/walkStore'
import { getCollisionSet, validateTeleport } from './walk/collision'
import { worldToPlan } from './walk/walkMath'
import { captureAndSave, type CaptureApi } from './screenshot'
import { CATALOG } from '../catalog'
import { realizeItem } from '../catalog/realize'
import type { WallSolid, PatchSolid } from '../geometry/wallSolids'
import type { FurnitureInstance, ProjectDocument, Wall } from '../model/types'
import type { MaterialId } from '../catalog/types'
import { t } from '../i18n'

/**
 * The full 3D view (M4). Plan-pinned behaviors:
 * - frameloop="demand": static scene; OrbitControls self-invalidates;
 *   doc changes reach the scene ONLY via useSceneDoc (latched while hidden);
 *   walk mode (M6) flips the loop to "always" for its whole session;
 * - one <group rotation-x={-π/2}> maps plan→world (the single 3D mapping);
 * - memo keys are the DERIVED ENTRY OBJECTS (reference-stable per entity);
 * - shadow flags per mesh: furniture cast; walls/fixtures cast+receive;
 *   floors/ground receive only;
 * - WebGL creation failure or context loss → banner + "Restart 3D view"
 *   (2D stays fully usable). Dev flag ?failgl=1 forces creation failure.
 */

/**
 * Wall solids → meshes. Unstyled walls (no per-side paint, no finish)
 * collapse to ONE merged geometry with the default paint (single draw
 * call). Styled walls split into ≤3 face buckets: front/back get
 * wallFaceMaterial(paint, finish); trim (end caps, miter slants, jambs,
 * top/bottom caps) keeps the neutral default wallPaint.
 */
function WallMeshes({ solid, wall }: { solid: WallSolid; wall: Wall | undefined }) {
  const paintFront = wall?.paintFront
  const paintBack = wall?.paintBack
  const finishFront = wall?.finishFront
  const finishBack = wall?.finishBack
  const meshes = useMemo(() => {
    const out: { geo: BufferGeometry; material: MeshStandardMaterial }[] = []
    if (
      paintFront === undefined &&
      paintBack === undefined &&
      finishFront === undefined &&
      finishBack === undefined
    ) {
      if (solid.prisms.length) {
        const merged = mergeMeshData(solid.prisms.map((p) => buildPrismMeshData(p)))
        out.push({ geo: toBufferGeometry(merged), material: sceneMaterial('wallPaint') })
      }
      return out
    }
    const faces = buildWallFaceMeshData(solid.prisms)
    if (faces.front) {
      out.push({ geo: toBufferGeometry(faces.front), material: wallFaceMaterial(paintFront, finishFront) })
    }
    if (faces.back) {
      out.push({ geo: toBufferGeometry(faces.back), material: wallFaceMaterial(paintBack, finishBack) })
    }
    if (faces.trim) {
      out.push({ geo: toBufferGeometry(faces.trim), material: sceneMaterial('wallPaint') })
    }
    return out
  }, [solid, paintFront, paintBack, finishFront, finishBack])
  useEffect(() => () => meshes.forEach((m) => m.geo.dispose()), [meshes])
  const angle = Math.atan2(solid.frame.dir.y, solid.frame.dir.x)
  return (
    <group position={[solid.frame.origin.x, solid.frame.origin.y, 0]} rotation={[0, 0, angle]}>
      {meshes.map((m, i) => (
        <mesh key={i} geometry={m.geo} material={m.material} castShadow receiveShadow />
      ))}
    </group>
  )
}

function PatchMesh({ patch }: { patch: PatchSolid }) {
  const geo = useMemo(
    () => toBufferGeometry(buildPrismMeshData({ polygon: patch.polygon, z0: patch.z0, z1: patch.z1 })),
    [patch],
  )
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={sceneMaterial('wallPaint')} castShadow receiveShadow />
}

function FloorMesh({
  room,
  onClick,
}: {
  room: DerivedRoom
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const geo = useMemo(() => toBufferGeometry(buildFloorMeshData(room.floor)), [room])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh
      geometry={geo}
      material={floorMaterial(room.room.floorMaterialId)}
      receiveShadow
      onClick={onClick}
    />
  )
}

/** Door leaves + window glass/frames from the REALIZED intervals. */
function OpeningFixtures({ doc, solid }: { doc: ProjectDocument; solid: WallSolid }) {
  const wall = doc.walls[solid.wallId]
  if (!wall) return null
  const angle = Math.atan2(solid.frame.dir.y, solid.frame.dir.x)
  return (
    <group position={[solid.frame.origin.x, solid.frame.origin.y, 0]} rotation={[0, 0, angle]}>
      {solid.openings.map((op) => {
        const w = op.u1 - op.u0
        const cx = (op.u0 + op.u1) / 2
        if (op.kind === 'door') {
          return (
            <group key={op.openingId}>
              {/* closed leaf centered in the wall, inset from the faces */}
              <mesh position={[cx, 0, (op.z1 - op.z0) / 2]} castShadow receiveShadow material={itemMaterial('woodDark')}>
                <boxGeometry args={[w - 0.04, Math.max(0.04, wall.thickness - 0.02), op.z1 - op.z0 - 0.02]} />
              </mesh>
            </group>
          )
        }
        const h = op.z1 - op.z0
        return (
          <group key={op.openingId} position={[cx, 0, op.z0]}>
            {/* glass */}
            <mesh position={[0, 0, h / 2]} material={itemMaterial('glass')}>
              <boxGeometry args={[w - 0.06, 0.02, h - 0.06]} />
            </mesh>
            {/* frame: simple border strips */}
            <mesh position={[0, 0, 0.025]} castShadow material={itemMaterial('whiteLacquer')}>
              <boxGeometry args={[w, 0.05, 0.05]} />
            </mesh>
            <mesh position={[0, 0, h - 0.025]} castShadow material={itemMaterial('whiteLacquer')}>
              <boxGeometry args={[w, 0.05, 0.05]} />
            </mesh>
            <mesh position={[-(w / 2 - 0.025), 0, h / 2]} castShadow material={itemMaterial('whiteLacquer')}>
              <boxGeometry args={[0.05, 0.05, h]} />
            </mesh>
            <mesh position={[w / 2 - 0.025, 0, h / 2]} castShadow material={itemMaterial('whiteLacquer')}>
              <boxGeometry args={[0.05, 0.05, h]} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function Furniture3D({ f }: { f: FurnitureInstance }) {
  const item = CATALOG[f.catalogItemId]
  const realized = useMemo(
    () => (item ? realizeItem(item, { mirrored: !!f.mirrored }) : null),
    [item, f.mirrored],
  )
  // wall-art image (v6): only image-capable items look the asset up
  const asset = useDocStore((s) =>
    item?.imageSlot && f.assetId ? s.doc.assets[f.assetId] : undefined,
  )
  const artMaterial = useArtMaterial(
    asset,
    item ? { w: item.dims.w, h: item.dims.h } : { w: 1, h: 1 },
  )
  if (!item || !realized) {
    // unknown item: placeholder box of the stored size
    return (
      <mesh
        position={[f.x, f.y, f.elevation + f.size.h / 2]}
        rotation={[0, 0, f.rotation]}
        castShadow
        material={sceneMaterial('ground')}
      >
        <boxGeometry args={[f.size.w, f.size.d, f.size.h]} />
      </mesh>
    )
  }
  const s: [number, number, number] = [
    f.size.w / item.dims.w,
    f.size.d / item.dims.d,
    f.size.h / item.dims.h,
  ]
  return (
    <group position={[f.x, f.y, f.elevation]} rotation={[0, 0, f.rotation]} scale={s}>
      {realized.groups.map((g) => (
        <mesh
          key={g.mat}
          geometry={g.geometry}
          material={
            g.mat === item.imageSlot && artMaterial
              ? artMaterial
              : furnitureSlotMaterial(
                  item.materials[g.mat] as MaterialId,
                  f.materialOverrides?.[g.mat],
                )
          }
          castShadow
        />
      ))}
    </group>
  )
}

/** IBL + shadow-fitted key light + fog + ground, sized by the sceneBBox. */
function SceneEnvironment({
  box,
  onGroundClick,
}: {
  box: SceneBBox
  onGroundClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const { gl, scene } = useThree()
  const theme3d = useThemeStore((s) => s.theme3d)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture
    scene.environmentIntensity = 0.45
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  const groundR = Math.max(30, 3 * box.diag)
  const margin = 2
  return (
    <>
      <hemisphereLight intensity={0.5} color={theme3d.hemiSky} groundColor={theme3d.hemiGround} />
      <ambientLight intensity={0.1} />
      <directionalLight
        position={[box.cx + 0.5 * 30, 30, -box.cy + 0.35 * 30]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-normalBias={0.03}
        shadow-camera-left={-(box.diag / 2 + margin)}
        shadow-camera-right={box.diag / 2 + margin}
        shadow-camera-top={box.diag / 2 + margin}
        shadow-camera-bottom={-(box.diag / 2 + margin)}
        shadow-camera-near={1}
        shadow-camera-far={80}
        target-position={[box.cx, 0, -box.cy]}
      />
      <fog attach="fog" args={[theme3d.fog, 2 * box.diag + 10, 6 * box.diag + 30]} />
      {/* ground disc at z = −1cm (kills floor coplanarity) */}
      <group rotation-x={-Math.PI / 2}>
        <mesh
          position={[box.cx, box.cy, -0.01]}
          receiveShadow
          material={sceneMaterial('ground')}
          onClick={onGroundClick}
        >
          <circleGeometry args={[groundR, 48]} />
        </mesh>
      </group>
    </>
  )
}

/**
 * Retints the cached ground-material singleton on theme flips. Explicit
 * invalidate(): frameloop="demand" and a singleton mutation is invisible to
 * React. Physical wall/floor/item materials and IBL stay theme-independent.
 */
function ThemeBridge3D() {
  const invalidate = useThree((s) => s.invalidate)
  const theme3d = useThemeStore((s) => s.theme3d)
  useEffect(() => {
    sceneMaterial('ground').color.set(theme3d.ground)
    invalidate()
  }, [theme3d, invalidate])
  return null
}

/** Bridge: store → invalidate(), gated by view mode (zero hidden work). */
function InvalidateBridge() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(
    () =>
      useDocStore.subscribe(
        (s) => s.doc,
        () => {
          if (useUiStore.getState().viewMode === '3d') invalidate()
        },
      ),
    [invalidate],
  )
  useEffect(
    () =>
      useUiStore.subscribe(
        (s) => s.viewMode,
        (mode) => {
          if (mode === '3d') invalidate()
        },
      ),
    [invalidate],
  )
  return null
}

/** Exposes {gl, scene, camera} to the overlay's Save-image button. */
function CaptureBridge({ apiRef }: { apiRef: RefObject<CaptureApi | null> }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    apiRef.current = { gl, scene, camera }
    return () => {
      apiRef.current = null
    }
  }, [gl, scene, camera, apiRef])
  return null
}

function ContextGuard({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (e: Event) => {
      e.preventDefault()
      onLost()
    }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [gl, onLost])
  return null
}

/**
 * Applies a requested camera preset imperatively: OrbitControls owns the
 * target + damping, so a preset writes camera.position + controls.target and
 * calls update() — swapping the declarative target prop mid-flight would
 * fight damping/zoomToCursor. Damping inertia is flushed FIRST (a fling's
 * residual velocity would otherwise drift the camera off the preset over the
 * following frames). Pose + target only; the rotation-x mapping group is
 * never involved. `controls` is in the deps: drei registers it a beat after
 * mount, and a preset clicked in that window must apply once it lands (the
 * seq ref keeps it from re-applying afterwards).
 */
function CameraPresetApplier({
  request,
}: {
  request: { pose: CameraPose; seq: number } | null
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as {
    target: { set: (x: number, y: number, z: number) => void }
    update: () => void
    enableDamping: boolean
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const applied = useRef(0)
  useEffect(() => {
    if (!request || !controls || applied.current === request.seq) return
    applied.current = request.seq
    // flush residual inertia: with damping off, update() consumes the whole
    // pending delta at once (against the OLD pose, which we overwrite next)
    const hadDamping = controls.enableDamping
    controls.enableDamping = false
    controls.update()
    camera.position.set(...request.pose.position)
    controls.target.set(...request.pose.target)
    controls.update()
    controls.enableDamping = hadDamping
    invalidate()
  }, [request, controls, camera, invalidate])
  return null
}

/** Persist the one-time orbit hint dismissal (shared by orbit + presets). */
function markOrbitHintSeen() {
  const s = useAppSettings.getState()
  if (!s.orbitHintSeen) s.setOrbitHintSeen(true)
}

export function PlannerCanvas() {
  const doc = useSceneDoc()
  const derived = getDerived(doc)
  const box = useMemo(() => sceneBBox(doc, derived), [doc, derived])
  const pose = useMemo(() => fitCameraPose(box), [box])
  const [presetReq, setPresetReq] = useState<{ pose: CameraPose; seq: number } | null>(null)
  const orbitHintSeen = useAppSettings((s) => s.orbitHintSeen)
  const [glError, setGlError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0) // bump to remount the Canvas
  const failFlag = useRef(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('failgl'),
  )
  const walkMode = useWalkStore((s) => s.mode)
  const walkHint = useWalkStore((s) => s.hint)
  const captureApi = useRef<CaptureApi | null>(null)

  // shared by every floor AND the ground disc — walk-mode click-to-go
  const handleFloorClick = (e: ThreeEvent<MouseEvent>) => {
    const walk = useWalkStore.getState()
    if (walk.mode === 'off') return
    e.stopPropagation() // the ray often hits floor + ground disc — act once
    if (e.delta > 4) return // r3f px-move metric: that was a drag, not a click
    const plan = worldToPlan([e.point.x, e.point.y, e.point.z])
    const ok = validateTeleport(getCollisionSet(doc, derived), plan)
    if (ok) walk.requestWalkTo(ok)
    else walk.setHint(t('view3d.blocked')) // walls or furniture
  }

  const applyPreset = (kind: CameraPresetKind) => {
    markOrbitHintSeen()
    setPresetReq((r) => ({ pose: presetPose(box, kind), seq: (r?.seq ?? 0) + 1 }))
  }

  const hint =
    walkHint ??
    (walkMode === 'arming'
      ? t('view3d.hintArming')
      : walkMode === 'walking'
        ? t('view3d.hintWalking')
        : orbitHintSeen
          ? null
          : t('view3d.hintOrbit'))

  if (glError) {
    return (
      <div className="gl-banner">
        <h3>{t('view3d.glUnavailableTitle')}</h3>
        <p>{glError}</p>
        <p className="hint">
          {t('view3d.glHintBefore')}
          <code> WEBKIT_DISABLE_DMABUF_RENDERER=1</code> {t('view3d.glHintOr')}
          <code> WEBKIT_DISABLE_COMPOSITING_MODE=1</code>.
        </p>
        <button
          type="button"
          onClick={() => {
            setGlError(null)
            setPresetReq(null) // a stale pose must not re-apply on remount
            setEpoch((n) => n + 1)
          }}
        >
          {t('view3d.restart')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="view3d-wrapper"
      style={walkMode === 'arming' ? { cursor: 'crosshair' } : undefined}
    >
      <GlErrorBoundary key={epoch} onError={setGlError}>
        <Canvas
        // r3f v9 re-applies this prop on EVERY Canvas render (root.configure),
        // so it must agree with WalkControls' imperative setFrameloop — a
        // constant "demand" would silently starve the walk loop mid-session.
        frameloop={walkMode === 'walking' ? 'always' : 'demand'}
        shadows
        dpr={[1, 2]}
        camera={{ position: pose.position, fov: 45, near: 0.1, far: 500 }}
        onCreated={({ gl }) => {
          if (failFlag.current) {
            failFlag.current = false
            throw new Error('Forced WebGL failure (?failgl=1)')
          }
          gl.toneMapping = ACESFilmicToneMapping
        }}
      >
        <ContextGuard onLost={() => setGlError(t('view3d.glContextLost'))} />
        <InvalidateBridge />
        <ThemeBridge3D />
        <CaptureBridge apiRef={captureApi} />
        <WalkControls doc={doc} derived={derived} />
        <SceneEnvironment box={box} onGroundClick={handleFloorClick} />
        <OrbitControls
          makeDefault
          enabled={walkMode !== 'walking'}
          enableDamping
          dampingFactor={0.08}
          zoomToCursor
          target={pose.target}
          minDistance={2}
          maxDistance={pose.maxDistance}
          minPolarAngle={MIN_POLAR}
          maxPolarAngle={MAX_POLAR}
          onStart={markOrbitHintSeen}
        />
        <CameraPresetApplier request={presetReq} />
        <group rotation-x={-Math.PI / 2}>
          {Object.values(derived.wallSolids).map((s) => (
            <WallMeshes key={s.wallId} solid={s} wall={doc.walls[s.wallId]} />
          ))}
          {Object.values(derived.wallSolids).map((s) =>
            s.openings.length ? <OpeningFixtures key={`fx-${s.wallId}`} doc={doc} solid={s} /> : null,
          )}
          {derived.patchSolids.map((p) => (
            <PatchMesh key={p.nodeId} patch={p} />
          ))}
          {Object.values(derived.rooms).map((r) => (
            <FloorMesh key={r.roomId} room={r} onClick={handleFloorClick} />
          ))}
          {Object.values(doc.furniture).map((f) => (
            <Furniture3D key={f.id} f={f} />
          ))}
        </group>
      </Canvas>
      </GlErrorBoundary>
      <div className="view3d-controls segmented small">
        {(
          [
            ['top', 'view3d.presetTop', 'view3d.presetTopTitle'],
            ['front', 'view3d.presetFront', 'view3d.presetFrontTitle'],
            ['iso', 'view3d.presetIso', 'view3d.presetIsoTitle'],
            ['reset', 'view3d.presetReset', 'view3d.presetResetTitle'],
          ] as const
        ).map(([kind, label, title]) => (
          <button
            key={kind}
            type="button"
            title={t(title)}
            disabled={walkMode === 'walking'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyPreset(kind)}
          >
            {t(label)}
          </button>
        ))}
        <button
          type="button"
          aria-label={t('view3d.walk')}
          aria-pressed={walkMode !== 'off'}
          className={walkMode !== 'off' ? 'active' : ''}
          title={t('view3d.walkTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const walk = useWalkStore.getState()
            if (walk.mode === 'off') walk.arm()
            else walk.exit()
          }}
        >
          {t('view3d.walk')}
        </button>
        <button
          type="button"
          title={t('view3d.saveImageTitle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const api = captureApi.current
            if (api) void captureAndSave(api, useDocStore.getState().doc.name)
          }}
        >
          {t('view3d.saveImage')}
        </button>
      </div>
      {hint && <div className="status-hint">{hint}</div>}
    </div>
  )
}

/**
 * React error boundary around the Canvas — r3f v9 re-throws context-creation
 * and scene errors into React, so this is the correct catch point.
 * (The Canvas `fallback` prop is img-alt-style content that ALWAYS mounts —
 * using it as a failure signal produced a phantom "WebGL unavailable"
 * banner in the M4 gate.)
 */
class GlErrorBoundary extends Component<
  { onError: (msg: string) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error.message || t('view3d.glCreateFailed'))
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}
