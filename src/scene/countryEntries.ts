// "Raw country feature -> renderable {border, fill} geometry" — pulled out
// as its own module (v3.3.0) once a second consumer needed it:
// layers/geoOverlays/ClaimsOverlayLayer.tsx's RelatedCountriesOverlay
// already built this inline, and layers/geoOverlays/CategoryHighlightLayer.tsx
// needed the exact same thing for the 'country' category. Mirrors
// scene/geoEntityEntries.ts's buildGeoEntityEntries() — same reasoning,
// same shape, just for Country features instead of GeoEntity features
// (which come from a different topology/registry — see that file — so
// this couldn't just be a parameter on the existing function).
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Feature } from 'geojson'
import {
  geometryToBorderSegments,
  geometryToBorderSegmentsWithDistances,
  geometryToCentroid,
  geometryToFillMesh,
} from './countryGeometry'

export interface CountryEntry {
  id: string
  name: string
  centroid: { lat: number; lng: number }
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

/**
 * Builds one {id, name, borderGeometry, fillGeometry} entry per raw country
 * feature. `dashed` precomputes the border geometry's `lineDistance`
 * attribute, ring-aware (see `countryGeometry.ts`'s
 * `geometryToBorderSegmentsWithDistances` doc comment for why that matters
 * for any MultiPolygon/holed country — Russia, Indonesia, the Philippines,
 * ...), for a consumer that's going to render it with `LineDashedMaterial`;
 * omit it (the default) for a plain `LineBasicMaterial` border, which never
 * reads that attribute.
 */
export function buildCountryEntries(
  features: Feature[],
  borderRadius: number,
  fillRadius: number,
  options?: { dashed?: boolean }
): CountryEntry[] {
  return features.map((f, index) => {
    const id = f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`
    const borderGeometry = new BufferGeometry()
    if (options?.dashed) {
      const { positions, distances } = geometryToBorderSegmentsWithDistances(f.geometry, borderRadius)
      borderGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      borderGeometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1))
    } else {
      borderGeometry.setAttribute('position', new Float32BufferAttribute(geometryToBorderSegments(f.geometry, borderRadius), 3))
    }

    return {
      id,
      name: (f.properties?.name as string) ?? 'Unknown',
      centroid: geometryToCentroid(f.geometry),
      borderGeometry,
      fillGeometry: geometryToFillMesh(f.geometry, fillRadius),
    }
  })
}
