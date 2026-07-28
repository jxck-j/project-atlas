import { createStore } from 'zustand/vanilla'

// Plain (non-reactive) publisher for the globe's current ambient Y rotation,
// written every frame in Globe.tsx. Lets code outside the Canvas — the
// search bar — compute a country's current world-space direction from its
// lat/lng without needing a mesh reference to read localToWorld() from.
// Read imperatively at the moment it's needed (search submit), not
// subscribed to for rendering, so a zustand vanilla store (no React hook)
// is enough — nothing here needs a component to re-render on change.
const globeRotationStore = createStore<{ y: number }>(() => ({ y: 0 }))

export function setGlobeRotationY(y: number) {
  globeRotationStore.setState({ y })
}

export function getGlobeRotationY(): number {
  return globeRotationStore.getState().y
}
