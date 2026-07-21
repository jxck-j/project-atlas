import { getCountry, getEntity } from '../data'
import type { ResolvedEntity } from './types'

// Decouples "an id came from a clicked map polygon" from "which registry
// actually holds that id." scene/Countries.tsx and scene/GeoEntities.tsx
// both resolve every click through here rather than reaching into
// CountryRegistry/GeoEntityRegistry directly — that's the actual point of
// "hiding registry implementation details": a consumer calls
// resolveEntity(id) and gets a uniform ResolvedEntity back, never learning
// (or caring) whether it came from a Map lookup, a future API call, or
// anywhere else.

/**
 * Resolves an id to whichever geopolitical entity it belongs to — checks
 * the Country Registry first, then the GeoEntity Registry. The order only
 * matters if a country id and a GeoEntity id ever collided (they don't
 * currently, by convention: countries use ISO 3166-1 alpha-3, GeoEntity
 * records use ad hoc slugs — see data/types.ts), but is written explicitly
 * so that's a deliberate choice, not an accident, if that ever changes.
 * Returns undefined if the id isn't registered anywhere.
 */
export function resolveEntity(id: string): ResolvedEntity | undefined {
  return resolveCountry(id) ?? resolveGeoEntity(id)
}

/** Resolves an id against the Country Registry only. Returns undefined if it isn't a registered country (regardless of whether it's a registered GeoEntity). */
export function resolveCountry(id: string): ResolvedEntity | undefined {
  const country = getCountry(id)
  if (!country) return undefined

  return {
    kind: 'country',
    id: country.id,
    name: country.name,
    aliases: country.aliases,
    provenance: country.provenance,
    location: country.capital,
    data: country,
  }
}

/** Resolves an id against the GeoEntity Registry only (covers all five v3 classifications — see data/types.ts's GeoEntityType). Returns undefined if it isn't a registered GeoEntity (regardless of whether it's a registered country). */
export function resolveGeoEntity(id: string): ResolvedEntity | undefined {
  const geoEntity = getEntity(id)
  if (!geoEntity) return undefined

  return {
    kind: 'geo-entity',
    id: geoEntity.id,
    name: geoEntity.name,
    aliases: geoEntity.aliases,
    provenance: geoEntity.provenance,
    location: geoEntity.location,
    data: geoEntity,
  }
}
