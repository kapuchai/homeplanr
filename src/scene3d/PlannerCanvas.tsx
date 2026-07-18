import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import {
  PMREMGenerator,
  ACESFilmicToneMapping,
  Color,
  Object3D,
  Shape,
  type BufferGeometry,
  type DirectionalLight,
  type MeshStandardMaterial,
  type Vector3,
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
  emissiveSlotMaterial,
  floorMaterial,
  furnitureSlotMaterial,
  itemMaterial,
  sceneMaterial,
  shadowOnlyMaterial,
  wallFaceMaterial,
} from './sceneMaterials'
import { EMITTER_DEFAULT_COLOR, SCENE_MATERIALS } from '../catalog/palette'
import { useArtMaterial } from './artTexture'
import { WalkControls } from './walk/WalkControls'
import { useWalkStore } from './walk/walkStore'
import { attemptLock } from './walk/pointerLock'
import { getCollisionSet, validateTeleport } from './walk/collision'
import { worldToPlan } from './walk/walkMath'
import { hiddenWallIds, sameWallSet } from './wallOcclusion'
import { DEG, solarPosition } from './sun'
import { lightingRamp } from '../theme/sunRamp'
import { SunArc } from './SunArc'
import { LevelSwitcher } from '../app/LevelSwitcher'
import type { FurnitureId, WallId } from '../model/ids'
import type { Vec2 } from '../geometry/vec'
import { captureAndSave, type CaptureApi } from './screenshot'
import { CATALOG } from '../catalog'
import { realizeItem } from '../catalog/realize'
import type { WallSolid, PatchSolid, RealizedOpening } from '../geometry/wallSolids'
import { openingStyleSpec } from '../catalog/openingStyles'
import type { FurnitureInstance, LevelDoc, Wall } from '../model/types'
import type { CatalogItem, MaterialId } from '../catalog/types'
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
  shadowGhost = false,
}: {
  solid: WallSolid
  wall: Wall | undefined
  /** Occluder verdict (M3) — false keeps the meshes mounted but skips
   * render AND shadow casting; geometry survives for flicker-free undo. */
  visible?: boolean
  /** 0.12.0, realistic lighting: a HIDDEN wall renders as a shadow-only
   * ghost (shared colorWrite-less material) so the sun cannot flood the
   * dollhouse view through the hidden side — invisible, non-occluding,
   * still casting. */
  shadowGhost?: boolean
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
  const ghost = !visible && shadowGhost
  return (
    <group
      position={[solid.frame.origin.x, solid.frame.origin.y, 0]}
      rotation={[0, 0, angle]}
      visible={visible || ghost}
    >
      {meshes.map((m, i) => (
        <mesh
          key={i}
          geometry={m.geo}
          material={ghost ? shadowOnlyMaterial() : m.material}
          castShadow
          receiveShadow={!ghost}
        />
      ))}
    </group>
  )
}

function PatchMesh({
  patch,
  visible = true,
  shadowGhost = false,
}: {
  patch: PatchSolid
  visible?: boolean
  shadowGhost?: boolean
}) {
  const geo = useMemo(
    () => toBufferGeometry(buildPrismMeshData({ polygon: patch.polygon, z0: patch.z0, z1: patch.z1 })),
    [patch],
  )
  useEffect(() => () => geo.dispose(), [geo])
  const ghost = !visible && shadowGhost
  return (
    <mesh
      geometry={geo}
      material={ghost ? shadowOnlyMaterial() : sceneMaterial('wallPaint')}
      castShadow
      receiveShadow={!ghost}
      visible={visible || ghost}
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
 * mode gets a ceiling. Shadow flags are MODE-SPLIT (0.12.0): classic
 * keeps castShadow=false so the unshadowed hemi/ambient/IBL scene stays
 * exactly as bright as pre-0.12.0; realistic lighting turns cast+receive
 * ON so the sun cannot pour through roofs (rooms light through their
 * window carves) and interior lamps shade the slab. The single-sided
 * geometry still casts from above because three's shadow pass renders
 * the REVERSE side by default (shadowSide mapping Front→Back).
 */
function CeilingMesh({ room, z }: { room: DerivedRoom; z: number }) {
  const realistic = useAppSettings((s) => s.realisticLighting)
  const geo = useMemo(() => toBufferGeometry(buildCeilingMeshData(room.floor, z)), [room, z])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh
      geometry={geo}
      material={sceneMaterial('ceiling')}
      castShadow={realistic}
      receiveShadow={realistic}
    />
  )
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
  // Miters (0.11.0): side strips BUTT against the horizontals instead of
  // overlapping them — they start above the bottom rail and stop under
  // the top rail (or under the arch torus tube at the spring line), so
  // no two frame boxes ever share a volume or a coplanar face.
  const sideLo = FRAME
  const sideHi = arched ? Math.max(sideLo + 0.01, springH - FRAME / 2) : h - FRAME
  const sideH = sideHi - sideLo
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
        position={[-(w / 2 - FRAME / 2), 0, (sideLo + sideHi) / 2]}
        castShadow
        material={itemMaterial('whiteLacquer')}
      >
        <boxGeometry args={[FRAME, FRAME, sideH]} />
      </mesh>
      <mesh
        position={[w / 2 - FRAME / 2, 0, (sideLo + sideHi) / 2]}
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
      {/* panorama: interior mullions at an even pitch, butted between
          the rails like the side strips (0.11.0 miter rule) */}
      {Array.from({ length: mullions }, (_, i) => (
        <mesh
          key={i}
          position={[-w / 2 + ((i + 1) * w) / (mullions + 1), 0, h / 2]}
          castShadow
          material={itemMaterial('whiteLacquer')}
        >
          <boxGeometry args={[FRAME, FRAME, h - 2 * FRAME]} />
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
          {/* glazed balcony leaf: rails full width, stiles BUTTED between
              them (0.11.0 miter rule — rails span z [0,0.08] and
              [h−0.09,h−0.01], stiles fill the gap exactly) */}
          <mesh position={[leafCx, 0, 0.04]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[leafW, LEAF_T, 0.08]} />
          </mesh>
          <mesh position={[leafCx, 0, h - 0.05]} castShadow material={itemMaterial('whiteLacquer')}>
            <boxGeometry args={[leafW, LEAF_T, 0.08]} />
          </mesh>
          <mesh
            position={[dirSign * 0.04, 0, (0.08 + (h - 0.09)) / 2]}
            castShadow
            material={itemMaterial('whiteLacquer')}
          >
            <boxGeometry args={[0.08, LEAF_T, h - 0.17]} />
          </mesh>
          <mesh
            position={[dirSign * (leafW - 0.04), 0, (0.08 + (h - 0.09)) / 2]}
            castShadow
            material={itemMaterial('whiteLacquer')}
          >
            <boxGeometry args={[0.08, LEAF_T, h - 0.17]} />
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
  doc: LevelDoc
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

/**
 * An instance's light (0.12.0, realistic lighting) — a child of the
 * furniture group in ITEM-LOCAL plan space (z up), so the instance
 * transform carries it and `at` scales with the mesh; x is negated when
 * mirrored (realizeItem mirrors geometry only). Intensity is photometric:
 * lumens → candela via three's .power conventions (point lm/4π, spot
 * lm/π), decay 2, unlimited range. castShadow rides the 2-nearest budget
 * at 1024² — the M1 spike cliff is point-light cube maps at ×4/2048.
 */
/**
 * Perceptual lumen calibration (0.12.0, user-tuned): PHYSICAL candela
 * reads white-hot under ACES + the near-white room albedos at apartment
 * scale, so the photometric conversion is divided down — the lumen UI
 * stays a meaningful relative scale while an 800 lm floor lamp lands as
 * a cozy pool, not a floodlight. Probe-tuned; change only with night
 * screenshots in hand.
 */
const LUMEN_SCALE = 1 / 6

function EmitterLight({
  emitter,
  lumen,
  mirrored,
  shadowCast,
}: {
  emitter: NonNullable<CatalogItem['emitter']>
  lumen: number
  mirrored: boolean
  shadowCast: boolean
}) {
  const at: [number, number, number] = [
    mirrored ? -emitter.at[0] : emitter.at[0],
    emitter.at[1],
    emitter.at[2],
  ]
  const color = emitter.color ?? EMITTER_DEFAULT_COLOR
  const spotTarget = useMemo(() => new Object3D(), [])
  if (emitter.kind === 'spot') {
    return (
      <>
        <spotLight
          position={at}
          target={spotTarget}
          color={color}
          intensity={(lumen * LUMEN_SCALE) / Math.PI}
          angle={1.1}
          penumbra={0.5}
          decay={2}
          castShadow={shadowCast}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.002}
          shadow-normalBias={0.02}
        />
        {/* straight down in plan space; mounted so its matrix updates */}
        <primitive object={spotTarget} position={[at[0], at[1], at[2] - 1]} />
      </>
    )
  }
  return (
    <pointLight
      position={at}
      color={color}
      intensity={(lumen * LUMEN_SCALE) / (4 * Math.PI)}
      decay={2}
      castShadow={shadowCast}
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.002}
      shadow-normalBias={0.02}
    />
  )
}

function Furniture3D({ f, shadowCast }: { f: FurnitureInstance; shadowCast: boolean }) {
  const item = CATALOG[f.catalogItemId]
  const realistic = useAppSettings((s) => s.realisticLighting)
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
  // emitter lit = master toggle AND the instance switch (absent = ON)
  const lit = realistic && !!item.emitter && (f.lightOn ?? true)
  return (
    <group position={[f.x, f.y, f.elevation]} rotation={[0, 0, f.rotation]} scale={s}>
      {realized.groups.map((g) => (
        <mesh
          key={g.mat}
          geometry={g.geometry}
          material={
            g.mat === item.imageSlot && artMaterial
              ? artMaterial
              : lit && g.mat === item.emitter!.slot
                ? emissiveSlotMaterial(
                    item.materials[g.mat] as MaterialId,
                    f.materialOverrides?.[g.mat],
                    item.emitter!.color ?? EMITTER_DEFAULT_COLOR,
                  )
                : furnitureSlotMaterial(
                    item.materials[g.mat] as MaterialId,
                    f.materialOverrides?.[g.mat],
                  )
          }
          castShadow
        />
      ))}
      {lit && (
        <EmitterLight
          emitter={item.emitter!}
          lumen={f.lumen ?? item.emitter!.defaultLumen}
          mirrored={!!f.mirrored}
          shadowCast={shadowCast}
        />
      )}
    </group>
  )
}

/** Shadow-budget throttle (ms) + caster count — the M1 spike decision. */
const BUDGET_N = 2
const BUDGET_MS = 250

/**
 * Picks the ≤2 lit emitters nearest the camera as shadow casters (M1
 * budget: 2 × 1024 holds 60fps on WebKitGTK; interior maps never 2048;
 * everything else renders shadowless — which the spike measured as free).
 * Runs on rendered frames, throttled — under the demand frameloop no
 * frames render while nothing changes, and both orbit (controls change)
 * and walk ('always') do render — plus an effect for instant recompute
 * when the doc or the toggle changes (a lamp turned on must not wait for
 * the next camera move).
 */
function ShadowBudgetBridge({
  doc,
  enabled,
  onBudget,
}: {
  doc: LevelDoc
  enabled: boolean
  onBudget: (ids: Set<FurnitureId>) => void
}) {
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const last = useRef(0)
  const prev = useRef<Set<FurnitureId>>(new Set())

  const compute = (camPos: Vector3) => {
    const lit: { id: FurnitureId; d2: number }[] = []
    for (const f of Object.values(doc.furniture)) {
      const item = CATALOG[f.catalogItemId]
      if (!item?.emitter || !(f.lightOn ?? true)) continue
      // plan → world: (x, y) → (x, −y), height ≈ elevation + 1
      const dx = camPos.x - f.x
      const dy = camPos.y - (f.elevation + 1)
      const dz = camPos.z - -f.y
      lit.push({ id: f.id, d2: dx * dx + dy * dy + dz * dz })
    }
    lit.sort((a, b) => a.d2 - b.d2)
    const next = new Set(lit.slice(0, BUDGET_N).map((e) => e.id))
    if (next.size === prev.current.size && [...next].every((id) => prev.current.has(id))) return
    prev.current = next
    onBudget(next)
    invalidate()
  }

  useFrame(({ camera: cam }) => {
    if (!enabled) return
    const now = performance.now()
    if (now - last.current < BUDGET_MS) return
    last.current = now
    compute(cam.position)
  })

  useEffect(() => {
    if (!enabled) {
      if (prev.current.size) {
        prev.current = new Set()
        onBudget(new Set())
      }
      return
    }
    compute(camera.position)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, enabled, camera])

  return null
}

/** Shadow-frustum margin (m) around the scene bbox — classic and SunSky agree. */
const margin3d = 2

/**
 * IBL + shadow-fitted key light + fog + ground, sized by the sceneBBox.
 * 0.12.0: with realistic lighting ON the light/fog/sky block is sun-driven
 * (SunSky); the classic branch below stays bit-identical to pre-0.12.0 —
 * the master toggle is a render-path switch, never a retune.
 */
function SceneEnvironment({
  box,
  onGroundClick,
}: {
  box: SceneBBox
  onGroundClick?: (e: ThreeEvent<MouseEvent>) => void
}) {
  const { gl, scene } = useThree()
  const invalidate = useThree((s) => s.invalidate)
  const theme3d = useThemeStore((s) => s.theme3d)
  const realistic = useAppSettings((s) => s.realisticLighting)
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = env.texture
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  // IBL intensity ownership: classic = 0.45 here; realistic = SunSky's ramp.
  // Split from the texture effect above — React runs CHILD effects first,
  // so a parent-side unconditional 0.45 would clobber SunSky's night value
  // right after it lands (the bug that made night render as day).
  useEffect(() => {
    if (!realistic) {
      scene.environmentIntensity = 0.45
      invalidate()
    }
  }, [scene, realistic, invalidate])

  const groundR = Math.max(30, 3 * box.diag)
  const margin = margin3d
  return (
    <>
      {realistic ? (
        <SunSky box={box} />
      ) : (
        <>
          <hemisphereLight
            intensity={0.5}
            color={theme3d.hemiSky}
            groundColor={theme3d.hemiGround}
          />
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
        </>
      )}
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
 * Sun/moon-driven environment (0.12.0, realistic lighting ON). The ONE
 * directional caster rides the solar vector — solarPosition(lat, lon,
 * season, timeOfDay) with northOffset added to the azimuth; below the
 * ramp's moon threshold the bearing flips 180° and the same light plays
 * the moon (the ramp dips intensity ~0 through the swap so it never pops).
 * Every color/intensity channel is the altitude ramp; the sky color
 * becomes scene.background AND the fog color; the IBL intensity follows
 * the ramp (cleanup restores classic 0.45/null background). World mapping:
 * +z = plan north (screen-up), +x = east; the shadow ortho box WIDENS up
 * to 3× as the light drops so long dawn/dusk shadows stay inside the map
 * (the classic fixed frustum would clip them).
 */
function SunSky({ box }: { box: SceneBBox }) {
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  const light = useRef<DirectionalLight>(null)
  const latitude = useAppSettings((s) => s.latitude)
  const longitude = useAppSettings((s) => s.longitude)
  const northOffset = useAppSettings((s) => s.northOffset)
  const season = useAppSettings((s) => s.season)
  const timeOfDay = useAppSettings((s) => s.timeOfDay)

  const sun = solarPosition(latitude, longitude, season, timeOfDay)
  const ramp = lightingRamp(sun.altitude)
  const bearing = sun.azimuth + northOffset * DEG + (ramp.moon ? Math.PI : 0)
  // clamp: the dying sun (crossfade zone) must not shine from underground
  const altitude = Math.max(ramp.moon ? -sun.altitude : sun.altitude, 0.01)
  const dist = Math.max(30, 1.8 * box.diag)

  useEffect(() => {
    const l = light.current
    if (!l) return
    l.position.set(
      box.cx + dist * Math.cos(altitude) * Math.sin(bearing),
      dist * Math.sin(altitude),
      -box.cy + dist * Math.cos(altitude) * Math.cos(bearing),
    )
    const widen = Math.min(3, Math.max(1, 0.9 / Math.max(Math.sin(altitude), 0.3)))
    const half = (box.diag / 2 + margin3d) * widen
    const cam = l.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = dist + 3 * box.diag + 20
    cam.updateProjectionMatrix()
    // texel size grows with the frustum — scale the bias with it or the
    // coarser map stripes floors/walls with acne that reads as z-fighting
    l.shadow.normalBias = 0.03 * widen
    l.target.updateMatrixWorld()
    invalidate()
  }, [box, dist, bearing, altitude, invalidate])

  useEffect(() => {
    scene.background = new Color(ramp.sky)
    scene.environmentIntensity = ramp.env
    invalidate()
    return () => {
      scene.background = null
      scene.environmentIntensity = 0.45
      invalidate()
    }
  }, [scene, ramp.sky, ramp.env, invalidate])

  return (
    <>
      <hemisphereLight
        intensity={ramp.hemiIntensity}
        color={ramp.hemiSky}
        groundColor={ramp.hemiGround}
      />
      <ambientLight intensity={ramp.ambient} />
      <directionalLight
        ref={light}
        color={ramp.sunColor}
        intensity={ramp.sunIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        // normalBias is effect-owned: it scales with the widened frustum
        target-position={[box.cx, 0, -box.cy]}
      />
      <fog attach="fog" args={[ramp.sky, 2 * box.diag + 10, 6 * box.diag + 30]} />
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
  const realistic = useAppSettings((s) => s.realisticLighting)
  useEffect(() => {
    // realistic lighting: the ground is a WORLD surface — neutral albedo
    // lit by the sun/moon, identical in both UI themes (the same rule as
    // the sky); classic keeps the per-theme tint
    sceneMaterial('ground').color.set(
      realistic ? SCENE_MATERIALS.ground.color : theme3d.ground,
    )
    invalidate()
  }, [theme3d, realistic, invalidate])
  return null
}

/**
 * Shadow-map update gate (0.12.0 perf, user report: orbit stutter under
 * realistic lighting). three re-renders EVERY shadow map EVERY frame by
 * default, but shadow maps are LIGHT-space — orbiting and walking are
 * camera-only and need no shadow pass at all. autoUpdate goes OFF for the
 * canvas lifetime; the no-deps effect marks maps dirty on every REACT
 * COMMIT of this component, which happens exactly when shadow-relevant
 * state changes (doc geometry/furniture via the parent re-render, sun
 * inputs/toggles via the subscriptions below) and never during pure
 * camera interaction. A stray extra mark from unrelated ui state is one
 * cheap shadow pass — the steady-state win is zero shadow passes per
 * orbit frame.
 */
function ShadowUpdateBridge(_props: {
  doc: LevelDoc
  hiddenWalls: Set<WallId>
  shadowIds: Set<FurnitureId>
}) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  useAppSettings((s) => s.realisticLighting)
  useAppSettings((s) => s.ceilingsEnabled)
  useAppSettings((s) => s.latitude)
  useAppSettings((s) => s.longitude)
  useAppSettings((s) => s.northOffset)
  useAppSettings((s) => s.season)
  useAppSettings((s) => s.timeOfDay)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])
  useEffect(() => {
    gl.shadowMap.needsUpdate = true
    invalidate()
  })
  return null
}

/**
 * Tone-mapping exposure (0.12.0) — an Options slider under realistic
 * lighting; forced back to 1 when the master toggle is off so the classic
 * scene stays bit-identical.
 */
function ExposureBridge() {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const realistic = useAppSettings((s) => s.realisticLighting)
  const exposure = useAppSettings((s) => s.exposure)
  useEffect(() => {
    gl.toneMappingExposure = realistic ? exposure : 1
    invalidate()
  }, [gl, invalidate, realistic, exposure])
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
  // WebKitGTK hides the locked cursor only over the lock TARGET (the
  // canvas) — the cursor image stays frozen over whatever chrome it was
  // on when lock engaged (the Walk button). Hide it app-wide instead.
  useEffect(() => {
    document.body.classList.toggle('pointer-locked', walkLocked)
    return () => document.body.classList.remove('pointer-locked')
  }, [walkLocked])
  const wallHideMode = useAppSettings((s) => s.wallHideMode)
  const realisticLighting = useAppSettings((s) => s.realisticLighting)
  const [hiddenWalls, setHiddenWalls] = useState<Set<WallId>>(() => new Set())
  const [shadowIds, setShadowIds] = useState<Set<FurnitureId>>(() => new Set())
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
    // fallback teleport (lock unavailable — cursor still visible): retry
    // the lock from this gesture in case the platform now grants it
    const canvas = e.nativeEvent.target
    if (canvas instanceof HTMLCanvasElement) attemptLock(canvas)
  }

  const applyPreset = (kind: CameraPresetKind) => {
    markOrbitHintSeen()
    setPresetReq((r) => ({ pose: presetPose(box, kind), seq: (r?.seq ?? 0) + 1 }))
  }

  const hint =
    walkHint ??
    (walkMode === 'walking'
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
    <div className="view3d-wrapper">
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
        <ExposureBridge />
        <ShadowUpdateBridge doc={doc} hiddenWalls={hiddenWalls} shadowIds={shadowIds} />
        <ShadowBudgetBridge doc={doc} enabled={realisticLighting} onBudget={setShadowIds} />
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
              shadowGhost={realisticLighting}
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
            <PatchMesh
              key={p.nodeId}
              patch={p}
              visible={!patchHidden(p.nodeId)}
              shadowGhost={realisticLighting}
            />
          ))}
          {Object.values(derived.rooms).map((r) => (
            <FloorMesh key={r.roomId} room={r} onClick={handleFloorClick} />
          ))}
          {ceilingsEnabled &&
            Object.values(derived.rooms).map((r) => (
              <CeilingMesh key={`ceil-${r.roomId}`} room={r} z={ceilingZ(r)} />
            ))}
          {Object.values(doc.furniture).map((f) => (
            <Furniture3D key={f.id} f={f} shadowCast={shadowIds.has(f.id)} />
          ))}
        </group>
      </Canvas>
      </GlErrorBoundary>
      {realisticLighting && walkMode !== 'walking' && <SunArc />}
      {walkMode !== 'walking' && <LevelSwitcher />}
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
            if (walk.mode !== 'off') {
              walk.exit()
              return
            }
            // 0.11.0: no floor pick — drop in at the largest room's centre
            // (else the scene centre), nudged clear when collision is on
            const rooms = Object.values(derived.rooms)
            const spot = rooms.length
              ? rooms.reduce((a, b) => (b.areaM2 > a.areaM2 ? b : a)).centroid
              : { x: box.cx, y: box.cy }
            const entry = useAppSettings.getState().collisionEnabled
              ? (validateTeleport(getCollisionSet(doc, derived), spot, undefined, 1) ?? spot)
              : spot
            // request Pointer Lock NOW, inside the click gesture, so the
            // cursor vanishes as walk begins (WebKitGTK needs the user
            // activation — a deferred request from an effect is refused)
            const canvas = captureApi.current?.gl.domElement
            if (canvas) attemptLock(canvas)
            walk.enterWalk(entry)
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
