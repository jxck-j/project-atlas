import type { Territory } from '../types'

// Same architecture as CountryRegistry.ts (and, one level further back,
// src/layers/layerRegistry.ts): a plain, non-reactive Map. See
// CountryRegistry.ts for the full reasoning — it applies here unchanged.
// This file only knows how to register/look up territories; it has no
// opinion about where Territory records come from (a JSON file, a future
// API, the illustrative examples in exampleTerritories.ts) and doesn't
// import any of them itself.
const registry = new Map<string, Territory>()

/**
 * Adds a territory to the registry. Throws if `territory.id` is already
 * registered, for the same reason CountryRegistry.registerCountry() does —
 * there's no benign reason for a duplicate id yet, so it's treated as a bug
 * to surface rather than a case to silently resolve.
 */
export function registerTerritory(territory: Territory): void {
  if (registry.has(territory.id)) {
    throw new Error(
      `[TerritoryRegistry] a territory with id "${territory.id}" is already registered.`
    )
  }
  registry.set(territory.id, territory)
}

/** Looks up a single territory by id. Returns undefined if it isn't registered. */
export function getTerritory(id: string): Territory | undefined {
  return registry.get(id)
}

/** Every currently-registered territory, in registration order. */
export function getTerritories(): Territory[] {
  return Array.from(registry.values())
}
