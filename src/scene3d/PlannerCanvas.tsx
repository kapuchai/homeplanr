import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  PMREMGenerator,
  ACESFilmicToneMapping,
  Shape,
  type BufferGeometry,
  type MeshStandardMaterial,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { useThemeStore } from '../theme/themeStore'
import { getDerived, type DerivedGeometry, type DerivedRoom } from '../store/derived'
import { useSceneDoc } from './useSceneDoc'
import {
  buildCeilingMeshData,
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
import { attemptLock } from './walk/pointerLock'
import { getCollisionSet, validateTeleport } from './walk/collision'
import { worldToPlan } from './walk/walkMath'
import { hiddenWallIds, sameWallSet } from './wallOcclusion'
import type { WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import { captureAndSave, type CaptureApi } from './screenshot'
import { CATALOG } from '../catalog'
import { realizeItem } from '../catalog/realize'
import type { WallSolid, PatchSolid, RealizedOpening } from '../geometry/wallSolids'
import { openingStyleSpec } from '../catalog/openingStyles'
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
function WallMeshes({
  solid,
  wall,
  visible = true,
}: {
  solid: WallSolid
  wall: Wall | undefined
  /** Occluder verdict (M3) — false keeps the meshes mounted but skips
   * render AND shadow casting; geometry survives for flicker-free undo. */
  visible?: boolean
}) {
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
    <group
      position={[solid.frame.origin.x, solid.frame.origin.y, 0]}
      rotation={[0, 0, angle]}
      visible={visible}
    >
      {meshes.map((m, i) => (
        <mesh key={i} geometry={m.geo} material={m.material} castShadow receiveShadow />
      ))}
    </group>
  )
}

function PatchMesh({ patch, visible = true }: { patch: PatchSolid; visible?: boolean }) {
  const geo = useMemo(
    () => toBufferGeometry(buildPrismMeshData({ polygon: patch.polygon, z0: patch.z0, z1: patch.z1 })),
    [patch],
  )
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh
      geometry={geo}
      material={sceneMaterial('wallPaint')}
      castShadow
      receiveShadow
      visible={visible}
    />
  )
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

/**
 * Per-room ceiling slab (0.11.0) at the room's lowest wall height.
 * Single-sided facing DOWN — backface-culled from above, so top and
 * high-orbit views see into rooms with zero occluder logic while walk
 * mode gets a ceiling. castShadow stays false BY DESIGN: hemisphere/
 * ambient/IBL are unshadowed in three.js, so only the directional
 * caster could darken a covered room — an uncasting ceiling keeps
 * interiors exactly as bright as today (revisit with 0.12.0 lighting).
 */
function CeilingMesh({ room, z }: { room: DerivedRoom; z: number }) {
  const geo = useMemo(() => toBufferGeometry(buildCeilingMeshData(room.floor, z)), [room, z])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={sceneMaterial('ceiling')} />
}

/** Window/door frame strip thickness (m). */
const FRAME = 0.05
/** Interior mullion pitch for panorama windows (m). */
const MULLION_PITCH = 0.9

/**
 * One window in the wall-local frame (x = along wall, y = +perp = front,
 * z = up), group already at (center-u, 0, z0). Style-dispatched (0.10.0):
 * standard/fullheight = glass + 4 border strips (fullheight differs only
 * by its carved extents); panorama adds interior mullions; arched keeps
 * the RECTANGULAR carve and renders an elliptical arch frame + wall-toned
 * spandrel band inside it (the honest v1 arch — see the release file).
 */
function WindowFixture({ op, wall, style }: { op: RealizedOpening; wall: Wall; style: string }) {
  const w = op.u1 - op.u0
  const h = op.z1 - op.z0
  const arched = style === 'arched'
  // arch: rise capped so wide/short windows get a segmental (elliptical)
  // arch; 0.02 of band above the peak avoids a degenerate touch point
  const rise = arched ? Math.min(w / 2, h * 0.45) : 0
  const ry = Math.max(rise - 0.02, 0.05)
  const springH = h - rise
  const spandrel = useMemo(() => {
    if (!arched) return null
    const s = new Shape()
    s.moveTo(-w / 2, 0)
    for (let i = 1; i <= 24; i++) {
      const th = Math.PI - (Math.PI * i) / 24
      s.lineTo((w / 2 - FRAME / 2) * Math.cos(th), ry * Math.sin(th))
    }
    s.lineTo(w / 2, 0)
    s.lineTo(w / 2, rise)
    s.lineTo(-w / 2, rise)
    s.closePath()
    return s
  }, [arched, w, rise, ry])
  const mullions = style === 'panorama' ? Math.max(1, Math.ceil(w / MULLION_PITCH) - 1) : 0
  const sideH = arched ? springH : h
  return (
    <>
      {/* glass */}
      <mesh position={[0, 0, h / 2]} material={itemMaterial('glass')}>
        <boxGeometry args={[w - 0.06, 0.02, h - 0.06]} />
      </mesh>
      {/* frame: bottom + side strips (sides stop at the spring line when arched) */}
      <mesh position={[0, 0, FRAME / 2]} castShadow material={itemMaterial('whiteLacquer')}>
        <boxGeometry args={[w, FRAME, FRAME]} />
      </mesh>
      <mesh
        position={[-(w / 2 - FRAME / 2), 0, sideH / 2]}
        castShadow
        material={itemMaterial('whiteLacquer')}
      >
        <boxGeometry args={[FRAME, FRAME, sideH]} />
      </mesh>
      <mesh
        position={[w / 2 - FRAME / 2, 0, sideH / 2]}
        castShadow
        material={itemMaterial('whiteLacquer')}
      >
        <boxGeometry args={[FRAME, FRAME, sideH]} />
      </mesh>
      {arched ? (
        <>
          {/* elliptical arch frame: torus scaled vertically BEFORE the
              rotation into the wall plane (three applies R·S) */}
          <mesh
            position={[0, 0, springH]}
            rotation-x={Math.PI / 2}
            scale={[1, ry / (w / 2 - FRAME / 2), 1]}
            castShadow
            material={itemMaterial('whiteLacquer')}
          >
            <torusGeometry args={[w / 2 - FRAME / 2, FRAME / 2, 12, 32, Math.PI]} />
          </mesh>
          {/* wall-toned spandrel band filling the rect carve above the arch */}
          {spandrel && (
            <mesh
              position={[0, (wall.thickness - 0.02) / 2, springH]}
              rotation-x={Math.PI / 2}
              material={sceneMaterial('wallPaint')}
            >
              <extrudeGeometry
                args={[spandrel, { depth: wall.thickness - 0.02, bevelEnabled: false }]}
              />
            </mesh>
          )}
        </>
      ) : (
        <mesh position={[0, 0, h - FRAME / 2]} castShadow material={itemMaterial('whiteLacquer')}>
          <boxGeometry args={[w, FRAME, FRAME]} />
        </mesh>
      )}
      {/* panorama: interior mullions at an even pitch */}
      {Array.from({ length: mullions }, (_, i) => (
        <mesh
          key={i}
          position={[-w / 2 + ((i + 1) * w) / (mullions + 1), 0, h / 2]}
          castShadow
          material={itemMaterial('whiteLacquer')}
        >
          <boxGeometry args={[FRAME, FRAME, h - 0.06]} />
        </mesh>
      ))}
    </>
  )
}

/** Door leaf thickness (m) — a real leaf, no longer the wall-filling slab. */
const LEAF_T = 0.05
/**
 * Ajar angle (~75% of a full 90° swing — the release decision). The
 * rotation sign MUST mirror the 2D doorGlyph semantics (front ≡ +perp,
 * empirically pinned): fully open, the leaf points toward swingSign·y from
 * the hinge jamb, so φ = dirSign·swingSign·θ with dirSign +1 at hinge 'a'
 * (closed leaf points +x) and −1 at hinge 'b' (closed leaf points −x).
 * Verified against the 2D arcs for all four hinge/swing combos ×
 * both wall directions (the 0.10.0 checklist matrix).
 */
const AJAR = 0.75 * (Math.PI / 2)
/** Sliding door: fraction of the gap the leaf stands open. */
const SLID = 0.35
/** Garage door: target slat pitch (m). */
const SLAT = 0.35

/**
 * One door in the wall-local frame, rendered at absolute u coordinates
 * (the pivot lives at a jamb, not the gap center). Style-dispatched
 * (0.10.0): standard/balcony hang an ajar leaf at the hinge jamb (balcony
 * = glazed leaf); double hangs two mirrored half-leaves; sliding mounts a
 * barn-style panel on the swing-side face, parked toward the hinge end
 * (matching the 2D active panel); garage stacks slats across the gap;
 * passage renders nothing. All leaves are VISUAL ONLY — walk collision
 * reads realized door intervals and never sees these meshes.
 */
function DoorFixture({
  op,
  wall,
  style,
  hinge,
  swing,
}: {
  op: RealizedOpening
  wall: Wall
  style: string
  hinge: 'a' | 'b'
  swing: 'front' | 'back'
}) {
  const w = op.u1 - op.u0
  const h = op.z1 - op.z0
  const dirSign = hinge === 'a' ? 1 : -1
  const swingSign = swing === 'front' ? 1 : -1
  const hingeU = hinge === 'a' ? op.u0 : op.u1

  if (style === 'passage') return null

  if (style === 'sliding') {
    const slideSign = -dirSign // parked past the hinge jamb
    const panelX = (op.u0 + op.u1) / 2 + slideSign * SLID * w
    const faceY = swingSign * (wall.thickness / 2 + 0.03)
    return (
      <>
        <mesh position={[panelX, faceY, h / 2]} castShadow receiveShadow material={itemMaterial('woodDark')}>
          <boxGeometry args={[w, 0.04, h - 0.02]} />
        </mesh>
        {/* overhead track spanning the closed + parked travel */}
        <mesh
          position={[(op.u0 + op.u1) / 2 + slideSign * ((SLID / 2) * w), faceY, h + 0.03]}
          material={itemMaterial('metalDark')}
        >
          <boxGeometry args={[w * (1 + SLID), 0.05, 0.05]} />
        </mesh>
      </>
    )
  }

  if (style === 'garage') {
    const slats = Math.max(2, Math.ceil(h / SLAT))
    const slatH = h / slats
    return (
      <>
        {Array.from({ length: slats }, (_, i) => (
          <mesh
            key={i}
            position={[(op.u0 + op.u1) / 2, 0, (i + 0.5) * slatH]}
            castShadow
            receiveShadow
            material={itemMaterial('metal')}
          >
            <boxGeometry args={[w - 0.04, 0.05, slatH - 0.015]} />
          </mesh>
        ))}
      </>
    )
  }

  // leaves hinge at the swing-side FACE (like the 2D glyph's jamb corner
  // and a physical hinge), inset by half the leaf thickness
  const faceY = swingSign * (wall.thickness / 2 - LEAF_T / 2)

  if (style === 'double') {
    const half = w / 2
    return (
      <>
        {/* left leaf hinged at u0, right at u1 — mirrored ajar */}
        <group position={[op.u0, faceY, 0]} rotation={[0, 0, swingSign * AJAR]}>
          <mesh position={[(half - 0.02) / 2, 0, h / 2]} castShadow receiveShadow material={itemMaterial('woodDark')}>
            <boxGeometry args={[half - 0.02, LEAF_T, h - 0.02]} />
          </mesh>
        </group>
        <group position={[op.u1, faceY, 0]} rotation={[0, 0, -swingSign * AJAR]}>
          <mesh position={[-(half - 0.02) / 2, 0, h / 2]} castShadow receiveShadow material={itemMaterial('woodDark')}>
            <boxGeometry args={[half - 0.02, LEAF_T, h - 0.02]} />
          </mesh>
        </group>
      </>
    )
  }

  // standard + balcony: one ajar leaf pivoted at the hinge jamb
  const leafW = w - 0.02
  const leafCx = (dirSign * leafW) / 2
  const glazed = style === 'balcony'
  return (
    <group position={[hingeU, faceY, 0]} rotation={[0, 0, dirSign * swingSign * AJAR]}>
      {glazed ? (
        <>
          {/* glazed balcony leaf: frame strips + glass */}
          <mesh position={[leafCx, 0, 0.04]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[leafW, LEAF_T, 0.08]} />
          </mesh>
          <mesh position={[leafCx, 0, h - 0.05]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[leafW, LEAF_T, 0.08]} />
          </mesh>
          <mesh position={[dirSign * 0.04, 0, h / 2]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[0.08, LEAF_T, h - 0.02]} />
          </mesh>
          <mesh position={[dirSign * (leafW - 0.04), 0, h / 2]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[0.08, LEAF_T, h - 0.02]} />
          </mesh>
          <mesh position={[leafCx, 0, h / 2]} material={itemMaterial('glass')}>
            <boxGeometry args={[leafW - 0.1, 0.02, h - 0.15]} />
          </mesh>
        </>
      ) : (
        <mesh position={[leafCx, 0, h / 2]} castShadow receiveShadow material={itemMaterial('woodDark')}>
          <boxGeometry args={[leafW, LEAF_T, h - 0.02]} />
        </mesh>
      )}
    </group>
  )
}

/** Door leaves + window glass/frames from the REALIZED intervals. */
function OpeningFixtures({
  doc,
  solid,
  visible = true,
}: {
  doc: ProjectDocument
  solid: WallSolid
  /** Follows the wall's occluder verdict — a hidden wall's fixtures
   * must not float in the opening it no longer carves visibly. */
  visible?: boolean
}) {
  const wall = doc.walls[solid.wallId]
  if (!wall) return null
  const angle = Math.atan2(solid.frame.dir.y, solid.frame.dir.x)
  return (
    <group
      position={[solid.frame.origin.x, solid.frame.origin.y, 0]}
      rotation={[0, 0, angle]}
      visible={visible}
    >
      {solid.openings.map((op) => {
        const cx = (op.u0 + op.u1) / 2
        const model = doc.openings[op.openingId]
        const style = openingStyleSpec(op.kind, model?.style).id
        if (op.kind === 'door') {
          const door = model?.kind === 'door' ? model : undefined
          return (
            <group key={op.openingId}>
              <DoorFixture
                op={op}
                wall={wall}
                style={style}
                hinge={door?.hinge ?? 'a'}
                swing={door?.swing ?? 'front'}
              />
            </group>
          )
        }
        return (
          <group key={op.openingId} position={[cx, 0, op.z0]}>
            <WindowFixture op={op} wall={wall} style={style} />
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

/** Orbit-change throttle for the wall occluder (ms). */
const OCCLUDER_THROTTLE_MS = 80

/**
 * Bridge: orbit-camera movement → occluder recompute → hidden-wall set
 * (state up in PlannerCanvas) → invalidate. The recompute also runs on
 * mount and whenever geometry/anchor/enabled change, so toggling the
 * pref or entering walk mode restores every wall immediately.
 */
function OccluderBridge({
  derived,
  anchor,
  enabled,
  onHidden,
}: {
  derived: DerivedGeometry
  anchor: Vec2
  enabled: boolean
  onHidden: (ids: Set<WallId>) => void
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as {
    addEventListener?: (type: string, fn: () => void) => void
    removeEventListener?: (type: string, fn: () => void) => void
  } | null
  const invalidate = useThree((s) => s.invalidate)
  const prev = useRef<Set<WallId>>(new Set())
  useEffect(() => {
    const recompute = () => {
      const next = enabled
        ? hiddenWallIds(
            worldToPlan([camera.position.x, camera.position.y, camera.position.z]),
            anchor,
            Object.values(derived.wallSolids),
          )
        : new Set<WallId>()
      if (!sameWallSet(prev.current, next)) {
        prev.current = next
        onHidden(next)
        invalidate()
      }
    }
    let last = 0
    let timer: number | null = null
    const onOrbitChange = () => {
      const now = performance.now()
      if (now - last >= OCCLUDER_THROTTLE_MS) {
        last = now
        recompute()
      } else if (timer === null) {
        // trailing edge — the final camera pose must always settle
        timer = window.setTimeout(() => {
          timer = null
          last = performance.now()
          recompute()
        }, OCCLUDER_THROTTLE_MS)
      }
    }
    recompute()
    controls?.addEventListener?.('change', onOrbitChange)
    return () => {
      controls?.removeEventListener?.('change', onOrbitChange)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [camera, controls, derived, anchor, enabled, onHidden, invalidate])
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
  const walkLocked = useWalkStore((s) => s.locked)
  const captureApi = useRef<CaptureApi | null>(null)
  const wallHideMode = useAppSettings((s) => s.wallHideMode)
  const [hiddenWalls, setHiddenWalls] = useState<Set<WallId>>(() => new Set())
  const occluderAnchor = useMemo(() => ({ x: box.cx, y: box.cy }), [box])
  // node → incident walls, for the patch-follows-walls occluder rule: a
  // junction pillar hides only when EVERY wall it bridges is hidden
  // (else a visible wall's end would lose its cap and show a notch)
  const nodeWalls = useMemo(() => {
    const map = new Map<string, WallId[]>()
    for (const w of Object.values(doc.walls)) {
      for (const n of [w.a, w.b]) {
        const list = map.get(n)
        if (list) list.push(w.id)
        else map.set(n, [w.id])
      }
    }
    return map
  }, [doc.walls])
  const patchHidden = (nodeId: string): boolean => {
    const incident = nodeWalls.get(nodeId)
    return !!incident && incident.length > 0 && incident.every((id) => hiddenWalls.has(id))
  }
  const ceilingsEnabled = useAppSettings((s) => s.ceilingsEnabled)
  // ceiling height = the room's LOWEST wall (the patch precedent: mixed
  // heights get the safe minimum; degenerate cycles fall back to default)
  const ceilingZ = (room: DerivedRoom): number => {
    let h = Infinity
    for (const wid of room.room.wallCycle) {
      const w = doc.walls[wid]
      if (w) h = Math.min(h, w.height)
    }
    return Number.isFinite(h) ? h : doc.settings.defaultWallHeight
  }

  // shared by every floor AND the ground disc — walk-mode click-to-go
  const handleFloorClick = (e: ThreeEvent<MouseEvent>) => {
    const walk = useWalkStore.getState()
    if (walk.mode === 'off') return
    if (walk.locked) return // no cursor under Pointer Lock — the frozen ray must not teleport
    e.stopPropagation() // the ray often hits floor + ground disc — act once
    if (e.delta > 4) return // r3f px-move metric: that was a drag, not a click
    const plan = worldToPlan([e.point.x, e.point.y, e.point.z])
    const target = useAppSettings.getState().collisionEnabled
      ? validateTeleport(getCollisionSet(doc, derived), plan)
      : plan // collision off: every spot is reachable
    if (!target) {
      walk.setHint(t('view3d.blocked')) // walls or furniture
      return
    }
    walk.requestWalkTo(target)
    // WebKitGTK grants Pointer Lock only from INSIDE the gesture handler
    // (user check, 0.11.0): the deferred attempt in WalkControls' effect
    // is refused there, so the entering click requests the lock itself.
    const canvas = e.nativeEvent.target
    if (canvas instanceof HTMLCanvasElement) {
      attemptLock(canvas, useAppSettings.getState().lookMode)
    }
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
        ? t(walkLocked ? 'view3d.hintWalkingLock' : 'view3d.hintWalking')
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
        <OccluderBridge
          derived={derived}
          anchor={occluderAnchor}
          enabled={wallHideMode === 'hide' && walkMode !== 'walking'}
          onHidden={setHiddenWalls}
        />
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
            <WallMeshes
              key={s.wallId}
              solid={s}
              wall={doc.walls[s.wallId]}
              visible={!hiddenWalls.has(s.wallId)}
            />
          ))}
          {Object.values(derived.wallSolids).map((s) =>
            s.openings.length ? (
              <OpeningFixtures
                key={`fx-${s.wallId}`}
                doc={doc}
                solid={s}
                visible={!hiddenWalls.has(s.wallId)}
              />
            ) : null,
          )}
          {derived.patchSolids.map((p) => (
            <PatchMesh key={p.nodeId} patch={p} visible={!patchHidden(p.nodeId)} />
          ))}
          {Object.values(derived.rooms).map((r) => (
            <FloorMesh key={r.roomId} room={r} onClick={handleFloorClick} />
          ))}
          {ceilingsEnabled &&
            Object.values(derived.rooms).map((r) => (
              <CeilingMesh key={`ceil-${r.roomId}`} room={r} z={ceilingZ(r)} />
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
