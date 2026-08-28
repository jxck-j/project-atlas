import { create } from 'zustand'

export interface CameraSettings {
  // 0.05 - 1.0 (SettingsPanel.tsx's Slider). Not a direct OrbitControls
  // rotateSpeed value — scene/useDistanceScaledRotateSpeed.ts halves it
  // back down to the physical range that was already judged correct (the
  // old 0.1 minimum is now 0.2 here, same physical speed), then further
  // scales it down by camera distance. The slider's old 0.1-1.5 range let
  // rotation go faster than its own default even felt right, which is
  // what "still too fast" kept coming back to; 1.0 (this range's max) is
  // that old default, relabeled, and is now a hard ceiling instead of a
  // resting point partway up the range. The floor was lowered past the
  // relabeled old minimum (0.2) down to 0.05, for slower-than-anything-
  // before rotation, not to make 0.2 itself the floor.
  rotateSensitivity: number
  zoomSensitivity: number // 0.1 - 1.5, maps to OrbitControls zoomSpeed
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
  rotateSensitivity: 1.0,
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
