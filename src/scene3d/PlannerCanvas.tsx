import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { PMREMGenerator, ACESFilmicToneMapping } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useThemeStore } from '../theme/themeStore'
import { getDerived, type DerivedRoom } from '../store/derived'
import { useSceneDoc } from './useSceneDoc'
import { buildFloorMeshData, buildPrismMeshData } from './mesh/prismGeometry'
import { toBufferGeometry } from './mesh/toBufferGeometry'
import { fitCameraPose, sceneBBox, type SceneBBox } from './mesh/fitCamera'
import { floorMaterial, itemMaterial, sceneMaterial } from './sceneMaterials'
import { CATALOG } from '../catalog'
import { realizeItem } from '../catalog/realize'
import type { WallSolid, PatchSolid } from '../geometry/wallSolids'
import type { FurnitureInstance, ProjectDocument } from '../model/types'
import type { MaterialId } from '../catalog/types'

/**
 * The full 3D view (M4). Plan-pinned behaviors:
 * - frameloop="demand": static scene; OrbitControls self-invalidates;
 *   doc changes reach the scene ONLY via useSceneDoc (latched while hidden);
 * - one <group rotation-x={-π/2}> maps plan→world (the single 3D mapping);
 * - memo keys are the DERIVED ENTRY OBJECTS (reference-stable per entity);
 * - shadow flags per mesh: furniture cast; walls/fixtures cast+receive;
 *   floors/ground receive only;
 * - WebGL creation failure or context loss → banner + "Restart 3D view"
 *   (2D stays fully usable). Dev flag ?failgl=1 forces creation failure.
 */

function WallMeshes({ solid }: { solid: WallSolid }) {
  const geos = useMemo(
    () => solid.prisms.map((p) => toBufferGeometry(buildPrismMeshData(p))),
    [solid],
  )
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  const angle = Math.atan2(solid.frame.dir.y, solid.frame.dir.x)
  return (
    <group position={[solid.frame.origin.x, solid.frame.origin.y, 0]} rotation={[0, 0, angle]}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={sceneMaterial('wallPaint')} castShadow receiveShadow />
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

function FloorMesh({ room }: { room: DerivedRoom }) {
  const geo = useMemo(() => toBufferGeometry(buildFloorMeshData(room.floor)), [room])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={floorMaterial(room.room.floorMaterialId)} receiveShadow />
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
  const realized = useMemo(() => (item ? realizeItem(item) : null), [item])
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
          material={itemMaterial(item.materials[g.mat] as MaterialId)}
          castShadow
        />
      ))}
    </group>
  )
}

/** IBL + shadow-fitted key light + fog + ground, sized by the sceneBBox. */
function SceneEnvironment({ box }: { box: SceneBBox }) {
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
        <mesh position={[box.cx, box.cy, -0.01]} receiveShadow material={sceneMaterial('ground')}>
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

export function PlannerCanvas() {
  const doc = useSceneDoc()
  const derived = getDerived(doc)
  const box = useMemo(() => sceneBBox(doc, derived), [doc, derived])
  const pose = useMemo(() => fitCameraPose(box), [box])
  const [glError, setGlError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0) // bump to remount the Canvas
  const failFlag = useRef(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('failgl'),
  )

  if (glError) {
    return (
      <div className="gl-banner">
        <h3>3D view unavailable</h3>
        <p>{glError}</p>
        <p className="hint">
          The 2D editor keeps working. If this persists on Linux, try launching with
          <code> WEBKIT_DISABLE_DMABUF_RENDERER=1</code> or
          <code> WEBKIT_DISABLE_COMPOSITING_MODE=1</code>.
        </p>
        <button
          type="button"
          onClick={() => {
            setGlError(null)
            setEpoch((n) => n + 1)
          }}
        >
          Restart 3D view
        </button>
      </div>
    )
  }

  return (
    <div className="view3d-wrapper">
      <GlErrorBoundary key={epoch} onError={setGlError}>
        <Canvas
        frameloop="demand"
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
        <ContextGuard onLost={() => setGlError('The WebGL context was lost (GPU reset or driver issue).')} />
        <InvalidateBridge />
        <ThemeBridge3D />
        <SceneEnvironment box={box} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          zoomToCursor
          target={pose.target}
          minDistance={2}
          maxDistance={pose.maxDistance}
          minPolarAngle={0.1}
          maxPolarAngle={Math.PI / 2 - 0.12}
        />
        <group rotation-x={-Math.PI / 2}>
          {Object.values(derived.wallSolids).map((s) => (
            <WallMeshes key={s.wallId} solid={s} />
          ))}
          {Object.values(derived.wallSolids).map((s) =>
            s.openings.length ? <OpeningFixtures key={`fx-${s.wallId}`} doc={doc} solid={s} /> : null,
          )}
          {derived.patchSolids.map((p) => (
            <PatchMesh key={p.nodeId} patch={p} />
          ))}
          {Object.values(derived.rooms).map((r) => (
            <FloorMesh key={r.roomId} room={r} />
          ))}
          {Object.values(doc.furniture).map((f) => (
            <Furniture3D key={f.id} f={f} />
          ))}
        </group>
      </Canvas>
      </GlErrorBoundary>
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
    this.props.onError(error.message || 'The WebGL context could not be created.')
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}
