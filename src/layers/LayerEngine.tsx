import { LayerManager } from './LayerManager'
// Side-effect import: each placeholder module calls registerLayer() at
// import time. This is the one place that bootstraps the registry — Globe.tsx
// only ever imports LayerEngine, never a specific layer.
import './placeholders'

// Public entry point for the whole Layer Engine. The Rendering Engine
// (Globe.tsx) mounts this and nothing else layer-related; it doesn't know
// what layers exist, only that "the layer engine" renders whatever's
// currently enabled.
export function LayerEngine() {
  return <LayerManager />
}
