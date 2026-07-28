import { createStore } from 'zustand/vanilla'

// Plain (non-reactive) publisher for the currently-hovered country id,
// written by Countries.tsx's onPointerOver/onPointerOut. Read imperatively
// by CountryLabels.tsx's throttled declutter tick (inside useFrame,
// already reading getGlobeRotationY() the same way) so the passive
// Google-Maps-style label for a country doesn't render redundantly next to
// that same country's glowing HoverLabel while it's being hovered — same
// "plain module value crosses the boundary, nothing reactive has to"
// pattern globeRotation.ts already established for the equivalent
// scene-internal cross-component read.
const hoveredCountryStore = createStore<{ id: string | null }>(() => ({ id: null }))

export function setHoveredCountryId(id: string | null) {
  hoveredCountryStore.setState({ id })
}

export function getHoveredCountryId(): string | null {
  return hoveredCountryStore.getState().id
}
