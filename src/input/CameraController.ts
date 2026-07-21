// Keyboard-driven camera movement (WASDQE, held-continuous) plus two thin
// wrappers (R, Space — one-shot) around camera actions that already exist.
// Per the requested architecture: "Handles camera movement commands.
// Handles focusing on selected entities. Does not contain selection logic"
// — this file never reads or writes `selected` beyond what
// `flyToSelectedCountry()` already does internally, and never touches
// `hud/selectionStore.ts`'s selection state directly.
import { useFrame } from '@react-three/fiber'
import { Spherical, Vector3 } from 'three'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { getActiveCameraCommands } from './KeyboardController'
import {
  CAMERA_MAX_DISTANCE,
  CAMERA_MAX_POLAR_ANGLE,
  CAMERA_MIN_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
} from '../scene/constants'
import { flyToSelectedCountry, resetView } from '../hud/selectionStore'

// Radians/units per second while a key is held. Not tuned against a running
// browser (no browser tooling available while this was built — see
// BACKLOG.md) — reasonable first-pass values relative to the existing
// bounds (CAMERA_MIN/MAX_DISTANCE, CAMERA_MIN/MAX_POLAR_ANGLE in
// scene/constants.ts): a held W/S traverses the full zoom range in ~3s, a
// held A/D completes a full rotation in ~6s.
const ROTATE_RATE = 1.0
const TILT_RATE = 0.7
const ZOOM_RATE = 3.0

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Mounted once inside `scene/CameraControls.tsx`, alongside
 * `useFlickAutoRotate`/`useCameraFlight`/`useCameraReset` — an addition to
 * that hook composition, not a change to any of the existing three. Reads
 * `KeyboardController.getActiveCameraCommands()` every frame (imperative,
 * not a React subscription — see that module's doc comment for why) and
 * nudges the OrbitControls camera the same way `useCameraFlight`/
 * `useCameraReset` do: spherical coordinates around the fixed globe-center
 * target, written back via `controls.object.position` + `controls.update()`.
 *
 * Bails out whenever `controls.enabled` is false — that's exactly the flag
 * `useCameraFlight`/`useCameraReset` set while a cinematic flight owns the
 * camera, so a held WASD key can never fight an in-progress "FOCUS CAMERA"
 * or reset-view tween; it simply has no effect until the flight finishes.
 */
export function useCameraController(controlsRef: RefObject<OrbitControlsImpl | null>) {
  useFrame((_, delta) => {
    const controls = controlsRef.current
    if (!controls || !controls.enabled) return

    const active = getActiveCameraCommands()
    if (active.size === 0) return

    const camera = controls.object
    const target = controls.target
    const offset = camera.position.clone().sub(target)
    const spherical = new Spherical().setFromVector3(offset)

    if (active.has('rotate-left')) spherical.theta -= ROTATE_RATE * delta
    if (active.has('rotate-right')) spherical.theta += ROTATE_RATE * delta
    if (active.has('tilt-up')) spherical.phi -= TILT_RATE * delta
    if (active.has('tilt-down')) spherical.phi += TILT_RATE * delta
    if (active.has('zoom-in')) spherical.radius -= ZOOM_RATE * delta
    if (active.has('zoom-out')) spherical.radius += ZOOM_RATE * delta

    spherical.phi = clamp(spherical.phi, CAMERA_MIN_POLAR_ANGLE, CAMERA_MAX_POLAR_ANGLE)
    spherical.radius = clamp(spherical.radius, CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE)

    // A keyboard nudge is manual input, same as a drag — halts ambient
    // idle rotation exactly the way useFlickAutoRotate's onDown handler
    // does for a mouse drag.
    controls.autoRotate = false

    camera.position.copy(target).add(new Vector3().setFromSpherical(spherical))
    controls.update()
  })
}

/** R key. Reuses the exact same reset used by the Home key, double-click-on-ocean, and the toolbar's globe button — including clearing the current selection, which resetView() has always done. Not a parallel "camera-only" reset. */
export function resetCamera(): void {
  resetView()
}

/** Space key. Reuses the exact camera flight the IntelligencePanel's "FOCUS CAMERA" button already triggers — a no-op if nothing is selected (flyToSelectedCountry() already guards on that). */
export function focusOnSelection(): void {
  flyToSelectedCountry()
}
