import type { LayerDefinition } from './types'

// The plugin mechanism this whole engine exists to provide: a layer module
// calls registerLayer() once, at import time (see placeholders/*.tsx for the
// pattern), adding itself to this catalog. Nothing else needs to know the
// layer exists — LayerManager renders whatever's both registered here AND
// enabled in layerStore, and LayerPanel lists whatever's registered here.
// Adding a new layer means writing one module and importing it once; it
// never means editing Globe.tsx, LayerManager.tsx, or LayerPanel.tsx.
const registry = new Map<string, LayerDefinition>()

export function registerLayer(definition: LayerDefinition) {
  if (registry.has(definition.id)) {
    console.warn(`[LayerEngine] layer "${definition.id}" is already registered — overwriting.`)
  }
  registry.set(definition.id, definition)
}

export function getLayerDefinitions(): LayerDefinition[] {
  return Array.from(registry.values())
}
