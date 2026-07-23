import { useSyncExternalStore } from 'react'

export interface CameraSettings {
  rotateSensitivity: number // 0.1 - 2.0, maps to OrbitControls rotateSpeed
  zoomSensitivity: number // 0.1 - 2.0, maps to OrbitControls zoomSpeed
  // Whether the globe spins on its own when nothing's flying/being dragged.
  // Replaces the earlier "auto-stop while something's selected, auto-resume
  // on deselect" heuristic in scene/CameraControls.tsx — that logic kept
  // finding new edge cases (state-update timing could leave a stale read
  // mid-transition between selecting and deselecting). A plain persistent
  // on/off toggle the user controls directly (T key — see
  // input/KeyboardController.ts) has none of that surface area. Default
  // false: previous default was always-on ambient rotation; this flips the
  // default per direct request. See LOGBOOK.md.
  ambientRotationEnabled: boolean
}

const DEFAULTS: CameraSettings = {
  rotateSensitivity: 0.5,
  zoomSensitivity: 0.6,
  ambientRotationEnabled: false,
}

let settings: CameraSettings = { ...DEFAULTS }
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function setRotateSensitivity(value: number) {
  settings = { ...settings, rotateSensitivity: value }
  notify()
}

export function setZoomSensitivity(value: number) {
  settings = { ...settings, zoomSensitivity: value }
  notify()
}

export function toggleAmbientRotation() {
  settings = { ...settings, ambientRotationEnabled: !settings.ambientRotationEnabled }
  notify()
}

export function resetCameraSettings() {
  settings = { ...DEFAULTS }
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return settings
}

export function useCameraSettings() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
