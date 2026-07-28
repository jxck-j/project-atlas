import { useEffect, useRef } from 'react'
import { invalidate } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useCameraSettings } from '../hud/settingsStore'
import { resetView } from '../hud/selectionStore'
import { useFlickAutoRotate } from './useFlickAutoRotate'
import { useCameraFlight } from './useCameraFlight'
import { useCameraReset } from './useCameraReset'
import { useCameraController } from '../input/CameraController'
import {
  CAMERA_IDLE_AUTOROTATE_SPEED,
  CAMERA_MAX_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
} from './constants'

export function CameraControls() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const { rotateSensitivity, zoomSensitivity, ambientRotationEnabled } = useCameraSettings()

  // Ambient rotation is a plain persistent on/off setting the user controls
  // directly (T key, settingsStore.ts's toggleAmbientRotation) — replaces
  // an earlier "auto-stop while something's selected, auto-resume on
  // deselect" heuristic that kept finding new edge cases (sequential store
  // updates could leave a stale intermediate read mid-transition).
  // autoRotate / autoRotateSpeed are still managed imperatively (here + in
  // the flick and flight hooks) rather than as reactive OrbitControls
  // props, so user interaction and camera flights can toggle them without
  // fighting React's prop sync — this effect is what applies the setting
  // whenever it changes (including on mount). useCameraFlight.ts/
  // useCameraReset.ts's flight-completion logic reads the same setting to
  // decide what to restore autoRotate to once a flight ends, rather than
  // hardcoding true.
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = ambientRotationEnabled
      controlsRef.current.autoRotateSpeed = CAMERA_IDLE_AUTOROTATE_SPEED
      // Phase 2 (Plan.md): `autoRotate` is a property on the shared
      // OrbitControls instance, not a prop this component's JSX passes to
      // <OrbitControls> — flipping it doesn't change anything React's
      // reconciler diffs, so demand mode has no built-in reason to render a
      // first frame here. Once moving, OrbitControls' own `update()` (drei
      // calls this every rendered frame — see node_modules/@react-three/
      // drei/core/OrbitControls.js) dispatches 'change', which drei's
      // wrapper already listens for and calls invalidate() on — but that
      // chain can't start without this first nudge.
      invalidate()
    }
  }, [ambientRotationEnabled])

  // Home key returns to the default global view — ignored while typing in a
  // text field (e.g. the search bar), where Home is a text-cursor shortcut.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Home') return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      resetView()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useFlickAutoRotate(controlsRef)
  useCameraFlight(controlsRef)
  useCameraReset(controlsRef)
  // v3.2.0: WASDQE keyboard camera nudges — see src/input/CameraController.ts.
  useCameraController(controlsRef)

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={rotateSensitivity}
      zoomSpeed={zoomSensitivity}
      minDistance={CAMERA_MIN_DISTANCE}
      maxDistance={CAMERA_MAX_DISTANCE}
      minPolarAngle={CAMERA_MIN_POLAR_ANGLE}
      maxPolarAngle={CAMERA_MAX_POLAR_ANGLE}
    />
  )
}
