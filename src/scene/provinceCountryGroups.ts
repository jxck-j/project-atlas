import { getEntity } from '../data'
import type { GeoEntityEntry } from './geoEntityEntries'

// A province's parent country id, resolved via the GeoEntityRegistry
// (registered by useStatesProvincesFeatures.ts's registerEntity call).
// GeoEntityEntry itself doesn't carry this — it's a shape shared with
// every other GeoEntityType, most of which have no such concept — so
// anything needing "which country is this province part of" looks it up
// here instead of the registry directly, one place doing the lookup.
export function getParentCountryId(entry: GeoEntityEntry): string | undefined {
  return getEntity(entry.entityId)?.parentEntity?.ref?.id
}

export function groupEntriesByCountry(entries: GeoEntityEntry[]): Map<string, GeoEntityEntry[]> {
  const groups = new Map<string, GeoEntityEntry[]>()
  for (const entry of entries) {
    const countryId = getParentCountryId(entry)
    if (!countryId) continue
    const group = groups.get(countryId)
    if (group) group.push(entry)
    else groups.set(countryId, [entry])
  }
  return groups
}
