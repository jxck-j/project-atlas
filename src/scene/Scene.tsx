import { Canvas, invalidate } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { Suspense, useEffect } from 'react'
import { Globe } from './Globe'
import { TelemetryProbe } from './TelemetryProbe'
import { CameraControls } from './CameraControls'

// Phase 2 (Plan.md): the Canvas's own mount effect only flags the root
// active, it never calls invalidate() itself — this is a cheap, explicit
// "kick" to guarantee the render loop's first tick happens the moment the
// scene mounts, rather than depending on every future consumer of this
// codebase correctly reasoning about exactly which reconciler operations
// self-invalidate and which don't (see Globe.tsx/PointerMarker.tsx/the
// camera hooks for the cases that need their own explicit calls on an
// ongoing basis — this one is for the very first frame only).
function InitialRenderKick() {
  useEffect(() => {
    invalidate()
  }, [])
  return null
}

export function Scene() {
  return (
    <Canvas
      // near dropped from 0.1 to 0.03 alongside constants.ts's more
      // conservative CAMERA_MIN_DISTANCE reduction (~265km altitude at
      // closest zoom) — see that constant's comment for why an earlier,
      // much closer attempt (~32km altitude, near: 0.005) broke visually.
      camera={{ position: [0, 0, 6.5], fov: 45, near: 0.03, far: 100 }}
      // Antialiasing and >1x device pixel ratio roughly double-to-quadruple
      // the fragment work the GPU does per frame — with 193 fully-detailed
      // countries already pushing a lot of geometry, that's not free.
      gl={{ antialias: false }}
      dpr={1}
      // Phase 2 (see Plan.md): replaces the old frameloop="never" +
      // FrameRateCap.tsx manual advance() loop (see CLAUDE.md/LOGBOOK.md for
      // the ms-vs-seconds bug that approach caused). "demand" means R3F only
      // renders when something calls invalidate() — automatically for any
      // React-driven prop change on a Three object inside this tree (color/
      // opacity/position from JSX), but NOT for a Three object mutated
      // directly inside a useFrame callback (rotation, pulsing, camera
      // tweens) — those call invalidate() explicitly themselves; see
      // Globe.tsx, PointerMarker.tsx, useCameraFlight.ts/useCameraReset.ts,
      // input/CameraController.ts/KeyboardController.ts, and
      // useFlickAutoRotate.ts.
      frameloop="demand"
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
      <InitialRenderKick />
    </Canvas>
  )
}
