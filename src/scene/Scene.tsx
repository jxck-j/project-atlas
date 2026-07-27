import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { Suspense } from 'react'
import { Globe } from './Globe'
import { TelemetryProbe } from './TelemetryProbe'
import { CameraControls } from './CameraControls'
import { FrameRateCap } from './FrameRateCap'

export function Scene() {
  return (
    <Canvas
      // near dropped from 0.1 to 0.03 alongside constants.ts's more
      // conservative CAMERA_MIN_DISTANCE reduction (~335km altitude at
      // closest zoom) — see that constant's comment for why an earlier,
      // much closer attempt (~32km altitude, near: 0.005) broke visually.
      camera={{ position: [0, 0, 6.5], fov: 45, near: 0.03, far: 100 }}
      // Antialiasing and >1x device pixel ratio roughly double-to-quadruple
      // the fragment work the GPU does per frame — with 193 fully-detailed
      // countries already pushing a lot of geometry, that's not free.
      gl={{ antialias: false }}
      dpr={1}
      frameloop="never"
    >
      <color attach="background" args={['#04070a']} />
      <ambientLight intensity={0.6} />
      <pointLight position={[5, 3, 5]} intensity={1.2} color="#bfeeff" />

      <Suspense fallback={null}>
        <Stars radius={80} depth={40} count={3000} factor={2.5} saturation={0} fade speed={0.4} />
        <Globe />
      </Suspense>
      <TelemetryProbe />
      <CameraControls />
      <FrameRateCap />
    </Canvas>
  )
}
