// News Engine v2 schema — see news-sourcing-design.md (repo root), §4-§8,
// §12, §17. That doc is the source of truth wherever it disagrees with v1's
// `data/newsTypes.ts` (NewsItem, 3 severity tiers, 7 topic tags), which stays
// untouched until the Phase 4 UI cutover so the shipped NEWS tab keeps working
// in the meantime. Type names here are deliberately distinct from v1's
// (`TopicTag` vs `NewsTopicTag`, `Severity` vs `NewsSeverity`) so an import
// can never silently pick up the wrong generation.
//
// Everything under src/news/ is pure (no DOM, no network, no React) so it can
// run identically in Vitest, in scripts/buildNews.mjs's eventual v2 rewrite,
// and in the client.

/** Event-type tags (§4a) — eight, one per topic tab except World. An Event can carry several; it appears in every matching tab (multi-tag placement rule). */
export type TopicTag =
  | 'conflict-security'
  | 'terrorism-non-state-actors'
  | 'diplomacy-politics'
  | 'economic-trade'
  | 'energy'
  | 'humanitarian-displacement'
  | 'crime-trafficking'
  | 'science-technology'

/** Four tiers, most severe first in meaning (§5). Rank order lives in severity.ts, not here. */
export type Severity = 'critical' | 'major' | 'significant' | 'routine'

/**
 * Derived from an Event's dossier by corroboration.ts (§8, §17a) — never
 * stored on an Event. Ordered wire-confirmed > outlet-corroborated (4+) >
 * specialist-verified > osint-corroborated (2+) > unconfirmed.
 * `'outlet-corroborated (4+)'` is a 2026-09-20 amendment to §8: Critical's
 * floor is wire-confirmed OR four distinct outlets, because no wire feed is
 * currently reachable (see LOGBOOK.md).
 */
export type Corroboration =
  | 'wire-confirmed'
  | 'outlet-corroborated (4+)'
  | 'specialist-verified'
  | 'osint-corroborated (2+)'
  | 'unconfirmed'

/**
 * `'pending-confirmation'` is now ONLY the head-of-state/government death
 * queue (§8) — the one manual review surface left. `'manual-only'` keeps
 * v1's meaning: a human confirmed it and it is published. `'retracted'` is
 * carried over from v1 (a source walked the claim back — audit-only, never
 * reader-visible); v2's doc doesn't mention it, but dropping it would
 * regress a v1 behavior for no stated reason.
 * An Event below its corroboration floor has no status at all — the build
 * simply doesn't emit it (see publishGate.ts).
 */
export type ReviewStatus = 'auto-published' | 'pending-confirmation' | 'manual-only' | 'retracted'

/** AllSides' actual 5-point scale (§7), not a collapsed 3-point one — preserves distinctions like Middle East Eye's "Left" vs. others' "Lean Left". */
export type Leaning = 'left' | 'lean-left' | 'center' | 'lean-right' | 'right'

export type LeaningConfidence = 'high' | 'medium' | 'low/initial'

export type OutletTier = 'wire' | 'broadsheet' | 'broadcast' | 'regional-specialist' | 'country-native'

/** For `tier: 'country-native'` outlets, where AllSides' left/right doesn't apply (§7). */
export type PressControl = 'state-controlled' | 'state-run-democratic' | 'independent' | 'exile'

/** `'provisional'` = the design doc itself flags the entry as not directly reconfirmed; kept in the roster, surfaced for a re-vetting pass. */
export type VettingStatus = 'confirmed' | 'provisional'

// ---------------------------------------------------------------------------
// Source profiles — the vetted roster (sources.json), one record per
// publisher. Distinct from SourceEntry below, which is one *report* by a
// publisher inside one Event's dossier.

export interface OutletProfile {
  id: string
  /** Display name, e.g. "Reuters". Always store/display with any disambiguating qualifier ("The Daily Star (Lebanon)"). */
  name: string
  sourceType: 'outlet'
  leaning?: Leaning
  /** Citation for the leaning label (AllSides first; Ad Fontes/MBFC only as fallback). Present iff `leaning` is. */
  leaningSource?: string
  /** Carries AllSides' own stated confidence rather than presenting every rating as equally certain. Only ever set alongside `leaning`, and left unset where AllSides states none. */
  leaningConfidence?: LeaningConfidence
  /** True when AllSides' own methods disagree, or AllSides materially disagrees with other major raters. Only meaningful with `leaning`. */
  contested?: boolean
  tier?: OutletTier
  /** Surfaced in the UI caption bar, not buried (e.g. "state-funded"). */
  caveat?: string
  pressControl?: PressControl
  /** Citation to RSF / Freedom House context for the country. Gives `pressControl` the same defensibility standard `leaningSource` gives `leaning`. */
  pressFreedomContext?: string
  /** Distinguishes competing-authority outlets (Yemen's two SABAs, Libya) that a single `pressControl` label can't. */
  affiliationNote?: string
  /** UN-193 topology name (or "Taiwan") for `tier: 'country-native'` sources — resolved to a linked entity id at build time. */
  countryName?: string
  vetting: VettingStatus
  notes?: string
}

export interface AnalysisProfile {
  id: string
  /** The org's name — the doc's `org` field. */
  name: string
  sourceType: 'analysis'
  /** Fixed — never editable per-source, never a leaning (§7). */
  label: 'Non-partisan analysis'
  /** ISW / ACLED / Bellingcat: run their own verification methodology, so a claim they log independently is `specialist-verified` (§8) — modeled as a flag on an analysis org rather than a fourth sourceType, since the doc lists them as OSINT/data-verification specialists alongside, not instead of, the analysis category. */
  specialistVerified?: boolean
  vetting: VettingStatus
  notes?: string
}

export type SourceProfile = OutletProfile | AnalysisProfile

// ---------------------------------------------------------------------------
// Event dossier (§17b)

export type SourceCategory =
  | 'outlet'
  | 'analysis'
  | 'first-hand'
  | 'official-statement'
  | 'community-discussion'
  | 'live-video'

interface SourceEntryBase {
  id: string
  /** Stable identity of the publisher (a SourceProfile id, or a channel/issuing-body slug). Two entries with the same sourceId are ONE independent source for corroboration — e.g. two Bloomberg feeds count once. */
  sourceId: string
  /**
   * Whether this entry may count toward corroboration. Stored per entry so
   * the Community Pulse "never evidence" wall (§9b) survives being nested in
   * a dossier — but corroboration.ts additionally forces it off for
   * `'community-discussion'` and `'live-video'` regardless of this flag, so a
   * bad flag value can't breach the wall.
   */
  countsTowardCorroboration: boolean
  refUrl: string
  /** ISO 8601. The publisher's own publish time — distinct from the Event's `eventTimestamp`. */
  timestamp: string
}

export interface OutletSourceEntry extends SourceEntryBase {
  sourceCategory: 'outlet'
  outlet: string
  leaning?: Leaning
  leaningSource?: string
  leaningConfidence?: LeaningConfidence
  contested?: boolean
  tier?: OutletTier
  caveat?: string
  pressControl?: PressControl
}

export interface AnalysisSourceEntry extends SourceEntryBase {
  sourceCategory: 'analysis'
  org: string
  label: 'Non-partisan analysis'
  specialistVerified?: boolean
}

export interface FirstHandSourceEntry extends SourceEntryBase {
  sourceCategory: 'first-hand'
  /** Fixed string, never per-source editable, never a leaning. */
  label: 'First-hand account'
  channel: string
  /** Factual only. For combatant-affiliated channels this must be prominent and specific ("Pro-Russian military blogger"), not a soft caveat (§15a). */
  affiliationNote?: string
  /** §15a tier 1 (verification specialists) — same standing as ISW/ACLED/Bellingcat. */
  specialistVerified?: boolean
}

export type StatementType = 'press-release' | 'press-conference' | 'official-social-post'

/** A primary-source statement, not journalism — deliberately no `leaning` field (§17c). */
export interface OfficialStatementSourceEntry extends SourceEntryBase {
  sourceCategory: 'official-statement'
  issuingBody: string
  statementType: StatementType
}

export interface CommunityDiscussionSourceEntry extends SourceEntryBase {
  sourceCategory: 'community-discussion'
  platform: 'reddit' | 'twitter' | 'telegram'
  sourceCommunity: string
}

export interface LiveVideoSourceEntry extends SourceEntryBase {
  sourceCategory: 'live-video'
}

export type SourceEntry =
  | OutletSourceEntry
  | AnalysisSourceEntry
  | FirstHandSourceEntry
  | OfficialStatementSourceEntry
  | CommunityDiscussionSourceEntry
  | LiveVideoSourceEntry

/**
 * The primary object (§17) — a real-world occurrence with a heterogeneous
 * source dossier attached. There is deliberately NO `corroboration` field:
 * it is derived from `sources` by `deriveCorroboration()`.
 */
export interface NewsEvent {
  id: string
  /** Short, neutral, factual — "Explosion reported in Kyiv," never editorializing. */
  title: string
  /** Canonical UTC time of the occurrence itself, ISO 8601 — distinct from any source's publish time. Recency ranking keys off this. */
  eventTimestamp: string
  /** Country ids — the same numeric ISO topology ids every Intelligence Engine category uses (plus the literal 'taiwan'). */
  linkedEntityIds: string[]
  topicTags: TopicTag[]
  /** SystemicThemeConfig ids (systemicThemes.json). Retained on historical events even after a theme is archived. */
  systemicThemes: string[]
  severity: Severity
  /** Set by the classifier when the claim is that a head of state/government was killed — the one claim type that needs manual confirmation even after wire confirmation (§8). */
  headOfStateDeathClaim?: boolean
  /** A human confirmed a `headOfStateDeathClaim` event (Admin Console review queue, §14). */
  manuallyConfirmed?: boolean
  reviewStatus: ReviewStatus
  sources: SourceEntry[]
  /** ISO 8601 date this snapshot was built. */
  snapshotDate: string
}

// ---------------------------------------------------------------------------
// Systemic themes (§4b) — living set, reviewed quarterly.

/** Retirement is archival, never deletion: an archived theme keeps its historical linkage and can flip back to 'active'. */
export type ThemeStatus = 'active' | 'archived'

export interface SystemicThemeConfig {
  id: string
  label: string
  status: ThemeStatus
  /** ISO date of the last archive/reactivate flip, for the quarterly review trail. */
  statusChangedAt?: string
}

// ---------------------------------------------------------------------------
// Tabs (§9a)

export type NewsTabId =
  | 'world'
  | 'conflict'
  | 'terrorism'
  | 'politics'
  | 'business'
  | 'energy'
  | 'humanitarian'
  | 'crime'
  | 'tech'
