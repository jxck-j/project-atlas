import { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useCameraSettings } from '../hud/settingsStore'
import { resetView, useSelection } from '../hud/selectionStore'
import { useFlickAutoRotate } from './useFlickAutoRotate'
import { useCameraFlight } from './useCameraFlight'
import { useCameraReset } from './useCameraReset'
import {
  CAMERA_IDLE_AUTOROTATE_SPEED,
  CAMERA_MAX_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
} from './constants'

export function CameraControls() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const { rotateSensitivity, zoomSensitivity } = useCameraSettings()
  const { selected } = useSelection()
  const wasSelected = useRef(false)

  // autoRotate / autoRotateSpeed are managed imperatively (here + in the
  // flick and flight hooks) rather than as reactive props, so user
  // interaction and the camera flight can toggle them without fighting
  // React's prop sync.
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = true
      controlsRef.current.autoRotateSpeed = CAMERA_IDLE_AUTOROTATE_SPEED
    }
  }, [])

  // Resume idle ambient rotation once a country is deselected.
  useEffect(() => {
    if (wasSelected.current && !selected && controlsRef.current) {
      controlsRef.current.autoRotate = true
      controlsRef.current.autoRotateSpeed = CAMERA_IDLE_AUTOROTATE_SPEED
    }
    wasSelected.current = selected != null
  }, [selected])

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
