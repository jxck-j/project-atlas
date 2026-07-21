import type { Country, GeoEntity, DataProvenance, GeoPoint } from '../data'

/**
 * The minimal shape every geopolitical entity has, regardless of concrete
 * kind. `Country` and `GeoEntity` (src/data/types.ts) already satisfy this
 * structurally as they exist today — no changes needed to either — because
 * it's deliberately just their common ground (id/name/aliases/provenance),
 * not a new field either has to add. A future entity kind (organization,
 * conflict, infrastructure — see CLAUDE.md's engine list) only needs to
 * shape up to this same minimal interface to be resolvable the same way
 * `resolveCountry`/`resolveGeoEntity` work today.
 */
export interface GeopoliticalEntity {
  id: string
  name: string
  aliases: string[]
  provenance?: DataProvenance
}

/**
 * What EntityResolver actually returns: a GeopoliticalEntity's shared
 * fields, plus:
 *
 * - `kind` — a discriminant, so a consumer can tell a UN-member sovereign
 *   state apart from everything else and narrow to the concrete shape when
 *   it needs to. Deliberately just two members, not one per
 *   `GeoEntityType` — `'geo-entity'` covers all five v3 classifications
 *   (GeopoliticalEntity/Territory/StrategicRegion/MaritimeFeature/
 *   GeographicRegion) uniformly, since they already share one shape
 *   (`GeoEntity`, see data/types.ts) and one rendering treatment. A
 *   consumer that needs the finer classification reads `data.type`
 *   (`GeoEntityType`) rather than branching on `kind` itself.
 * - `location` — normalized. `Country.capital` and `GeoEntity.location` are
 *   the same `GeoPoint` shape under different field names; a caller that
 *   just wants "where do I put a marker" shouldn't need to know which
 *   registry an id came from to find it. Most `GeoEntity` records leave
 *   this undefined and rely on their rendered geometry's centroid instead
 *   (see scene/useGeoEntityFeatures.ts) — see data/types.ts's `location`
 *   doc comment.
 * - `data` — the full original record, for when a consumer needs
 *   kind-specific fields that don't belong in the shared shape (a
 *   country's `population`, a GeoEntity's `claimedBy`).
 *
 * A discriminated union rather than one loose interface with every field
 * optional, so adding a future entity kind is additive (one more union
 * member) instead of widening a shape every existing consumer already
 * narrows against.
 */
export type ResolvedEntity =
  | (GeopoliticalEntity & { kind: 'country'; location?: GeoPoint; data: Country })
  | (GeopoliticalEntity & { kind: 'geo-entity'; location?: GeoPoint; data: GeoEntity })
