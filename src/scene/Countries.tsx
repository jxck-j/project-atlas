import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Vector3 } from 'three'
import { useCountryFeatures } from './useCountryFeatures'
import { geometryToAngularExtent, geometryToBorderSegments, geometryToCentroid, geometryToFillMesh } from './countryGeometry'
import { GLOBE_RADIUS } from './constants'
import { selectCountry, selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { setHoveredCountryId } from './hoveredCountry'
import { EntityRenderLayer } from './EntityRenderLayer'
import type { GeoEntityEntry } from './geoEntityEntries'

const BORDER_RADIUS = GLOBE_RADIUS * 1.004
// Well clear of the core sphere (0.98*RADIUS in Globe.tsx) to leave room
// against z-fighting now that there's much denser 193-country geometry.
const FILL_RADIUS = GLOBE_RADIUS * 1.0

export function Countries() {
  const features = useCountryFeatures()
  const { selected } = useSelection()

  // Builds its own entries rather than reusing scene/countryEntries.ts's
  // buildCountryEntries() — that shared helper doesn't carry angularExtent
  // (nothing else that uses it needs the HoverLabel size threshold below).
  // A country's geometryId and entityId are always the same string (unlike
  // a GeoEntity's — see geoEntityEntries.ts), so both fields here just hold
  // this one id; that's what lets these entries feed straight into the
  // same EntityRenderLayer GeoEntities.tsx uses.
  const countries = useMemo<GeoEntityEntry[]>(() => {
    return features.map((f, index) => {
      const borderGeometry = new BufferGeometry()
      borderGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(geometryToBorderSegments(f.geometry, BORDER_RADIUS), 3)
      )

      // A handful of disputed territories (Kosovo, N. Cyprus, Somaliland)
      // have no numeric feature id in this topology, so `f.id` is
      // undefined for all of them — falling back to just String(f.id)
      // would give them all the same id "undefined" and make them select
      // and highlight as one. The array index is always unique.
      const id = f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`

      return {
        geometryId: id,
        entityId: id,
        name: (f.properties?.name as string) ?? 'Unknown',
        centroid: geometryToCentroid(f.geometry),
        angularExtent: geometryToAngularExtent(f.geometry),
        borderGeometry,
        fillGeometry: geometryToFillMesh(f.geometry, FILL_RADIUS),
      }
    })
  }, [features])

  function handleSelect(country: GeoEntityEntry, direction: Vector3) {
    // Geometry -> entity: check for an explicit geometry mapping first
    // (for a future shape whose id doesn't equal its entity id — e.g. a
    // carved-out territory), then fall back to resolving the polygon's own
    // id directly, which is what actually resolves every country today
    // (geometry id and country id are still the same string — see
    // GeometryMap.ts and CLAUDE.md's Entity Resolution section).
    const resolved = getEntityForGeometry(country.geometryId) ?? resolveEntity(country.entityId)

    if (resolved) {
      selectEntity(resolved, direction)
    } else {
      // Shouldn't happen once useCountryFeatures.ts has populated the
      // Country Registry, but falls back to the country-shaped selection
      // path so a click can never just silently do nothing.
      selectCountry({ id: country.entityId, name: country.name, direction })
    }
    // Temporary console visibility during development.
    console.log(resolved?.name ?? country.name)
  }

  return (
    <EntityRenderLayer
      entries={countries}
      selectedEntityId={selected?.id}
      onSelect={handleSelect}
      onHoverChange={setHoveredCountryId}
    />
  )
}
