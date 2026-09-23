import { archiveKey, type ArchivedArticle } from './articleArchive'
import type { RawArticle } from './eventBuilder'

// The rolling window the public feed is built from (Phase 4, J's call).
//
// WHY: the v2 build is stateless and RSS only ever exposes the last day or
// two, so a build from one pull publishes only what happened since the last
// pull — v1 avoided that by carrying its own previous output forward and
// re-ingesting it. v2 doesn't need that trick, because the article archive
// (articleArchive.ts) already holds every article any run has seen. The build
// reads the archive instead, and this is the only place that decides how far
// back it looks.
//
// The cap is on the FEED, never on the archive: the archive keeps everything
// forever (it is not regenerable), and narrowing the window here only changes
// what today's published asset covers.

/** Matches `data/newsRecency.ts`'s widest reader-facing option — keep the two in step, or the UI offers history the feed doesn't hold. */
export const FEED_RETENTION_DAYS = 14

const DAY_MS = 86_400_000

/**
 * When an article happened, for windowing and for the time-ordered clusterer.
 * Falls back to first sighting, because an article with no usable feed date
 * still has a real moment this project first saw it — and dropping it instead
 * would silently lose whole feeds that ship no pubDate.
 */
export function articleTime(article: ArchivedArticle): number {
  const published = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN
  if (!Number.isNaN(published)) return published
  const seen = Date.parse(article.firstSeenAt)
  return Number.isNaN(seen) ? 0 : seen
}

/**
 * The archived articles inside the retention window, oldest first — the order
 * both clusterers assume (greedy, time-ordered). Articles dated in the future
 * (a feed's clock skew) are kept: they're recent by any reading, and dropping
 * a real article over a timestamp quirk is the worse error.
 */
export function selectFeedWindow(
  archived: ArchivedArticle[],
  now: string,
  retentionDays: number = FEED_RETENTION_DAYS,
): RawArticle[] {
  const nowMs = Date.parse(now)
  const cutoff = (Number.isNaN(nowMs) ? Date.now() : nowMs) - retentionDays * DAY_MS
  return archived
    .filter((article) => articleTime(article) >= cutoff)
    .sort((a, b) => articleTime(a) - articleTime(b))
    .map(({ firstSeenAt, ...article }) => ({
      ...article,
      // A dateless feed item would otherwise be stamped with BUILD time by
      // `prepare()` — which, on an archive-backed build, would claim a
      // two-week-old article just happened. First sighting is the honest
      // floor: it is the earliest moment this project can show it existed.
      publishedAt: article.publishedAt ?? firstSeenAt,
    }))
}

/**
 * Fills in metadata the archived copy of an article doesn't have but this
 * run's live pull does — currently only `imageUrl`.
 *
 * The archive is append-only and first-sighting-wins on purpose (a feed
 * editing a headline must not rewrite history), so a field added to
 * `RawArticle` after an article was archived can never appear on that stored
 * record. Without this, every article archived before 2026-09-23 would render
 * imageless forever. Enriching only the BUILD's copy keeps both properties:
 * the archive is still never rewritten, and today's feed uses the richest
 * version of an article it actually has.
 *
 * Only fills gaps — a value already in the archive wins, so this can't
 * overwrite what was first seen.
 */
export function applyPullMetadata(articles: RawArticle[], pulled: RawArticle[]): RawArticle[] {
  const images = new Map<string, string>()
  for (const article of pulled) if (article.imageUrl) images.set(archiveKey(article.url), article.imageUrl)
  if (images.size === 0) return articles
  return articles.map((article) => {
    if (article.imageUrl) return article
    const imageUrl = images.get(archiveKey(article.url))
    return imageUrl ? { ...article, imageUrl } : article
  })
}
