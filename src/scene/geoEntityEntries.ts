import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Feature } from 'geojson'
import {
  geometryToAngularExtent,
  geometryToBorderSegmentsWithDistances,
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

// Shared dash sizing for every dashed/"hatched" border this app renders —
// originally local to layers/geoOverlays/ClaimsOverlayLayer.tsx (the first
// consumer of dashed borders, v3.1), moved here so scene/EntityRenderLayer.tsx's
// own dashed-border option (`dashedBorders`, currently unused — see its own
// doc comment) uses the exact same dash scale as ClaimsOverlayLayer.tsx
// instead of picking its own and drifting apart, should a future caller
// turn it on again.
//
// 2026-08-15: fractions of each ring/line's own length (countryGeometry.ts's
// geometryToBorderSegmentsWithDistances/geometryToLineSegmentsWithDistances
// normalize their `distances` output to [0, 1] per ring), not world units —
// previously these were absolute world-space lengths, which meant a small
// shape's whole perimeter could be shorter than one dash+gap cycle and
// render as an unbroken solid line. At these values a dash+gap cycle is
// ~1/12 of a ring's length, so every ring shows roughly the same number of
// dashes (~10-12) regardless of its actual size. (States/provinces itself
// stopped using dashing on 2026-08-16 — see StatesProvinces.tsx — but
// ClaimsOverlayLayer.tsx's dashed claim outlines still do, and still
// benefit from this normalization.)
export const DASH_SIZE = 0.05
export const GAP_SIZE = 0.033

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

    const { positions, distances } = geometryToBorderSegmentsWithDistances(f.geometry, BORDER_RADIUS)
    const borderGeometry = new BufferGeometry()
    borderGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    // Every entry's border is dash-ready (LineDashedMaterial requires this
    // attribute) the moment it's built, computed ring-aware at the source —
    // see geometryToBorderSegmentsWithDistances' own doc comment for why
    // that matters. Harmless for the plain LineBasicMaterial borders most
    // callers render (GeoEntities.tsx, Countries.tsx-shaped entries) — they
    // simply never read this attribute.
    borderGeometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1))

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
