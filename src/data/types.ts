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
 * Relationship's parties, a Territory's administering power). Explicitly
 * discriminated between 'country' and 'territory' — rather than a bare
 * string id — because the two id spaces are NOT guaranteed disjoint (a
 * territory and a country could coincidentally share a slug), and because
 * consumers (e.g. a future Relationship Engine rendering an arc) need to
 * know which collection to look the id up in without guessing.
 */
export interface EntityRef {
  type: 'country' | 'territory'
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
  /** Gross domestic product in current US dollars, as a plain number. */
  gdpUsd?: number
  provenance?: DataProvenance
}

/**
 * A claim by one country on a Territory — deliberately its own type rather
 * than a bare EntityRef, because a claim needs to say *what kind* of claim
 * it is, and a territory frequently has more than one of these
 * simultaneously (the entire reason this field is a list).
 */
export interface TerritoryClaimant {
  countryId: string
  claimType: 'recognized-sovereign' | 'de-facto-control' | 'disputed-claim' | 'historical-claim'
  /** ISO 8601 date the claim began, if known/relevant. */
  since?: string
}

/**
 * A geographic entity that is not (or not universally recognized as) a
 * sovereign country: a dependency, an autonomous region, a disputed area, or
 * an unrecognized/partially-recognized state. Split out from Country instead
 * of folding into it with a "disputed" flag because territories have a
 * fundamentally different shape of data — most importantly, more than one
 * claimant — that would otherwise force every consumer of Country to handle
 * a rare case.
 */
export interface Territory {
  /** Stable identifier. Convention: lowercase slug (e.g. "western-sahara", "kashmir") — no equivalent to ISO 3166-1 exists for most disputed/dependent territories. */
  id: string
  name: string
  aliases: string[]
  status: 'disputed' | 'dependency' | 'autonomous-region' | 'unrecognized-state' | 'other'
  /**
   * Every country that claims this territory, and how. A territory with
   * zero claimants would be unusual but is not disallowed by the type — an
   * uninhabited/unclaimed area is still representable.
   */
  claimants: TerritoryClaimant[]
  /**
   * The country this territory is formally a dependency/part of, if any
   * (e.g. Puerto Rico -> USA). Distinct from `claimants` — a recognized
   * dependency isn't "disputed," it's administratively attached to exactly
   * one parent, whereas claimants covers contested sovereignty.
   */
  parentCountryId?: string
  /** Approximate centroid, for placing a label before any real geometry integration exists. */
  location?: GeoPoint
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
