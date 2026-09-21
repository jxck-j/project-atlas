import { isReaderVisible } from './publishGate'
import { compareBySeverityThenRecency, compareWorld, splitFeatured, type FeaturedSplit } from './ranking'
import { getNewsTab } from './tabs'
import type { NewsEvent, NewsTabId } from './types'

// Client-side filtering over static Event JSON (§11) — no backend, no runtime
// calls. Filters compose (AND); within `countryIds`, any match counts, so a
// region preset is just a bundle of country ids.

export interface EventFilter {
  /** Omit for a tab-less view (the Intelligence Panel's per-country list). */
  tab?: NewsTabId
  /** Any-of. An empty array means "no country filter", same as omitting it. */
  countryIds?: string[]
  /** A SystemicThemeConfig id. */
  themeId?: string
}

/** Reader-visible Events matching every supplied filter. */
export function filterEvents(events: NewsEvent[], { tab, countryIds, themeId }: EventFilter = {}): NewsEvent[] {
  const tag = tab ? getNewsTab(tab).topicTag : null
  return events.filter((event) => {
    if (!isReaderVisible(event.reviewStatus)) return false
    if (tag && !event.topicTags.includes(tag)) return false
    if (countryIds && countryIds.length > 0 && !event.linkedEntityIds.some((id) => countryIds.includes(id))) return false
    if (themeId && !event.systemicThemes.includes(themeId)) return false
    return true
  })
}

/**
 * Filter, then rank into the featured top-N plus the pure-recency remainder.
 * The World tab ranks featured by breadth first; every other view (topic
 * tabs, the Intelligence Panel) ranks by severity then recency.
 */
export function buildFeed(events: NewsEvent[], filter: EventFilter = {}): FeaturedSplit {
  const compare = filter.tab === 'world' ? compareWorld : compareBySeverityThenRecency
  return splitFeatured(filterEvents(events, filter), compare)
}
