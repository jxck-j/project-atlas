import { useSyncExternalStore } from 'react'
import { registerNewsItem } from './index'
import type { NewsItem } from './newsTypes'

// Pre-built by scripts/buildNews.mjs (`npm run build:news`), re-run on a
// recurring cron cadence rather than once at app-build time — see that
// script's own header comment. Raw JSON, not a generated .ts const like
// militaryScores.ts/economyScores.ts: a news feed needs to refresh without
// requiring an app rebuild, which a build-time-imported .ts module can't do.
const NEWS_URL = '/data/news.json'

// Singleton fetch-once store, same shape as scene/useCountryFeatures.ts —
// several consumers (NewsPanel, IntelligencePanel's Recent News section)
// need the same list. Lives in src/data/ rather than src/scene/ since News
// has no geometry/rendering dependency at all.
let items: NewsItem[] = []
let loaded = false
let fetchStarted = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureFetch() {
  if (fetchStarted) return
  fetchStarted = true

  fetch(NEWS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${NEWS_URL}: ${res.status}`)
      return res.json()
    })
    .then((data: NewsItem[]) => {
      items = data
      for (const item of items) {
        try {
          registerNewsItem(item)
        } catch {
          // Already registered — harmless (e.g. Vite HMR re-running this
          // module's top-level code in dev after an edit elsewhere).
        }
      }
      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly — the app still works without a News feed, same
      // "missing geo asset shouldn't break the globe" precedent
      // useCountryFeatures.ts already sets.
      console.warn('News data unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return items
}

function getLoadedSnapshot() {
  return loaded
}

/** Every news item, including non-published ones (pending-confirmation/retracted) — callers filter for their own purpose (see usePublishedNewsItems/usePendingNewsItems below). */
export function useNewsItems(): NewsItem[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useNewsFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}

/** Reader-facing items only — excludes anything not cleared to publish and anything retracted. */
export function usePublishedNewsItems(): NewsItem[] {
  const all = useNewsItems()
  return all.filter((item) => item.reviewStatus === 'auto-published' || item.reviewStatus === 'manual-only')
}

/** DEV-only internal ops queue content — see news-engine-design.md's "Pending-confirmation queue" section. Never reader-facing; callers must additionally gate on import.meta.env.DEV. */
export function usePendingNewsItems(): NewsItem[] {
  const all = useNewsItems()
  return all.filter((item) => item.reviewStatus === 'pending-confirmation')
}
