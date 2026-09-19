// News Engine schema — see news-engine-design.md (repo root) for the full
// settled design (severity-gated publishing, wire-tier corroboration bypass,
// ranking rules). Kept in its own file rather than folded into data/types.ts:
// that file is the Country/GeoEntity/Conflict/Relationship shared attribute
// schema; a News item is closer in shape to a Military/Economy/Technology/
// Current Status Intelligence Engine category (its own generated data,
// keyed by the same numeric country id) than to a hand-curated relationship
// record, so it gets the same "own file" treatment those categories'
// *Scores.ts files get, even though the output here is static JSON rather
// than a generated .ts const (see buildNews.mjs's own header comment for
// why).

/** The seven-tag topic taxonomy — deliberately orthogonal to the Military/Economy/Technology/Current Status scoring dimensions, not a mirror of them. An item can carry more than one. */
export type NewsTopicTag =
  | 'conflict-security'
  | 'terrorism-non-state-actors'
  | 'diplomacy-politics'
  | 'economic-trade'
  | 'humanitarian-displacement'
  | 'crime-trafficking'
  | 'science-technology'

/** Assigned at ingestion via tag-scoped heuristics, confirmed/overridden manually — see the design doc's severity-gated publishing section for what each tier requires to publish. */
export type NewsSeverity = 'routine' | 'significant' | 'high-stakes'

/** Independent-source corroboration state. `'wire-confirmed'` can be set directly from a single allowlisted wire-tier outlet's own report — see NewsSource.tier below — without needing the 2+ count `osint-corroborated` otherwise requires. */
export type NewsCorroboration = 'wire-confirmed' | 'osint-corroborated (2+)' | 'unconfirmed'

/** `'retracted'` (added alongside the original three) applies to any already-published item the source itself walks back — stays in the dataset for audit purposes but drops out of both ranked lists, same as an unpublished item. */
export type NewsReviewStatus = 'auto-published' | 'pending-confirmation' | 'manual-only' | 'retracted'

/** AllSides/Ad Fontes-style editorial-leaning label — only ever set on an `'outlet'` source, never a `'first-hand'` one (see NewsSource below). */
export type NewsLeaning = 'left' | 'center-left' | 'center' | 'center-right' | 'right'

/**
 * Discriminated by `sourceType`: an `'outlet'` article carries a leaning
 * label (which must trace to a citable framework, per the design doc) and an
 * optional wire-tier marker; a `'first-hand'` account (e.g. Telegram) gets no
 * leaning field at all — a leaning badge implies editorial slant, which
 * misrepresents raw testimony. No first-hand data ships in v1 (see
 * buildNews.mjs's own header comment / BACKLOG.md) but the shape is real so
 * the UI doesn't need a second pass once it does.
 */
export interface NewsSource {
  sourceType: 'outlet' | 'first-hand'
  /** Outlet display name, e.g. "BBC News". Present iff sourceType is 'outlet'. */
  outlet?: string
  leaning?: NewsLeaning
  /** Citation for the leaning label itself, e.g. "AllSides Media Bias Chart". Present iff `leaning` is. */
  leaningSource?: string
  /** `'wire'` marks an allowlisted wire-tier outlet (see buildNews.mjs's WIRE_TIER_DOMAINS) whose own report alone satisfies `corroboration: 'wire-confirmed'`. */
  tier?: 'wire'
  /** Channel identifier for a first-hand account, e.g. a Telegram channel name. Present iff sourceType is 'first-hand'. */
  channel?: string
  /** Factual, non-editorializing note on who's speaking, e.g. "posted by soldier of X unit". Only ever set on a first-hand source. */
  affiliationNote?: string
}

/**
 * A non-state actor, notable person, or named military asset mentioned in a
 * news item — deliberately NOT a GeoEntity-style record (no
 * claims/administeredBy/parentEntity relationship modeling, no registry, no
 * dedicated drill-down page). Fills the gap news-engine-design.md
 * explicitly deferred ("a non-state actor doesn't map cleanly onto the
 * existing 193-country GeoEntity schema"), scoped intentionally narrower
 * than that schema — "drill-down" here just means filtering the News tab's
 * grid to matching items, the same thing region/country filtering already
 * do. See buildNews.mjs's own header comment for the hand-curated,
 * will-go-stale keyword tables that populate this.
 */
export interface NewsMentionedEntity {
  type: 'organization' | 'person' | 'asset'
  name: string
}

export interface NewsItem {
  id: string
  headline: string
  summary: string
  /** Country ids this item is linked to, using the same numeric ISO topology id every other Intelligence Engine category keys by (plus the literal 'taiwan') — see buildNews.mjs's country-resolution pass. */
  linkedEntityIds: string[]
  /** Always present, even when empty — same "never omitted" convention topicTags/linkedEntityIds already use. */
  mentionedEntities: NewsMentionedEntity[]
  topicTags: NewsTopicTag[]
  severity: NewsSeverity
  sourceType: NewsSource['sourceType']
  source: NewsSource
  corroboration: NewsCorroboration
  reviewStatus: NewsReviewStatus
  /** ISO 8601 date this snapshot was ingested/published by. */
  snapshotDate: string
  url: string
  /** Thumbnail image URL, when the source feed provides one — not every outlet does (see buildNews.mjs's own header comment), so this is genuinely optional, never a placeholder/stock image. */
  imageUrl?: string
}
