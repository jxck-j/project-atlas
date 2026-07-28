import { create } from 'zustand'

export interface TelemetrySnapshot {
  azimuthDeg: number
  polarDeg: number
  distance: number
  fps: number
  hoverLat: number | null
  hoverLng: number | null
}

const useTelemetryStore = create<TelemetrySnapshot>(() => ({
  azimuthDeg: 0,
  polarDeg: 0,
  distance: 0,
  fps: 0,
  hoverLat: null,
  hoverLng: null,
}))

// Two independent producers write here — TelemetryProbe (camera/fps, every
// frame) and Globe's core-sphere pointer handlers (hover coords, on
// move/out) — so this merges rather than replaces, or each would clobber
// the other's fields.
export function publishTelemetry(partial: Partial<TelemetrySnapshot>) {
  useTelemetryStore.setState(partial)
}

export function useTelemetry() {
  return useTelemetryStore()
}
