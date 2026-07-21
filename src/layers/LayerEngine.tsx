import { LayerManager } from './LayerManager'
// Side-effect imports: each layer module (placeholder or real) calls
// registerLayer() at import time. This is the one place that bootstraps the
// registry — Globe.tsx only ever imports LayerEngine, never a specific
// layer. './geoOverlays' (v3) is the first non-placeholder layer set — see
// CLAUDE.md's Layer Engine section, which anticipated this exact spot as
// "wherever the app's 'real' layer set ends up being composed."
import './placeholders'
import './geoOverlays'

// Public entry point for the whole Layer Engine. The Rendering Engine
// (Globe.tsx) mounts this and nothing else layer-related; it doesn't know
// what layers exist, only that "the layer engine" renders whatever's
// currently enabled.
export function LayerEngine() {
  return <LayerManager />
}
