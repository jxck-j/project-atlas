import { useSyncExternalStore } from 'react'

export interface TelemetrySnapshot {
  azimuthDeg: number
  polarDeg: number
  distance: number
  fps: number
  hoverLat: number | null
  hoverLng: number | null
}

let snapshot: TelemetrySnapshot = {
  azimuthDeg: 0,
  polarDeg: 0,
  distance: 0,
  fps: 0,
  hoverLat: null,
  hoverLng: null,
}
const listeners = new Set<() => void>()

// Two independent producers write here — TelemetryProbe (camera/fps, every
// frame) and Globe's core-sphere pointer handlers (hover coords, on
// move/out) — so this merges rather than replaces, or each would clobber
// the other's fields.
export function publishTelemetry(partial: Partial<TelemetrySnapshot>) {
  snapshot = { ...snapshot, ...partial }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return snapshot
}

export function useTelemetry() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
