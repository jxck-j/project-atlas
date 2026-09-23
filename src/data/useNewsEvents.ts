import { useSyncExternalStore } from 'react'
import type { NewsEvent } from '../news/types'

// News Engine v2's shipped asset, built by scripts/buildNewsEvents.mjs
// (`npm run build:news:events`) on a recurring cadence rather than at
// app-build time — raw JSON rather than a generated .ts const for the same
// reason v1's feed was: a news feed has to refresh without an app rebuild.
//
// The file carries reader-visible Events ONLY. Anything awaiting manual
// confirmation (a head-of-state death claim) is deliberately never served —
// see buildNewsEvents.mjs — so unlike v1 there is no pending-queue hook here,
// and no DEV-only queue panel for the client to render.
const NEWS_EVENTS_URL = '/data/news-events.json'

// Singleton fetch-once store, same shape as useNewsFeatures.ts/useCountryFeatures.ts:
// NewsPanel and IntelligencePanel's per-country section need the same list.
let events: NewsEvent[] = []
let loaded = false
let fetchStarted = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureFetch() {
  if (fetchStarted) return
  fetchStarted = true

  fetch(NEWS_EVENTS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${NEWS_EVENTS_URL}: ${res.status}`)
      return res.json()
    })
    .then((data: NewsEvent[]) => {
      events = data
      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly — the globe and every other panel work without a feed,
      // the same precedent useCountryFeatures.ts sets for a missing geo asset.
      console.warn('News events unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return events
}

function getLoadedSnapshot() {
  return loaded
}

/** Every published Event. Reader-visibility is re-checked by `filterEvents` rather than assumed from the file. */
export function useNewsEvents(): NewsEvent[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useNewsEventsLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
