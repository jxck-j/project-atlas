import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
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

// THREE.Line/LineSegments.prototype.computeLineDistances() writes this same
// 'lineDistance' attribute, but only works as an instance method on an
// actual Line/LineSegments *object* (it reads `this.geometry`) — there's no
// object to call it on yet at the point borderGeometry is built here, just
// the BufferGeometry. This is that same algorithm (verbatim, from three.js's
// source) applied directly to a BufferGeometry instead, so every entry's
// border geometry is dash-ready (LineDashedMaterial requires this attribute
// to exist) the moment it's built — v3.1's geoOverlays/ClaimsOverlayLayer.tsx
// is the first consumer, but any future dashed border can reuse this
// unmodified. Harmless for the plain LineBasicMaterial borders elsewhere
// (GeoEntities.tsx, Countries.tsx) — they simply never read the attribute.
// Exported so ClaimsOverlayLayer.tsx's claimant-country border (built
// straight from Country features, not through buildGeoEntityEntries below)
// can dash too, without a second copy of this algorithm.
export function computeLineDistances(geometry: BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const distances = new Float32Array(position.count)
  const start = new Vector3()
  const end = new Vector3()
  for (let i = 1; i < position.count; i++) {
    start.fromBufferAttribute(position, i - 1)
    end.fromBufferAttribute(position, i)
    distances[i] = distances[i - 1] + start.distanceTo(end)
  }
  geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1))
}

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
    computeLineDistances(borderGeometry)

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
