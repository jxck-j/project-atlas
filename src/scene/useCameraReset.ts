import { useEffect, useRef } from 'react'
import { invalidate, useFrame } from '@react-three/fiber'
import { Spherical, Vector3 } from 'three'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useSelection } from '../hud/selectionStore'
import { useCameraSettings } from '../hud/settingsStore'
import { CAMERA_DEFAULT_DISTANCE } from './constants'
import { clamp01, easeInOutCubic, easeOutCubic, shortestAngleDelta } from './tweenMath'

const RESET_DURATION_MS = 1400

// The initial <Canvas camera={{ position: [0, 0, 6.5] }} /> orientation,
// expressed as spherical coordinates.
const HOME_SPHERICAL = new Spherical(CAMERA_DEFAULT_DISTANCE, Math.PI / 2, 0)

interface FlightState {
  startTime: number
  startSpherical: Spherical
  thetaDelta: number
}

// Flies the camera back to the default global view — triggered by
// resetView() (Home key, double-click on ocean, or the toolbar's globe
// button). Mirrors useCameraFlight's animation, just with a fixed home
// target instead of a selected country's direction.
export function useCameraReset(controlsRef: RefObject<OrbitControlsImpl | null>) {
  const { resetSeq } = useSelection()
  const { ambientRotationEnabled } = useCameraSettings()
  const flight = useRef<FlightState | null>(null)
  const lastSeq = useRef(0)
  const offsetScratch = useRef(new Vector3())

  useEffect(() => {
    if (resetSeq === lastSeq.current) return
    lastSeq.current = resetSeq

    const controls = controlsRef.current
    if (!controls) return

    controls.target.set(0, 0, 0)

    const startOffset = controls.object.position.clone().sub(controls.target)
    const startSpherical = new Spherical().setFromVector3(startOffset)
    const thetaDelta = shortestAngleDelta(startSpherical.theta, HOME_SPHERICAL.theta)

    controls.autoRotate = false
    controls.enabled = false

    flight.current = { startTime: performance.now(), startSpherical, thetaDelta }
    // Phase 2 (Plan.md): see useCameraFlight.ts's identical comment — this
    // effect mutates the shared controls instance directly, not a JSX prop,
    // so demand mode needs an explicit kick to render this tween's first
    // frame at all.
    invalidate()
  }, [resetSeq, controlsRef])

  useFrame(() => {
    const f = flight.current
    const controls = controlsRef.current
    if (!f || !controls) return

    const t = clamp01((performance.now() - f.startTime) / RESET_DURATION_MS)

    const angleT = easeOutCubic(clamp01(t / 0.7))
    const zoomT = easeInOutCubic(clamp01((t - 0.25) / 0.75))

    const theta = f.startSpherical.theta + f.thetaDelta * angleT
    const phi = f.startSpherical.phi + (HOME_SPHERICAL.phi - f.startSpherical.phi) * angleT
    const radius = f.startSpherical.radius + (HOME_SPHERICAL.radius - f.startSpherical.radius) * zoomT

    const offset = offsetScratch.current.setFromSpherical(new Spherical(radius, phi, theta))
    controls.object.position.copy(controls.target).add(offset)
    controls.update()
    invalidate() // belt-and-suspenders alongside controls.update()'s own 'change' event

    if (t >= 1) {
      flight.current = null
      controls.enabled = true
      // Restore the persistent ambient-rotation setting (settingsStore.ts)
      // rather than unconditionally turning rotation back on — see
      // useCameraFlight.ts's identical comment.
      controls.autoRotate = ambientRotationEnabled
    }
  })
}
