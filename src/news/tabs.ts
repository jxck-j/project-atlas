import type { NewsTabId, TopicTag } from './types'

// Tab structure from news-sourcing-design.md §9a. Tabs are an overlapping
// filter over topicTags, not a partition: an Event carrying several tags
// appears in every matching tab (§4a multi-tag placement rule).

export interface NewsTabDef {
  id: NewsTabId
  label: string
  /** null for World — the landing tab is a trending-across-countries view, not a topicTag filter. */
  topicTag: TopicTag | null
  /** Ambient per-tab discussion panel (§9b). World stays a pure news landing view. */
  communityPulse: boolean
  /** Per-tab first-hand text ticker (§15b), scoped to `topicTag`. */
  firstHandTicker: boolean
}

export const NEWS_TABS: readonly NewsTabDef[] = [
  { id: 'world', label: 'World', topicTag: null, communityPulse: false, firstHandTicker: false },
  { id: 'conflict', label: 'Conflict', topicTag: 'conflict-security', communityPulse: true, firstHandTicker: true },
  { id: 'terrorism', label: 'Terrorism', topicTag: 'terrorism-non-state-actors', communityPulse: true, firstHandTicker: true },
  { id: 'politics', label: 'Politics', topicTag: 'diplomacy-politics', communityPulse: true, firstHandTicker: true },
  { id: 'business', label: 'Business', topicTag: 'economic-trade', communityPulse: true, firstHandTicker: true },
  { id: 'energy', label: 'Energy', topicTag: 'energy', communityPulse: true, firstHandTicker: true },
  { id: 'humanitarian', label: 'Humanitarian', topicTag: 'humanitarian-displacement', communityPulse: true, firstHandTicker: true },
  { id: 'crime', label: 'Crime', topicTag: 'crime-trafficking', communityPulse: true, firstHandTicker: true },
  { id: 'tech', label: 'Tech', topicTag: 'science-technology', communityPulse: true, firstHandTicker: true },
]

export function getNewsTab(id: NewsTabId): NewsTabDef {
  const tab = NEWS_TABS.find((t) => t.id === id)
  if (!tab) throw new Error(`[news/tabs] unknown tab id "${id}"`)
  return tab
}
