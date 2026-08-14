// Foundational data architecture for future layers (Country Engine,
// Relationship Engine, Intelligence Engine, Timeline Engine — see CLAUDE.md's
// engine list). These types describe geopolitical *attribute* data — facts
// about countries, territories, conflicts, and how entities relate to each
// other — deliberately separate from the *geometry* data in
// scene/countryGeometry.ts (which only knows how to draw a border on a
// sphere) and from the *display* data in countryProfiles.ts (which is a
// small, IntelligencePanel-specific, presentation-formatted dataset for the
// ~60 countries v1 already shows).
//
// Nothing here is wired into the app yet. The corresponding JSON files
// (data/countries/countries.json, etc.) are empty arrays — this is schema
// only, so future layers have a stable contract to build against before any
// real data or visualization exists.

/**
 * A reference to another record in this data architecture, used wherever one
 * entity needs to point at another (a Conflict's participants, a
 * Relationship's parties, a GeoEntity's parent/administrator/claimant).
 * Explicitly discriminated by which registry the id belongs to — rather than
 * a bare string id — because the id spaces are NOT guaranteed disjoint (a
 * GeoEntity and a Country could coincidentally share a slug), and because
 * consumers (e.g. a future Relationship Engine rendering an arc) need to
 * know which collection to look the id up in without guessing.
 *
 * `'territory'` is kept only as a legacy discriminant value for any old data
 * that still references it; nothing in this file emits it anymore as of v3
 * (see GeoEntity below) — new code should use `'geo-entity'`.
 */
export interface EntityRef {
  type: 'country' | 'territory' | 'geo-entity'
  id: string
}

/**
 * A single geographic point, independent of the sphere-projection math in
 * utils/geo.ts — this is plain lat/lng data as it would come from a JSON
 * file or an API, not a rendering-ready Vector3. A future layer converts it
 * with latLngToVector3 when it actually draws something.
 */
export interface GeoPoint {
  lat: number
  lng: number
  /** Optional human-readable label for this specific point, e.g. "Kyiv" or "Line of Control". */
  label?: string
}

/**
 * Where a piece of data came from and how fresh it is. Optional on every
 * record type below — v2.1's datasets are all empty, so nothing has
 * provenance yet — but present from the start so a future Data Engine
 * (live APIs, periodic refresh) has somewhere to record it without adding
 * fields to every interface retroactively.
 */
export interface DataProvenance {
  /** Free-text citation: an API name, a document, "manually curated", etc. */
  source?: string
  /** ISO 8601 timestamp of when this record was last verified/updated. */
  lastUpdated?: string
  /**
   * Whether this record is confirmed/verifiable vs. a rough estimate or
   * placeholder — lets a future layer visually distinguish (e.g. dashed vs.
   * solid) or filter out low-confidence data instead of presenting
   * everything with false authority.
   */
  confidence?: 'confirmed' | 'estimated' | 'unverified'
}

/**
 * A sovereign or de facto state. Scoped loosely to "the kind of entity that
 * could plausibly have its own capital and government" — the `status` field
 * is what distinguishes a UN member from a partially-recognized state,
 * rather than maintaining two separate interfaces.
 *
 * Note the overlap with data/countryProfiles.ts: that file is v1's existing,
 * already-shipped, presentation-formatted data for the IntelligencePanel
 * (population as "335 Million", GDP as "$27.4 Trillion") for ~60 countries.
 * This interface is intentionally broader and numeric/structured instead of
 * pre-formatted, because future layers will need to compute with this data
 * (sort by population, threshold by GDP, filter by region) — formatting for
 * display is a presentation-layer concern that belongs downstream of this
 * data, not baked into it. The two are not meant to merge automatically;
 * that migration (if it happens) is future work.
 */
export interface Country {
  /**
   * Stable identifier. Convention: ISO 3166-1 alpha-3 (e.g. "USA", "JPN",
   * "COD" for the Democratic Republic of the Congo) — a well-known,
   * internationally standardized code, which matters once Territory,
   * Conflict, and Relationship records start cross-referencing countries by
   * id and once a future Data Engine starts joining against external APIs
   * that almost universally key on ISO codes.
   */
  id: string
  /** Official or most common short name, e.g. "Japan". */
  name: string
  /**
   * Alternate names/spellings this country is known by — former names
   * ("Burma" for Myanmar), common short forms, or names in other scripts.
   * Exists so a future search/matching layer can resolve user input or
   * external-data-source naming without hardcoding synonym tables per
   * consumer (the exact problem `unMembers.ts`'s DISPLAY_NAME_OVERRIDES
   * currently solves for one specific dataset's naming quirks).
   */
  aliases: string[]
  /** ISO 3166-1 alpha-2 code, e.g. "JP" — kept alongside alpha-3 since some external data sources/APIs key on the two-letter form instead. */
  isoAlpha2?: string
  /**
   * Recognition/sovereignty status. Not every entity worth tracking is a
   * full UN member (the app's rendering layer is currently scoped to
   * exactly the 193 UN members — see unMembers.ts — but this data
   * architecture is intentionally broader so a future layer isn't blocked
   * from representing, say, an observer state).
   */
  status: 'un-member' | 'un-observer' | 'partially-recognized' | 'other'
  /** Capital city, structured (not a formatted string) so a future layer can plot it directly. */
  capital?: GeoPoint
  /** Form of government, e.g. "Federal Presidential Republic". Free text — governments don't decompose into a clean enum. */
  government?: string
  /** Broad grouping for filtering/legends in a future layer, e.g. "Europe", "Sub-Saharan Africa". Deliberately a plain string, not a closed union — see LOGBOOK.md's note on the Layer Engine's `category` field for the same reasoning: a new region should never require editing this file. */
  region?: string
  /** Total population as a plain number, not a formatted string — see the class doc comment above for why. */
  population?: number
  /**
   * Year the `population` figure is actually for. Populated alongside
   * `population` by scripts/buildGovCapitalPopGdp.mjs (see
   * data/countryEconomics.ts) — kept as an explicit field rather than
   * assumed to always be "current" so a consumer can tell a fresh figure
   * from a stale one without re-deriving it from `provenance.lastUpdated`.
   */
  populationYear?: number
  /** Gross domestic product in current US dollars, as a plain number. */
  gdpUsd?: number
  /**
   * Year the `gdpUsd` figure is actually for — may differ from
   * `populationYear`. A missing/stale source (see
   * scripts/buildGovCapitalPopGdp.mjs's World Bank lookback) can leave GDP
   * several years behind population for the same country, or vice versa.
   */
  gdpYear?: number
  provenance?: DataProvenance
}

/**
 * A named reference used in a GeoEntity's relationship fields
 * (`parentEntity`/`administeredBy`/`claimedBy`/`claims`) — one shape for all
 * four rather than a bespoke type per field, because they're all the same
 * fact structurally ("this other entity, related this way, since maybe this
 * date"); what makes them mean different things is which field they sit in,
 * not their own shape. `ref` is optional for the same reason it was on the
 * pre-v3 `ControllingAuthority`/`TerritoryClaimant` types it replaces: the
 * relevant party is frequently a government that isn't itself a registered
 * Country or GeoEntity (the Polisario Front/SADR administering part of
 * Western Sahara has no Country record) — `displayName` always works even
 * when `ref` can't resolve to anything.
 */
export interface GeoEntityRelation {
  /** Reference to a registered Country or GeoEntity, if this party is one. */
  ref?: EntityRef
  /** Always-available human-readable name — see the interface doc for why this can't just be `ref`. */
  displayName: string
  /**
   * Rough share of the entity this party administers, in plain language
   * (e.g. "majority of the territory, west of the berm") — not a precise
   * percentage, because precise percentages are themselves rarely agreed
   * upon. Only meaningful on `administeredBy` entries; omitted elsewhere.
   */
  extent?: string
  /** ISO 8601 date this relationship began, if known/relevant. */
  since?: string
}

/**
 * The seven-way classification this app's rendering/search/panel logic
 * dispatches on for anything that isn't a UN-member `Country`. Deliberately
 * a closed union (unlike `Country.region`'s free-form string) — these seven
 * meanings are load-bearing: they're what a consumer reads to decide "does
 * this look like a country," "does this get a parent-overlay," "does this
 * support multiple claimants without a sovereign owner." An eighth kind
 * requires a deliberate decision about how it renders, not just a new string
 * value slipping in.
 *
 * `'city'` is the one classification that does NOT share the polygon-based
 * rendering treatment every other member does (see the interface doc below)
 * — it's point geometry (scene/Cities.tsx renders a marker, not a merged
 * border/fill mesh), and it was still folded into this union rather than
 * given a wholly separate top-level classification specifically so it
 * reuses the relationship shape (parentEntity -> Country) and Intelligence
 * Panel plumbing every other classification already gets, rather than
 * duplicating GeoEntityRegistry/EntityResolver/search/Tab-cycling wiring
 * for one more top-level kind. A future classification that also can't use
 * the shared rendering treatment should make the same call, not default to
 * inventing a new top-level `ResolvedEntity.kind`.
 */
export type GeoEntityType =
  | 'geopolitical-entity'
  | 'territory'
  | 'strategic-region'
  | 'maritime-feature'
  | 'geographic-region'
  | 'administrative-division'
  | 'city'

/**
 * Anything geopolitically significant that is not a UN-member sovereign
 * state: a de facto/partially-recognized state with its own selectable
 * presence (Taiwan, Kosovo), a dependency or autonomous region with a
 * parent sovereign (Puerto Rico, Hong Kong), a militarily/strategically
 * significant area that isn't itself a country or a dependency (Guantanamo
 * Bay, the Siachen Glacier), a disputed maritime feature with no required
 * sovereign owner (the Spratly Islands), a region governed by treaty rather
 * than sovereignty (Antarctica), an uncontested first-level administrative
 * division of a sovereign state (a state, province, or similar subdivision
 * — Western Australia, California), or a national capital/major world city
 * (Paris, Tokyo). One interface for all seven classifications — not seven
 * separate interfaces — because they share the same relationship shape
 * (who's the parent, who administers it, who claims it, what does it
 * claim) and (six of seven — see `GeoEntityType`'s doc comment on `'city'`)
 * the same rendering treatment (selectable, merged border/fill geometry,
 * one Intelligence Panel layout); `type` is what a consumer switches on for
 * the handful of places that actually need to (search's tag, the panel's
 * "ENTITY TYPE" row), not a signal that these are unrelated shapes of data.
 * An administrative division's or city's `claimedBy`/`claims` are almost
 * always empty and its `administeredBy` always equals its `parentEntity` —
 * the relationship shape doesn't force every classification to use every
 * field meaningfully, and forcing a new interface just to omit two fields
 * would cost more than it'd clarify.
 *
 * Replaces the pre-v3 `Territory`/`ControllingAuthority`/`TerritoryClaimant`
 * types, which only modeled dependencies/disputed-territories and used a
 * `controllingAuthorities`/`claimants`/`parentCountryId` shape specific to
 * that one classification. `GeoEntityRelation` (above) is the same "ref
 * optional, displayName always present" design carried forward, just reused
 * across four relationship fields that apply uniformly to every classification
 * instead of three fields that only made sense for one.
 */
export interface GeoEntity {
  /** Stable identifier. Convention: lowercase slug (e.g. "western-sahara", "guantanamo-bay") — no equivalent to ISO 3166-1 exists for most of these. Administrative divisions are an exception: their slug is a lowercased ISO 3166-2 code (e.g. "au-wa" for Western Australia), since that standard exists and already guarantees global uniqueness. Cities have no standard code at all, so their slug is `${asciiName}-${countryAlpha3}` lowercased (e.g. "paris-fra") — see scripts/buildCitiesData.mjs. */
  id: string
  name: string
  aliases: string[]
  type: GeoEntityType
  /**
   * The sovereign entity this is formally, uncontroversially a part/
   * dependency of, if any (e.g. Puerto Rico -> USA, Greenland -> Denmark).
   * Singular and optional — unlike `administeredBy`/`claimedBy`/`claims`,
   * an entity has at most one formal parent; an entity with none (Taiwan,
   * Antarctica, the Spratly Islands) simply omits this field rather than
   * forcing a placeholder value.
   */
  parentEntity?: GeoEntityRelation
  /**
   * Every party currently exercising practical, on-the-ground
   * administrative control, right now — a statement of fact about who runs
   * it day to day, not a judgment about who *should*. A list because
   * real-world control is very often split (Western Sahara: Morocco west of
   * the berm, the Polisario Front/SADR east of it) or, rarely, genuinely
   * unclear — an empty array means exactly that, not "unknown, ask
   * elsewhere." Kept structurally separate from `claimedBy` for the same
   * reason the pre-v3 schema split control from claims: they frequently
   * disagree (Morocco controls Western Sahara; that control is a separate
   * fact from whether it's internationally recognized), and collapsing them
   * would silently force a political conclusion into the data model itself.
   */
  administeredBy: GeoEntityRelation[]
  /**
   * Every entity claiming sovereignty over THIS entity. Not necessarily the
   * same set as `administeredBy` — a claimant need not currently control
   * the territory it claims (Ukraine still claims Crimea without
   * controlling it), and a controlling authority does not necessarily
   * formally claim sovereign ownership.
   */
  claimedBy: GeoEntityRelation[]
  /**
   * Every entity THIS entity claims sovereignty over — the inverse
   * direction of `claimedBy`, and why the two are separate fields rather
   * than one "claims" field with a direction flag: a claims overlay
   * rendered from a selected entity needs to walk outward (what does the
   * selection claim) independently of walking inward (who claims the
   * selection), and doing that from one bidirectional list would require
   * every consumer to re-derive direction from context. Most entries in
   * this dataset only populate `claimedBy` (they're claimed, they don't
   * themselves claim anything) — `claims` exists for the cases that do
   * (a sovereign state claiming a disputed territory or maritime feature).
   */
  claims: GeoEntityRelation[]
  /**
   * Free-form metadata a future layer can key on without this dataset
   * needing to know those layers exist yet — see CLAUDE.md's Layer Engine
   * section and the geoOverlays layers in src/layers/. Every field is
   * optional and additive; a layer that doesn't care about, say,
   * `strategicSignificance` simply never reads it.
   */
  metadata?: {
    /** Why this place matters militarily/strategically, e.g. for a future military layer. Most relevant to 'strategic-region' entries but not exclusive to them. */
    strategicSignificance?: string
    /** Governing legal/treaty framework, e.g. "Antarctic Treaty System" — most relevant to 'geographic-region' entries. */
    treatyFramework?: string
    /** Freeform tags a future conflict/alliance/intelligence layer can filter or group on. */
    tags?: string[]
  }
  /** Approximate centroid, for search/camera-fly when no rendered geometry exists for this entity (see entities/entityGeometryIds.ts) — most entities here DO have real geometry and derive their location from it instead; this is the fallback for the ones that don't (e.g. Crimea, which has no standalone polygon anywhere in the source data). */
  location?: GeoPoint
  /**
   * Total population as a plain number — mirrors Country.population above,
   * for the same reason (a future layer computes on this; formatting is a
   * render-time concern via utils/formatScale.ts, not baked in here). Most
   * entries are `undefined`: a GeoEntity only gets a real figure once a
   * human has hand-verified a source for it in
   * src/data/registry/geoEntities.ts (see
   * scripts/buildGeoEntityEconomics.mjs, which reports World Bank WDI
   * figures for review but never writes into that file directly) — unlike
   * Country's population/gdpUsd, which scripts/buildGovCapitalPopGdp.mjs
   * merges in automatically at runtime for every UN member.
   */
  population?: number
  /** Year the `population` figure is actually for — see Country.populationYear above for why this is tracked explicitly rather than assumed current. */
  populationYear?: number
  /** Gross domestic product in current US dollars, as a plain number — mirrors Country.gdpUsd above. See `population`'s doc comment for why this is hand-verified per entity rather than auto-merged. */
  gdpUsd?: number
  /** Year the `gdpUsd` figure is actually for — may differ from `populationYear`. See Country.gdpYear above. */
  gdpYear?: number
  provenance?: DataProvenance
}

/**
 * One participant in a Conflict. `ref` is optional — not every party to a
 * conflict is a tracked Country or Territory (non-state actors, coalitions,
 * or entities this dataset simply doesn't model yet), so `displayName`
 * exists as a fallback that always works.
 */
export interface ConflictParticipant {
  ref?: EntityRef
  /** Required if `ref` is omitted; optional (redundant) override otherwise, e.g. a coalition name that isn't the country's own name. */
  displayName?: string
  role: 'aggressor' | 'defender' | 'mediator' | 'supporting' | 'other'
}

/**
 * A conflict, in the broad sense — interstate war, civil war, insurgency, or
 * a territorial dispute that hasn't turned violent. Intentionally minimal
 * and structural: this is scaffolding for a future layer, not an attempt to
 * characterize any real, ongoing conflict. See LOGBOOK.md for why this
 * dataset ships empty and stays that way until there's an actual editorial
 * process behind it — the project has already noted elsewhere
 * (IntelligencePanel's placeholder sections) that fabricating this kind of
 * assessment casually isn't something to do.
 */
export interface Conflict {
  /** Stable identifier. Convention: lowercase slug. */
  id: string
  name: string
  aliases: string[]
  type: 'interstate' | 'civil-war' | 'insurgency' | 'territorial-dispute' | 'other'
  status: 'active' | 'ceasefire' | 'frozen' | 'resolved' | 'historical'
  /** ISO 8601 date. */
  startDate?: string
  /** ISO 8601 date; omitted/undefined for an ongoing conflict. */
  endDate?: string
  participants: ConflictParticipant[]
  /**
   * One or more locations associated with this conflict — plural because a
   * conflict is very often not a single point (multiple fronts, cities, or
   * a whole contested region).
   */
  locations: GeoPoint[]
  /**
   * Coarse, deliberately non-numeric severity band rather than a casualty
   * count or similar statistic — a future layer can use this for something
   * like marker size/color without this dataset needing to be a source of
   * truth for sensitive figures it has no real editorial process to verify.
   */
  severity?: 'low' | 'medium' | 'high' | 'unknown'
  provenance?: DataProvenance
}

/**
 * A relationship between two or more entities: an alliance, a treaty, a
 * trade partnership, a rivalry, or a standing tension. One interface covers
 * all of these (rather than separate Alliance/Tension types) because they
 * share the same shape — who's involved, what kind of relationship, since
 * when — and a future Relationship Engine will very likely want to render
 * them all the same way (an arc or edge between entities), just styled by
 * `type`.
 */
export interface Relationship {
  /** Stable identifier. Convention: lowercase slug. */
  id: string
  /** Short label, e.g. "NATO", "Sino-Indian border tension". */
  name?: string
  type: 'alliance' | 'treaty' | 'trade-partnership' | 'tension' | 'rivalry' | 'other'
  /**
   * Every entity involved. A list rather than a from/to pair because
   * alliances are frequently multilateral (NATO has 30+ members) — a
   * strictly bilateral relationship is just a list of length 2, so no
   * information is lost by not special-casing it.
   */
  parties: EntityRef[]
  /**
   * Whether this relationship is symmetric (an alliance binds all parties
   * equally) or points from one party to another (a unilateral sentiment,
   * e.g. one country's stated tension toward another that isn't
   * necessarily reciprocated). For 'unilateral', `parties[0]` is the source
   * and `parties[1]` is the target by convention.
   */
  directionality: 'multilateral' | 'bilateral' | 'unilateral'
  status: 'active' | 'historical' | 'proposed'
  /** ISO 8601 date. */
  since?: string
  /**
   * Optional 0-1 strength/intensity, for a future layer to map to visual
   * weight (arc thickness, opacity) without needing its own scoring logic.
   * Left as a plain number rather than an enum since "how strong is this
   * alliance" is inherently more continuous than the categorical fields
   * elsewhere in this file.
   */
  strength?: number
  description?: string
  provenance?: DataProvenance
}
