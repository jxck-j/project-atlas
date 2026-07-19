import { useSyncExternalStore } from 'react'

export interface CameraSettings {
  rotateSensitivity: number // 0.1 - 2.0, maps to OrbitControls rotateSpeed
  zoomSensitivity: number // 0.1 - 2.0, maps to OrbitControls zoomSpeed
}

const DEFAULTS: CameraSettings = {
  rotateSensitivity: 0.5,
  zoomSensitivity: 0.6,
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
