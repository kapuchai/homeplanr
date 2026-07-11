import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useDocStore } from '../store/docStore'
import { getDerived } from '../store/derived'
import { buildFloorMeshData, buildPrismMeshData } from './mesh/prismGeometry'
import { toBufferGeometry } from './mesh/toBufferGeometry'
import { floorMaterial, sceneMaterial } from './sceneMaterials'
import type { WallSolid, PatchSolid } from '../geometry/wallSolids'
import type { DerivedRoom } from '../store/derived'

/**
 * M2 thin 3D slice — validates the plan→world mapping, prism winding, and
 * patch coverage against the live document, milestones before the full M4
 * scene (materials, shadows, camera fit, demand loop all still to come).
 * Everything sits inside ONE `<group rotation-x={-π/2}>`: plan (x,y,z) →
 * world (x, z, −y); height → +Y (the single 3D mapping point).
 */
function WallMeshes({ solid }: { solid: WallSolid }) {
  const geos = useMemo(
    () => solid.prisms.map((p) => toBufferGeometry(buildPrismMeshData(p))),
    [solid],
  )
  const angle = Math.atan2(solid.frame.dir.y, solid.frame.dir.x)
  return (
    <group
      position={[solid.frame.origin.x, solid.frame.origin.y, 0]}
      rotation={[0, 0, angle]}
    >
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={sceneMaterial('wallPaint')} />
      ))}
    </group>
  )
}

function PatchMesh({ patch }: { patch: PatchSolid }) {
  const geo = useMemo(
    () =>
      toBufferGeometry(
        buildPrismMeshData({ polygon: patch.polygon, z0: patch.z0, z1: patch.z1 }),
      ),
    [patch],
  )
  return <mesh geometry={geo} material={sceneMaterial('wallPaint')} />
}

function FloorMesh({ room }: { room: DerivedRoom }) {
  const geo = useMemo(() => toBufferGeometry(buildFloorMeshData(room.floor)), [room])
  return <mesh geometry={geo} material={floorMaterial(room.room.floorMaterialId)} />
}

export function Slice3D() {
  const doc = useDocStore((s) => s.doc)
  const derived = getDerived(doc)

  // rough scene center for the orbit target (proper fitCamera lands in M4)
  const center = useMemo(() => {
    const nodes = Object.values(doc.nodes)
    if (!nodes.length) return { x: 0, y: 0 }
    return {
      x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
      y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
    }
  }, [doc])

  return (
    <div style={{ flex: 1, background: '#eef1f4' }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [center.x + 6, 7, -center.y + 8], fov: 45 }}
      >
        <ambientLight intensity={0.55} />
        <hemisphereLight intensity={0.4} color="#dfe8f0" groundColor="#b8b4ac" />
        <directionalLight position={[8, 12, 5]} intensity={1.3} />
        <OrbitControls
          makeDefault
          enableDamping
          target={[center.x, 1, -center.y]}
          maxPolarAngle={Math.PI / 2 - 0.1}
        />
        <group rotation-x={-Math.PI / 2}>
          {Object.values(derived.wallSolids).map((s) => (
            <WallMeshes key={s.wallId} solid={s} />
          ))}
          {derived.patchSolids.map((p) => (
            <PatchMesh key={p.nodeId} patch={p} />
          ))}
          {Object.values(derived.rooms).map((r) => (
            <FloorMesh key={r.roomId} room={r} />
          ))}
        </group>
      </Canvas>
    </div>
  )
}
