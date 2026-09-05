import { create } from 'zustand'
import { LOD_LEVELS, isLodLevelActive, resolveDeepestLevel } from './lodLevels'
import type { LodLevel, LodLevelId } from './types'

// Zustand-backed publisher for the current camera distance and derived LOD
// level, same role as globeRotation.ts/telemetryStore.ts — for consumers
// that don't have their own convenient per-frame camera access (a HUD
// panel, a future layer mounted outside the Canvas). A component that
// already reads `camera` via useThree() every frame (CityLabels.tsx
// today) should call lodLevels.ts's pure resolveDeepestLevel()/
// isLodLevelActive() directly with its own locally-computed distance
// instead of round-tripping through this store — this store exists for
// the "don't have a distance of my own" case, not as the only way in.
interface LodState {
  distance: number
  level: LodLevel
}

const useLodStore = create<LodState>(() => ({
  distance: Infinity,
  level: LOD_LEVELS[0],
}))

// Called from TelemetryProbe.tsx, which already computes camera distance
// every frame for the orbit telemetry HUD — one more publish target, not a
// second useFrame subscriber duplicating that work.
export function publishLodDistance(distance: number) {
  useLodStore.setState((state) => {
    const next = resolveDeepestLevel(distance)
    return next.id !== state.level.id ? { distance, level: next } : { distance }
  })
}

// Imperative read for non-React or per-frame consumers.
export function getLodDistance(): number {
  return useLodStore.getState().distance
}

export function getCurrentLodLevel(): LodLevel {
  return useLodStore.getState().level
}

export function useLodLevel(): LodLevel {
  return useLodStore((state) => state.level)
}

// For a mounted-outside-the-Canvas consumer that needs one specific tier's
// on/off state, not the whole ladder's deepest level — StatesProvinces.tsx
// is the first user (2026-08-15). Selects a derived boolean rather than raw
// `distance`, so — same reasoning useLodLevel() already relies on — this
// only re-renders when the boolean itself flips, not on every frame's
// distance publish.
export function useIsLodLevelActive(id: LodLevelId): boolean {
  return useLodStore((state) => isLodLevelActive(id, state.distance))
}
