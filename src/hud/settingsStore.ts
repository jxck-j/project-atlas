import { create } from 'zustand'

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

const useSettingsStore = create<CameraSettings>(() => ({ ...DEFAULTS }))

export function setRotateSensitivity(value: number) {
  useSettingsStore.setState({ rotateSensitivity: value })
}

export function setZoomSensitivity(value: number) {
  useSettingsStore.setState({ zoomSensitivity: value })
}

export function toggleAmbientRotation() {
  useSettingsStore.setState((settings) => ({ ambientRotationEnabled: !settings.ambientRotationEnabled }))
}

export function resetCameraSettings() {
  useSettingsStore.setState({ ...DEFAULTS })
}

export function useCameraSettings() {
  return useSettingsStore()
}
