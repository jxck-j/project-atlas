import { getCountry, getTerritory } from '../data'
import type { ResolvedEntity } from './types'

// Decouples "an id came from a clicked map polygon" from "which registry
// actually holds that id." The globe currently only ever treats a clicked
// polygon as a country (see scene/Countries.tsx) — this module doesn't
// change that yet, it's the seam a future click handler would go through
// instead of calling getCountry() directly, so that a click can eventually
// resolve to a Territory (Taiwan, Crimea, Western Sahara, ...) without the
// click handler itself needing an if/else over which registry to check.
//
// Nothing outside src/entities/ should need to import CountryRegistry or
// TerritoryRegistry directly once something starts consuming entities this
// way — that's the actual point of "hiding registry implementation
// details": a consumer calls resolveEntity(id) and gets a uniform
// ResolvedEntity back, never learning (or caring) whether it came from a
// Map lookup, a future API call, or anywhere else.

/**
 * Resolves an id to whichever geopolitical entity it belongs to — checks
 * the Country Registry first, then the Territory Registry. The order only
 * matters if a country id and a territory id ever collided (they don't
 * currently, by convention: countries use ISO 3166-1 alpha-3, territories
 * use ad hoc slugs — see data/types.ts), but is written explicitly so
 * that's a deliberate choice, not an accident, if that ever changes.
 * Returns undefined if the id isn't registered anywhere.
 */
export function resolveEntity(id: string): ResolvedEntity | undefined {
  return resolveCountry(id) ?? resolveTerritory(id)
}

/** Resolves an id against the Country Registry only. Returns undefined if it isn't a registered country (regardless of whether it's a registered territory). */
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

/** Resolves an id against the Territory Registry only. Returns undefined if it isn't a registered territory (regardless of whether it's a registered country). */
export function resolveTerritory(id: string): ResolvedEntity | undefined {
  const territory = getTerritory(id)
  if (!territory) return undefined

  return {
    kind: 'territory',
    id: territory.id,
    name: territory.name,
    aliases: territory.aliases,
    provenance: territory.provenance,
    location: territory.location,
    data: territory,
  }
}
