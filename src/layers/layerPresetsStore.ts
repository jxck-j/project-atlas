import { create } from 'zustand'
import { getLayerDefinitions } from './layerRegistry'
import { isLayerEnabled, setLayerEnabled } from './layerStore'

// A named snapshot of every registered layer's enabled state, so a user who
// already has a combination of layers set up the way they like doesn't have
// to re-toggle each one by hand the next time they want it — direct
// request. `layers` only records ids that were registered at save time;
// see applyLayerPreset for how that's reconciled against what's registered
// when the preset is later applied.
export interface LayerPreset {
  id: string
  name: string
  layers: Record<string, boolean>
  createdAt: number
}

// This codebase's first use of localStorage — every other piece of user
// state (hud/settingsStore.ts's camera sensitivity, hud/layerStore.ts's own
// enabled map) resets to defaults on reload. A saved preset is explicitly
// the exception: "store" is the whole point, so it needs to survive a
// reload/new session, not just linger for the rest of the current one.
const STORAGE_KEY = 'atlas.layerPresets'

function loadFromStorage(): LayerPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Private browsing, storage disabled, or corrupt JSON — start empty
    // rather than throwing during module init.
    return []
  }
}

function persist(presets: LayerPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // Storage full/disabled — presets still work for the rest of this
    // session via the in-memory store below, they just won't survive a
    // reload. Not worth surfacing as an error for a non-critical save.
  }
}

const useLayerPresetsStore = create<{ presets: LayerPreset[] }>(() => ({
  presets: loadFromStorage(),
}))

export function saveLayerPreset(name: string) {
  const layers: Record<string, boolean> = {}
  for (const def of getLayerDefinitions()) {
    layers[def.id] = isLayerEnabled(def.id)
  }
  const trimmed = name.trim()
  const preset: LayerPreset = {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed || `Preset ${useLayerPresetsStore.getState().presets.length + 1}`,
    layers,
    createdAt: Date.now(),
  }
  const presets = [...useLayerPresetsStore.getState().presets, preset]
  useLayerPresetsStore.setState({ presets })
  persist(presets)
}

// Only touches layers that are both in the saved snapshot AND still
// registered today. A layer removed from the app since the preset was
// saved has nothing left to restore; a layer registered since the preset
// was saved isn't mentioned in the snapshot at all, so it's left exactly as
// the user currently has it rather than forced off — applying an old
// preset should never silently disable something the preset never knew
// about.
export function applyLayerPreset(id: string) {
  const preset = useLayerPresetsStore.getState().presets.find((p) => p.id === id)
  if (!preset) return
  const registeredIds = new Set(getLayerDefinitions().map((d) => d.id))
  for (const [layerId, enabled] of Object.entries(preset.layers)) {
    if (registeredIds.has(layerId)) setLayerEnabled(layerId, enabled)
  }
}

export function deleteLayerPreset(id: string) {
  const presets = useLayerPresetsStore.getState().presets.filter((p) => p.id !== id)
  useLayerPresetsStore.setState({ presets })
  persist(presets)
}

export function useLayerPresets(): LayerPreset[] {
  return useLayerPresetsStore((state) => state.presets)
}
