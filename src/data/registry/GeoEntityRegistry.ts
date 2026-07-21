import type { GeoEntity, GeoEntityType } from '../types'

// Same architecture as CountryRegistry.ts (and, one level further back,
// src/layers/layerRegistry.ts): a plain, non-reactive Map. See
// CountryRegistry.ts for the full reasoning — it applies here unchanged.
// This file only knows how to register/look up GeoEntity records; it has no
// opinion about where they come from (a JSON file, a future API, the
// hand-authored dataset in registry/geoEntities.ts).
//
// v3 replaces the pre-v3 TerritoryRegistry with this single registry
// covering all five non-sovereign classifications (GeoEntityType) — see
// data/types.ts's GeoEntity doc comment for why one registry/one interface
// instead of one per classification. CountryRegistry stays separate and
// unchanged: a UN-member sovereign state is a different enough shape of data
// (population, GDP, capital) that folding it in here would force every
// GeoEntity consumer to handle fields that only ever apply to countries.
const registry = new Map<string, GeoEntity>()

/**
 * Adds a GeoEntity to the registry. Throws if `entity.id` is already
 * registered, for the same reason CountryRegistry.registerCountry() does —
 * there's no benign reason for a duplicate id yet, so it's treated as a bug
 * to surface rather than a case to silently resolve.
 */
export function registerEntity(entity: GeoEntity): void {
  if (registry.has(entity.id)) {
    throw new Error(`[GeoEntityRegistry] an entity with id "${entity.id}" is already registered.`)
  }
  registry.set(entity.id, entity)
}

/** Looks up a single entity by id. Returns undefined if it isn't registered. */
export function getEntity(id: string): GeoEntity | undefined {
  return registry.get(id)
}

/** Every currently-registered entity, in registration order. */
export function getEntities(): GeoEntity[] {
  return Array.from(registry.values())
}

/** Every currently-registered entity of one classification — e.g. every 'strategic-region'. */
export function getEntitiesByType(type: GeoEntityType): GeoEntity[] {
  return Array.from(registry.values()).filter((entity) => entity.type === type)
}

/**
 * Every registered entity connected to `id` through a relationship field
 * (`parentEntity`/`administeredBy`/`claimedBy`/`claims`), in either
 * direction: entities `id` itself points at, and entities that point at
 * `id`. Walking both directions is the point — `claims`/`claimedBy` are
 * split fields precisely so a consumer can tell direction apart (see
 * GeoEntityRelation's doc comment), but "what's related to this entity at
 * all" (for a claims-overlay layer, or a future relationship graph view)
 * legitimately wants both directions at once rather than making every
 * caller union two separate queries. Only resolves relations whose `ref`
 * points at another GeoEntity (`ref.type === 'geo-entity'`) — a relation
 * pointing at a Country (e.g. Puerto Rico's `parentEntity` -> USA) isn't
 * something this registry can resolve; that's what EntityResolver/
 * CountryRegistry are for.
 */
export function getRelatedEntities(id: string): GeoEntity[] {
  const relatedIds = new Set<string>()

  const entity = registry.get(id)
  if (entity) {
    for (const relation of [entity.parentEntity, ...entity.administeredBy, ...entity.claimedBy, ...entity.claims]) {
      if (relation?.ref?.type === 'geo-entity') relatedIds.add(relation.ref.id)
    }
  }

  for (const candidate of registry.values()) {
    if (candidate.id === id) continue
    const relations = [candidate.parentEntity, ...candidate.administeredBy, ...candidate.claimedBy, ...candidate.claims]
    if (relations.some((relation) => relation?.ref?.type === 'geo-entity' && relation.ref.id === id)) {
      relatedIds.add(candidate.id)
    }
  }

  return Array.from(relatedIds)
    .map((relatedId) => registry.get(relatedId))
    .filter((e): e is GeoEntity => e !== undefined)
}
