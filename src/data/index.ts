// Public barrel for the geopolitical data architecture. Consumers — future
// layers, the HUD, anything else — should import from here (`'../data'`)
// rather than reaching into `types.ts`, `registry/CountryRegistry.ts`, or
// (especially) the raw JSON files directly. That last part is the actual
// point: a layer that needs a country's data calls `getCountry(id)` and
// never needs to know whether that country came from a static JSON file, a
// future live API, or anywhere else — the registry is the seam that hides
// that decision, the same way `src/layers/index.ts` hides layer
// registration mechanics from `Globe.tsx`.
export type {
  Country,
  Territory,
  Conflict,
  Relationship,
  EntityRef,
  GeoPoint,
  DataProvenance,
  TerritoryClaimant,
  ControllingAuthority,
  ConflictParticipant,
} from './types'

export { registerCountry, getCountry, getCountries, removeCountry } from './registry/CountryRegistry'
export { registerTerritory, getTerritory, getTerritories } from './registry/TerritoryRegistry'
