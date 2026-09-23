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
 * World tab's landing rank. §10 put BREADTH first here — trending across the
 * most countries at once — to keep the default view from being dominated by
 * whatever is most volatile that day. Seeing it built (Phase 4), J reversed
 * that: it put Significant stories in the featured row while Critical and
 * Major ones sat in the grid below, which reads as a broken feed. Severity
 * leads here exactly as everywhere else, and breadth is only a tie-break
 * WITHIN a tier — so "trending everywhere" still wins between two equally
 * severe stories, it just can't outrank a more serious one.
 */
export function compareWorld(a: NewsEvent, b: NewsEvent): number {
  return compareSeverity(a.severity, b.severity) || b.linkedEntityIds.length - a.linkedEntityIds.length || compareByRecency(a, b)
}

export const FEATURED_COUNT = 3

export interface FeaturedSplit {
  featured: NewsEvent[]
  /**
   * Everything below the featured set. §10 says pure recency here, but v1
   * shipped that and it was reported directly: a just-in Routine item
   * outranking an older Significant one reads as a broken feed. So the
   * remainder is severity, then recency — the same rule as everywhere else,
   * which also makes §10's "same underlying rule everywhere" literally true.
   * Carried forward into v2 at J's direction (2026-09-23); the design doc's
   * §10 carries the amendment note.
   */
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
    rest: ranked.slice(featuredCount).sort(compareBySeverityThenRecency),
  }
}
