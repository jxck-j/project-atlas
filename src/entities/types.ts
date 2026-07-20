import type { Country, Territory, DataProvenance, GeoPoint } from '../data'

/**
 * The minimal shape every geopolitical entity has, regardless of concrete
 * kind. `Country` and `Territory` (src/data/types.ts) already satisfy this
 * structurally as they exist today — no changes needed to either — because
 * it's deliberately just their common ground (id/name/aliases/provenance),
 * not a new field either has to add. A future entity kind (organization,
 * conflict, infrastructure — see CLAUDE.md's engine list) only needs to
 * shape up to this same minimal interface to be resolvable the same way
 * `resolveCountry`/`resolveTerritory` work today.
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
 * - `kind` — a discriminant, so a consumer can tell entities apart and
 *   narrow to the concrete shape when it needs to.
 * - `location` — normalized. `Country.capital` and `Territory.location` are
 *   the same `GeoPoint` shape under different field names; a caller that
 *   just wants "where do I put a marker" shouldn't need to know which
 *   registry an id came from to find it.
 * - `data` — the full original record, for when a consumer needs
 *   kind-specific fields that don't belong in the shared shape (a
 *   country's `population`, a territory's `claimants`).
 *
 * A discriminated union rather than one loose interface with every field
 * optional, so adding a future entity kind is additive (one more union
 * member) instead of widening a shape every existing consumer already
 * narrows against.
 */
export type ResolvedEntity =
  | (GeopoliticalEntity & { kind: 'country'; location?: GeoPoint; data: Country })
  | (GeopoliticalEntity & { kind: 'territory'; location?: GeoPoint; data: Territory })
