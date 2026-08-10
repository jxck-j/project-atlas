import { createStore } from 'zustand/vanilla'

// Plain (non-reactive) publisher for the currently-hovered GeoEntity's
// ENTITY id (not its geometry id — see geoEntityEntries.ts's GeoEntityEntry
// doc comment for why the two can differ) — same pattern hoveredCountry.ts
// already established for Countries.tsx, needed here once GeoEntityLabels.tsx
// (v5.2.7) started rendering its passive label at the same centroid
// EntityRenderLayer.tsx's HoverLabel now also uses (no more leader-line
// callout to keep them visually apart — see LOGBOOK.md's v5.2.7 entry).
// Written by GeoEntities.tsx's onHoverChange (converting the geometry id
// EntityRenderLayer reports into the entity id this store — and
// GeoEntityLabels.tsx's exclusion check — actually need).
const hoveredGeoEntityStore = createStore<{ id: string | null }>(() => ({ id: null }))

export function setHoveredGeoEntityId(id: string | null) {
  hoveredGeoEntityStore.setState({ id })
}

export function getHoveredGeoEntityId(): string | null {
  return hoveredGeoEntityStore.getState().id
}
