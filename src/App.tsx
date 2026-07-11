// M0 WebGL smoke gate: a spinning cube rendered by react-three-fiber.
// Its only job is to prove WebKitGTK (Tauri's Linux webview) can run three.js
// before any real work is built on that assumption. Replaced in M2 by the
// real editor shell + thin 3D slice.
import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'

function SpinningCube() {
  const mesh = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (!mesh.current) return
    mesh.current.rotation.x += delta * 0.7
    mesh.current.rotation.y += delta * 1.1
  })
  return (
    <mesh ref={mesh}>
      <boxGeometry args={[1.4, 1.4, 1.4]} />
      <meshStandardMaterial color="#2563eb" />
    </mesh>
  )
}

export default function App() {
  return (
    <div className="smoke-root">
      <div className="smoke-label">
        homeplanr — M0 WebGL smoke test (spinning cube = WebKitGTK WebGL works)
      </div>
      <Canvas camera={{ position: [0, 1.5, 3.5], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 2]} intensity={1.4} />
        <SpinningCube />
      </Canvas>
    </div>
  )
}
