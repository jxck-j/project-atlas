// Public barrel for the geopolitical data architecture. Consumers — future
// layers, the HUD, anything else — should import from here (`'../data'`)
// rather than reaching into `types.ts`, `registry/CountryRegistry.ts`, or
// (especially) the raw JSON files directly. That last part is the actual
// point: a layer that needs a country's data calls `getCountry(id)` and
// never needs to know whether that country came from a static JSON file, a
// future live API, or anywhere else — the registry is the seam that hides
// that decision, the same way `src/layers/index.ts` hides layer
// registration mechanics from `Globe.tsx`.
//
// Side-effect import: registers the real v3 entity dataset (see
// registry/geoEntities.ts) into GeoEntityRegistry as soon as this barrel is
// evaluated — same "importing the barrel is what guarantees registration
// has happened" guarantee layers/index.ts provides for the Layer Engine.
// Countries don't need an equivalent here: they're registered by
// scene/useCountryFeatures.ts once the country geometry fetch resolves,
// since there's no country data to register ahead of that.
import './registry/geoEntities'

export type {
  Country,
  GeoEntity,
  GeoEntityType,
  GeoEntityRelation,
  Conflict,
  Relationship,
  EntityRef,
  GeoPoint,
  DataProvenance,
  ConflictParticipant,
} from './types'

export { registerCountry, getCountry, getCountries, removeCountry } from './registry/CountryRegistry'
export {
  registerEntity,
  getEntity,
  getEntities,
  getEntitiesByType,
  getRelatedEntities,
} from './registry/GeoEntityRegistry'
