import { useSyncExternalStore } from 'react'
import { LOD_LEVELS, resolveDeepestLevel } from './lodLevels'
import type { LodLevel } from './types'

// Non-reactive publisher for the current camera distance and derived LOD
// level, same shape as globeRotation.ts/telemetryStore.ts — for consumers
// that don't have their own convenient per-frame camera access (a HUD
// panel, a future layer mounted outside the Canvas). A component that
// already reads `camera` via useThree() every frame (UsCityLabels.tsx
// today) should call lodLevels.ts's pure resolveDeepestLevel()/
// isLodLevelActive() directly with its own locally-computed distance
// instead of round-tripping through this store — this store exists for
// the "don't have a distance of my own" case, not as the only way in.
let currentDistance = Infinity
let currentLevel: LodLevel = LOD_LEVELS[0]
const listeners = new Set<() => void>()

// Called from TelemetryProbe.tsx, which already computes camera distance
// every frame for the orbit telemetry HUD — one more publish target, not a
// second useFrame subscriber duplicating that work.
export function publishLodDistance(distance: number) {
  currentDistance = distance
  const next = resolveDeepestLevel(distance)
  if (next.id !== currentLevel.id) {
    currentLevel = next
    listeners.forEach((listener) => listener())
  }
}

// Imperative read for non-React or per-frame consumers.
export function getLodDistance(): number {
  return currentDistance
}

export function getCurrentLodLevel(): LodLevel {
  return currentLevel
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return currentLevel
}

export function useLodLevel(): LodLevel {
  return useSyncExternalStore(subscribe, getSnapshot)
}
