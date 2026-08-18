import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { CAMERA_DEFAULT_DISTANCE, CAMERA_MIN_DISTANCE } from './constants'

// OrbitControls' rotateSpeed maps mouse-pixel-delta to a fixed rotation
// angle regardless of zoom — but the same angle sweeps far more screen
// space for a surface point the closer the camera sits to it, so rotation
// reads as "too fast" once zoomed in even at the sensitivity slider's own
// minimum. This scales the *effective* speed down as distance approaches
// CAMERA_MIN_DISTANCE, reaching MIN_DISTANCE_ROTATE_SCALE right at the
// closest zoom, while leaving CAMERA_DEFAULT_DISTANCE and beyond exactly
// as the slider says.
const MIN_DISTANCE_ROTATE_SCALE = 0.25

// settingsStore.ts's rotateSensitivity is a 0.2-1.0 slider range, but the
// physical OrbitControls rotateSpeed it drives is half that (0.1-0.5) —
// the old slider went up to 1.5 raw and even after the distance scaling
// above, still felt too fast whenever it was set above its own default.
// The fix was to stop letting the slider reach past what its old default
// (0.5 raw) already produced, then relabel that new ceiling as "1.0" for a
// friendlier range — this constant converts the relabeled slider value
// back to that original, already-correct physical scale. See
// settingsStore.ts's DEFAULTS comment.
const ROTATE_SENSITIVITY_TO_SPEED = 0.5

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
    controls.rotateSpeed =
      rotateSensitivity * ROTATE_SENSITIVITY_TO_SPEED * distanceRotateScale(controls.getDistance())
  })
}
