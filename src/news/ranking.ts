import { compareSeverity } from './severity'
import type { NewsEvent } from './types'

// Ranking from news-sourcing-design.md §10. One underlying rule everywhere —
// severity first, recency second — differing only in scope. Comparators are
// "sort ascending by this = best first", matching Array.prototype.sort.
// Recency keys off `eventTimestamp` (when it happened), not any source's
// publish time.

function time(event: NewsEvent): number {
  const t = Date.parse(event.eventTimestamp)
  return Number.isNaN(t) ? 0 : t
}

/** Most recent first; ties broken by id so the order is deterministic across builds. */
export function compareByRecency(a: NewsEvent, b: NewsEvent): number {
  return time(b) - time(a) || a.id.localeCompare(b.id)
}

/** Topic tabs and the Intelligence Panel's per-country top 3. */
export function compareBySeverityThenRecency(a: NewsEvent, b: NewsEvent): number {
  return compareSeverity(a.severity, b.severity) || compareByRecency(a, b)
}

/**
 * World tab's default landing rank: trending across the MOST countries
 * simultaneously first, then severity/recency within that. Chosen over "most
 * severe worldwide" so the default view isn't dominated by whatever is most
 * volatile that day regardless of breadth.
 */
export function compareWorld(a: NewsEvent, b: NewsEvent): number {
  return b.linkedEntityIds.length - a.linkedEntityIds.length || compareBySeverityThenRecency(a, b)
}

export const FEATURED_COUNT = 3

export interface FeaturedSplit {
  featured: NewsEvent[]
  /** Everything below the featured set: pure recency, no severity weighting — everywhere. */
  rest: NewsEvent[]
}

export function splitFeatured(
  events: NewsEvent[],
  featuredCompare: (a: NewsEvent, b: NewsEvent) => number,
  featuredCount: number = FEATURED_COUNT,
): FeaturedSplit {
  const ranked = [...events].sort(featuredCompare)
  return {
    featured: ranked.slice(0, featuredCount),
    rest: ranked.slice(featuredCount).sort(compareByRecency),
  }
}
