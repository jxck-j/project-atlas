import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Spherical, Vector3 } from 'three'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useSelection } from '../hud/selectionStore'
import { useCameraSettings } from '../hud/settingsStore'
import {
  CAMERA_FOCUS_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_POLAR_ANGLE,
} from './constants'
import { clamp01, easeInOutCubic, easeOutCubic, shortestAngleDelta } from './tweenMath'

const FLIGHT_DURATION_MS = 2000

interface FlightState {
  startTime: number
  startSpherical: Spherical
  endSpherical: Spherical
  thetaDelta: number
}

export function useCameraFlight(controlsRef: RefObject<OrbitControlsImpl | null>) {
  const { selected, flightSeq } = useSelection()
  const { ambientRotationEnabled } = useCameraSettings()
  const flight = useRef<FlightState | null>(null)
  const lastSeq = useRef(0)
  const offsetScratch = useRef(new Vector3())

  // Kick off a new flight whenever a fresh selection comes in.
  useEffect(() => {
    if (!selected || flightSeq === lastSeq.current) return
    lastSeq.current = flightSeq

    const controls = controlsRef.current
    if (!controls) return

    const camera = controls.object
    const target = controls.target

    const startOffset = camera.position.clone().sub(target)
    const startSpherical = new Spherical().setFromVector3(startOffset)

    const endOffset = selected.direction.clone().normalize().multiplyScalar(CAMERA_FOCUS_DISTANCE)
    const endSpherical = new Spherical().setFromVector3(endOffset)
    endSpherical.phi = Math.min(
      CAMERA_MAX_POLAR_ANGLE,
      Math.max(CAMERA_MIN_POLAR_ANGLE, endSpherical.phi)
    )

    const thetaDelta = shortestAngleDelta(startSpherical.theta, endSpherical.theta)

    // Manual flight owns the camera for its duration.
    controls.autoRotate = false
    controls.enabled = false

    flight.current = { startTime: performance.now(), startSpherical, endSpherical, thetaDelta }
  }, [selected, flightSeq, controlsRef])

  useFrame(() => {
    const f = flight.current
    const controls = controlsRef.current
    if (!f || !controls) return

    const t = clamp01((performance.now() - f.startTime) / FLIGHT_DURATION_MS)

    // Rotation leads, zoom follows and finishes together with it — reads as
    // a single cinematic swoop rather than two discrete steps.
    const angleT = easeOutCubic(clamp01(t / 0.7))
    const zoomT = easeInOutCubic(clamp01((t - 0.25) / 0.75))

    const theta = f.startSpherical.theta + f.thetaDelta * angleT
    const phi = f.startSpherical.phi + (f.endSpherical.phi - f.startSpherical.phi) * angleT
    const radius =
      f.startSpherical.radius + (f.endSpherical.radius - f.startSpherical.radius) * zoomT

    const offset = offsetScratch.current.setFromSpherical(new Spherical(radius, phi, theta))
    controls.object.position.copy(controls.target).add(offset)
    controls.update()

    if (t >= 1) {
      flight.current = null
      controls.enabled = true
      // Restore the persistent ambient-rotation setting (settingsStore.ts)
      // rather than leaving autoRotate at the false a flight forces it to —
      // a flight always stops rotation for its own duration regardless of
      // the setting, but once it's done whatever the user has ambient
      // rotation set to should apply again.
      controls.autoRotate = ambientRotationEnabled
    }
  })
}
