import { useSyncExternalStore } from 'react'
import type { TickerFile, TickerPost } from '../news/tickerTypes'

// The per-tab first-hand ticker's shipped asset, built by scripts/buildFirstHandTicker.mjs (`npm run build:news:ticker`) — a separate,
// much faster cadence than news-events.json (§15c), so unlike useNewsEvents.ts this is re-fetched every time the NEWS tab opens
// (`refreshFirstHandTicker`) rather than once per session: a ticker that is hours stale across a long session defeats it.
//
// Only the TYPES come from src/news/firstHandTicker.ts; the file's contents were already gated at build time (English, recent,
// Layer 1 content-safety, on-topic). Nothing here filters for safety, because a client-side filter would not stop the file being served.
const TICKER_URL = '/data/news-firsthand.json'

let posts: TickerPost[] = []
let generatedAt: string | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

/**
 * Fetches the file, bypassing the HTTP cache. Fails quietly and keeps whatever was already loaded — the file is gitignored, so it is
 * legitimately absent on a fresh clone, and the rest of the NEWS tab works without it (the same precedent useNewsEvents.ts sets).
 */
export function refreshFirstHandTicker() {
  fetch(TICKER_URL, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${TICKER_URL}: ${res.status}`)
      return res.json()
    })
    .then((data: TickerFile) => {
      if (!Array.isArray(data.posts)) throw new Error('unexpected shape')
      posts = data.posts
      generatedAt = data.generatedAt
      notify()
    })
    .catch((err) => {
      console.warn('First-hand ticker unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFirstHandTickerPosts(): TickerPost[] {
  return useSyncExternalStore(subscribe, () => posts)
}

/** ISO time the file was built, or null until one has loaded. */
export function useFirstHandTickerGeneratedAt(): string | null {
  return useSyncExternalStore(subscribe, () => generatedAt)
}
