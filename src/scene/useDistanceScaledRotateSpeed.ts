import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { CAMERA_DEFAULT_DISTANCE, CAMERA_MIN_DISTANCE } from './constants'

// OrbitControls' rotateSpeed maps mouse-pixel-delta to a fixed rotation
// angle regardless of zoom — but the same angle sweeps far more screen
// space for a surface point the closer the camera sits to it, so rotation
// reads as "too fast" once zoomed in even at the sensitivity slider's own
// minimum (settingsStore.ts's rotateSensitivity, 0.1-2.0). The slider's
// range wasn't the problem; a flat mapping to OrbitControls' rotateSpeed
// regardless of camera distance was. This scales the *effective* speed
// down as distance approaches CAMERA_MIN_DISTANCE, reaching
// MIN_DISTANCE_ROTATE_SCALE right at the closest zoom, while leaving
// CAMERA_DEFAULT_DISTANCE and beyond exactly as the slider says — that's
// the zoom level the slider's own values (default 0.5) were judged
// correct at, so nothing changes there.
const MIN_DISTANCE_ROTATE_SCALE = 0.25

function distanceRotateScale(distance: number): number {
  const t = Math.min(
    1,
    Math.max(0, (distance - CAMERA_MIN_DISTANCE) / (CAMERA_DEFAULT_DISTANCE - CAMERA_MIN_DISTANCE))
  )
  return MIN_DISTANCE_ROTATE_SCALE + t * (1 - MIN_DISTANCE_ROTATE_SCALE)
}

/**
 * Mounted inside `CameraControls.tsx` alongside the other camera hooks.
 * Applies `rotateSensitivity` imperatively (like `autoRotate`/
 * `autoRotateSpeed` already are) rather than as a static `<OrbitControls
 * rotateSpeed>` prop, since the effective value now depends on the
 * continuously-changing camera distance, not just the settings slider.
 */
export function useDistanceScaledRotateSpeed(
  controlsRef: RefObject<OrbitControlsImpl | null>,
  rotateSensitivity: number
) {
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.rotateSpeed = rotateSensitivity * distanceRotateScale(controls.getDistance())
  })
}
