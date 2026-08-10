import { createStore } from 'zustand/vanilla'

// Plain (non-reactive) publisher for the currently-hovered state/province's
// entity id — same pattern hoveredCountry.ts/hoveredGeoEntity.ts already
// establish, needed here once StateProvinceLabels.tsx (v5.2.7) started
// rendering its passive label at the same centroid EntityRenderLayer.tsx's
// HoverLabel now also uses. Written by StatesProvinces.tsx's onHoverChange
// (converting the geometry id EntityRenderLayer reports into the entity id
// this store — and StateProvinceLabels.tsx's exclusion check — actually
// need; every province's geometry id already equals its entity id in
// practice, but converting through the entries list keeps this correct
// even if that ever stops being true, the same way GeoEntities.tsx's
// equivalent conversion has to for the 44 GeoEntities where it doesn't).
const hoveredStateProvinceStore = createStore<{ id: string | null }>(() => ({ id: null }))

export function setHoveredStateProvinceId(id: string | null) {
  hoveredStateProvinceStore.setState({ id })
}

export function getHoveredStateProvinceId(): string | null {
  return hoveredStateProvinceStore.getState().id
}
