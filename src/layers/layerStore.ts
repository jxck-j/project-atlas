import { useSyncExternalStore } from 'react'
import { getLayerDefinitions } from './layerRegistry'

// Same useSyncExternalStore pub/sub pattern as hud/selectionStore.ts,
// hud/settingsStore.ts, hud/hudPanelStore.ts — see CLAUDE.md's "Two-layer
// split" section for why (bridges the R3F scene and the DOM HUD without a
// full React re-render on every change).
let enabled: Record<string, boolean> | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

// Built lazily from the registry's defaultEnabled flags, on first read —
// can't run this at module load because the registry isn't populated until
// layer modules (registered as an import side effect) have actually been
// imported, which LayerEngine.tsx is what guarantees.
function ensureInitialized() {
  if (enabled) return
  enabled = {}
  for (const def of getLayerDefinitions()) {
    enabled[def.id] = def.defaultEnabled
  }
}

export function toggleLayer(id: string) {
  ensureInitialized()
  setLayerEnabled(id, !enabled![id])
}

export function setLayerEnabled(id: string, value: boolean) {
  ensureInitialized()
  if (enabled![id] === value) return
  enabled = { ...enabled, [id]: value }
  notify()
}

export function isLayerEnabled(id: string): boolean {
  ensureInitialized()
  return enabled![id] ?? false
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  ensureInitialized()
  return enabled!
}

// The full id -> enabled map, reactive. Used by LayerManager (to decide
// what to mount) and LayerPanel (to render toggle state).
export function useLayerEnabledMap(): Record<string, boolean> {
  return useSyncExternalStore(subscribe, getSnapshot)
}
