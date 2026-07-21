import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Feature } from 'geojson'
import {
  geometryToAngularExtent,
  geometryToBorderSegments,
  geometryToCentroid,
  geometryToFillMesh,
} from './countryGeometry'
import { GLOBE_RADIUS } from './constants'
import { getEntity } from '../data'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'

// Pulled out of scene/GeoEntities.tsx (a plain .ts module, not .tsx) so
// scene/GeoEntities.tsx and the geoOverlays layers (src/layers/geoOverlays/)
// can share one "raw feature -> renderable entry" function without either
// .tsx file exporting a non-component value from itself — oxlint's
// react-refresh rule flags that (fast refresh only works when a component
// file *only* exports components), and it was right to.
const BORDER_RADIUS = GLOBE_RADIUS * 1.004
const FILL_RADIUS = GLOBE_RADIUS * 1.0

export interface GeoEntityEntry {
  // The rendered shape's own id — used for hover state and as the
  // GeometryMap lookup key. Deliberately NOT always the same as entityId:
  // GeometryMap exists specifically so a shape's id and the entity it
  // resolves to CAN differ (every numeric-ISO-id feature does differ;
  // name-keyed features happen to already equal their entity id — see
  // entities/entityGeometryIds.ts). selectionStore's `selected.id` is
  // always the resolved entity's id, never the geometry id — comparing
  // geometryId against `selected.id` directly means isSelected is never
  // true for a selected numeric-id entity. See LOGBOOK.md.
  geometryId: string
  entityId: string
  name: string
  centroid: { lat: number; lng: number }
  angularExtent: number
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

/**
 * Builds the {geometryId, entityId, geometry, ...} entry list from the raw
 * GeoJSON features useGeoEntityFeatures() returns. Shared by
 * scene/GeoEntities.tsx (primary selection) and the geoOverlays layers
 * (parent/claims overlays) so there's exactly one place that knows how to
 * turn a raw feature into a renderable entry.
 */
export function buildGeoEntityEntries(features: Feature[]): GeoEntityEntry[] {
  return features.flatMap((f) => {
    const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
    if (!geometryId) return []
    const entityId = ENTITY_GEOMETRY_IDS[geometryId] ?? geometryId

    // Prefer the registered GeoEntity's real display name ("Western Sahara")
    // over the raw source name ("W. Sahara") — the geometry file doesn't
    // rename features the way buildCountryTopology.mjs's
    // DISPLAY_NAME_OVERRIDES does for countries, so the nicer name lives in
    // GeoEntityRegistry instead.
    const name = getEntity(entityId)?.name ?? (f.properties?.name as string) ?? 'Unknown'

    const borderGeometry = new BufferGeometry()
    borderGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(geometryToBorderSegments(f.geometry, BORDER_RADIUS), 3)
    )

    return [
      {
        geometryId,
        entityId,
        name,
        centroid: geometryToCentroid(f.geometry),
        angularExtent: geometryToAngularExtent(f.geometry),
        borderGeometry,
        fillGeometry: geometryToFillMesh(f.geometry, FILL_RADIUS),
      },
    ]
  })
}
