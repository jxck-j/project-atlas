// How recent a News-tab item has to be to show — the 24 hrs / 3 days / 7 days / 14 days control in hud/NewsPanel.tsx.
//
// The longest window here must match FEED_RETENTION_DAYS in src/news/feedWindow.ts: the build publishes a rolling 14-day window out
// of the article archive, so a wider window in the UI would silently promise history the file doesn't hold.

const HOUR_MS = 60 * 60 * 1000

export const NEWS_RECENCY_WINDOWS = [
  { id: '24h', label: '24 HRS', phrase: '24 hours', ms: 24 * HOUR_MS },
  { id: '3d', label: '3 DAYS', phrase: '3 days', ms: 3 * 24 * HOUR_MS },
  { id: '7d', label: '7 DAYS', phrase: '7 days', ms: 7 * 24 * HOUR_MS },
  { id: '14d', label: '14 DAYS', phrase: '14 days', ms: 14 * 24 * HOUR_MS },
] as const

export type NewsRecencyId = (typeof NEWS_RECENCY_WINDOWS)[number]['id']

// Widest window, so the default view is everything the feed holds — the same content the tab showed before the control existed.
export const DEFAULT_NEWS_RECENCY: NewsRecencyId = '14d'

export function getNewsRecencyWindow(id: NewsRecencyId) {
  return NEWS_RECENCY_WINDOWS.find((w) => w.id === id) ?? NEWS_RECENCY_WINDOWS[NEWS_RECENCY_WINDOWS.length - 1]
}

/** True when `snapshotDate` is no older than the window, measured from `now`. A date slightly in the future (feed clock skew) counts as within. */
export function isWithinRecency(snapshotDate: string, id: NewsRecencyId, now: number): boolean {
  return now - new Date(snapshotDate).getTime() <= getNewsRecencyWindow(id).ms
}
