// Public barrel for the Layer Engine. Both the scene (LayerEngine, mounted
// by Globe.tsx) and the HUD (LayerPanel) should import from here rather than
// reaching into individual files — importing LayerEngine from here (or
// anywhere) is what triggers placeholder/future layer modules to register
// themselves, and every other file should be able to treat that as already
// having happened.
export { LayerEngine } from './LayerEngine'
export { getLayerDefinitions } from './layerRegistry'
export { toggleLayer, setLayerEnabled, isLayerEnabled, useLayerEnabledMap } from './layerStore'
export { saveLayerPreset, applyLayerPreset, deleteLayerPreset, useLayerPresets } from './layerPresetsStore'
export type { LayerDefinition } from './types'
export type { LayerPreset } from './layerPresetsStore'
