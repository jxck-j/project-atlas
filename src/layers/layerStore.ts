import { create } from 'zustand'
import { getLayerDefinitions } from './layerRegistry'

// Same zustand-backed pub/sub pattern as hud/selectionStore.ts,
// hud/settingsStore.ts, hud/hudPanelStore.ts — see CLAUDE.md's "Two-layer
// split" section for why (bridges the R3F scene and the DOM HUD without a
// full React re-render on every change).
const useLayerStore = create<Record<string, boolean>>(() => ({}))

// Built lazily from the registry's defaultEnabled flags, on first read —
// can't run this at module load because the registry isn't populated until
// layer modules (registered as an import side effect) have actually been
// imported, which LayerEngine.tsx is what guarantees.
let initialized = false
function ensureInitialized() {
  if (initialized) return
  initialized = true
  const defaults: Record<string, boolean> = {}
  for (const def of getLayerDefinitions()) {
    defaults[def.id] = def.defaultEnabled
  }
  useLayerStore.setState(defaults)
}

export function toggleLayer(id: string) {
  ensureInitialized()
  setLayerEnabled(id, !useLayerStore.getState()[id])
}

export function setLayerEnabled(id: string, value: boolean) {
  ensureInitialized()
  if (useLayerStore.getState()[id] === value) return
  useLayerStore.setState({ [id]: value })
}

export function isLayerEnabled(id: string): boolean {
  ensureInitialized()
  return useLayerStore.getState()[id] ?? false
}

// The full id -> enabled map, reactive. Used by LayerManager (to decide
// what to mount) and LayerPanel (to render toggle state).
export function useLayerEnabledMap(): Record<string, boolean> {
  ensureInitialized()
  return useLayerStore()
}
