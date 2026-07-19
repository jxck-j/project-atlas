import type { Country } from '../types'

// Mirrors src/layers/layerRegistry.ts's shape: a plain Map, not reactive,
// not tied to React at all. A registry answers "what's known right now" —
// runtime enabled/visible state (if a future layer ever needs it) belongs in
// a separate store, the same way layerStore.ts is split from layerRegistry.ts.
//
// Deliberately holds no opinion about *where* Country records come from. It
// doesn't import data/countries/countries.json itself, and isn't the thing
// that decides whether data is loaded from a static file, fetched from an
// API, or generated at runtime — that's tomorrow's Data Engine's job. This
// file only has to keep being "register one, look one up, look them all up,
// remove one," so swapping the loading mechanism later never means changing
// this contract or any of its consumers.
const registry = new Map<string, Country>()

/**
 * Adds a country to the registry. Throws if `country.id` is already
 * registered — unlike the Layer Registry (which warns and overwrites, since
 * re-registering the same layer id is a normal Vite HMR occurrence),
 * silently overwriting a Country here would hide a real bug: two different
 * data sources disagreeing about the same country is exactly the kind of
 * thing that should surface loudly, not get papered over. A caller that
 * genuinely wants to replace an entry should `removeCountry()` first.
 */
export function registerCountry(country: Country): void {
  if (registry.has(country.id)) {
    throw new Error(
      `[CountryRegistry] a country with id "${country.id}" is already registered. ` +
        `Call removeCountry("${country.id}") first if you intend to replace it.`
    )
  }
  registry.set(country.id, country)
}

/** Looks up a single country by id. Returns undefined if it isn't registered — never throws for a missing lookup, only for a duplicate registration. */
export function getCountry(id: string): Country | undefined {
  return registry.get(id)
}

/** Every currently-registered country, in registration order. */
export function getCountries(): Country[] {
  return Array.from(registry.values())
}

/** Removes a country by id. Returns whether anything was actually removed, so a caller can tell "removed" from "was never there" without a separate existence check. */
export function removeCountry(id: string): boolean {
  return registry.delete(id)
}
