import { useCallback, useEffect, useRef } from 'react'
import { invalidate, useFrame } from '@react-three/fiber'
import { Spherical, Vector3 } from 'three'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useSelection } from '../hud/selectionStore'
import { useCameraSettings } from '../hud/settingsStore'
import {
  CAMERA_FOCUS_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_POLAR_ANGLE,
  US_CITY_FOCUS_DISTANCE,
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
  const { selected, flightSeq, flyToTarget, flyToTargetSeq } = useSelection()
  const { ambientRotationEnabled } = useCameraSettings()
  const flight = useRef<FlightState | null>(null)
  const lastSelectionSeq = useRef(0)
  const lastFlyToSeq = useRef(0)
  const offsetScratch = useRef(new Vector3())

  // Shared by both triggers below — same cinematic swoop either way, just
  // aimed at a bare direction instead of `selected.direction` and to a
  // caller-chosen focus distance, since flyToUsCity() deliberately never
  // touches `selected` (see selectionStore.ts) and lands much closer
  // (US_CITY_FOCUS_DISTANCE, city-block scale) than a country/GeoEntity
  // selection (CAMERA_FOCUS_DISTANCE, country scale) does.
  // useCallback with an empty dep array (controlsRef is a stable ref
  // object, safe to close over) so this keeps one identity across renders —
  // both effects below list it as a dependency, and a fresh function
  // identity every render would otherwise mean either re-running the effect
  // on every render or having to omit it and fight exhaustive-deps.
  const startFlightTo = useCallback((direction: Vector3, focusDistance: number) => {
    const controls = controlsRef.current
    if (!controls) return

    const camera = controls.object
    const target = controls.target

    const startOffset = camera.position.clone().sub(target)
    const startSpherical = new Spherical().setFromVector3(startOffset)

    const endOffset = direction.clone().normalize().multiplyScalar(focusDistance)
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
    // Phase 2 (Plan.md): this effect mutates the shared OrbitControls
    // instance directly, not a JSX prop CameraControls.tsx's <OrbitControls>
    // element re-renders with — nothing here guarantees React's reconciler
    // diffs different props on that instance just because `selected`
    // changed, so demand mode has no guaranteed reason to render the first
    // frame of this flight on its own. Once moving, controls.update() below
    // dispatches its own 'change' event (drei's <OrbitControls> already
    // listens for that and calls invalidate() itself), which is what
    // sustains every frame after this first one.
    invalidate()
  }, [controlsRef])

  // Kick off a new flight whenever a fresh selection comes in.
  useEffect(() => {
    if (!selected || flightSeq === lastSelectionSeq.current) return
    lastSelectionSeq.current = flightSeq
    startFlightTo(selected.direction, CAMERA_FOCUS_DISTANCE)
  }, [selected, flightSeq, startFlightTo])

  // Same flight, triggered independently by a US city search result
  // (hud/SearchBar.tsx's flyToUsCity()) — flyToTarget/flyToTargetSeq exist
  // specifically because that path leaves `selected` null (no highlight, no
  // Intelligence Panel entry), so it can't reuse the effect above. Before
  // this, flyToTarget/flyToTargetSeq were written by the store but never
  // read anywhere — searching a US city showed its boundary outline
  // wherever the camera already happened to be pointed instead of flying
  // there.
  useEffect(() => {
    if (!flyToTarget || flyToTargetSeq === lastFlyToSeq.current) return
    lastFlyToSeq.current = flyToTargetSeq
    startFlightTo(flyToTarget, US_CITY_FOCUS_DISTANCE)
  }, [flyToTarget, flyToTargetSeq, startFlightTo])

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
    // Belt-and-suspenders alongside controls.update()'s own 'change' event
    // (see the effect above) — guarantees this tween can't stall mid-flight
    // even if something else ever changes how that event is wired up.
    invalidate()

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
