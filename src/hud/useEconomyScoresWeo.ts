import { useSyncExternalStore } from 'react'

// IMF WEO Economy source TRIAL — see scripts/buildEconomyWeo.mjs's own
// header comment and LOGBOOK.md's 2026-08-22 entry for the full reasoning.
// Unlike src/data/economyScores.ts (WDI-sourced, bundled at build time,
// the real app data), this is fetched at RUNTIME from a gitignored,
// locally-generated public/debug/economyScoresWeo.json — it only exists on
// a machine that's actually run `npm run build:economy-weo-trial`, so
// every consumer of this hook has to handle "not generated yet" as a real,
// expected state, not an error. Not adopted; this exists so the trial can
// actually be looked at inside the running app, not just as a downloaded
// JSON file.
const WEO_TRIAL_URL = '/debug/economyScoresWeo.json'

export interface WeoEconomyComponentValue {
  raw: number | null
  normalized: number | null
  year?: number
  /** gdpGrowth only — see economyScores.ts's own EconomyComponentValue. */
  years?: number[]
  sourceUrl?: string
  /** Present only when this specific value is IMF WEO's staff projection, not a finalized actual — see buildEconomyWeo.mjs's PROJECTION FLAGGING comment. */
  projectionNote?: string
}

// Same shape as src/data/economyScores.ts's EconomyScore, plus
// projectionNote per component — see buildEconomyWeo.mjs's own output
// writer for where this shape comes from. `id` is the numeric ISO topology
// id for every real UN member, EXCEPT Taiwan, which is `'taiwan'` (its
// GeoEntity registry id — see that script's TAIWAN header section for why).
export interface WeoEconomyScore {
  id: string
  name: string
  value: number | null
  confidence: 'measured' | 'proxy' | 'unavailable'
  coveragePresent: number
  coverageTotal: number
  components: {
    gdpPpp: WeoEconomyComponentValue
    gdpPerCapitaPpp: WeoEconomyComponentValue
    gdpGrowth: WeoEconomyComponentValue
    unemploymentRate: WeoEconomyComponentValue
    inflationCpi: WeoEconomyComponentValue
  }
}

// Singleton store, same "fetch once, share the result" pattern as
// scene/useCountryFeatures.ts. `scores` stays `null` while loading OR if
// the trial file was never generated on this machine — both render as "not
// available," a normal state for trial data, not something to warn about
// the way scene/useCountryFeatures.ts's real-data fetch failure does.
let scores: Record<string, WeoEconomyScore> | null = null
let loaded = false
let fetchStarted = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureFetch() {
  if (fetchStarted) return
  fetchStarted = true

  fetch(WEO_TRIAL_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status}`)
      return res.json()
    })
    .then((entries: WeoEconomyScore[]) => {
      const map: Record<string, WeoEconomyScore> = {}
      for (const entry of entries) map[entry.id] = entry
      scores = map
      loaded = true
      notify()
    })
    .catch(() => {
      // Expected on any machine that hasn't run the trial build script —
      // not a real error, so no console noise (unlike
      // scene/useCountryFeatures.ts's real-data fetch, which does warn).
      scores = null
      loaded = true
      notify()
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getScoresSnapshot() {
  return scores
}

function getLoadedSnapshot() {
  return loaded
}

/** `null` while loading, or if the trial file was never generated on this machine. */
export function useEconomyScoresWeo(): Record<string, WeoEconomyScore> | null {
  ensureFetch()
  return useSyncExternalStore(subscribe, getScoresSnapshot)
}

export function useEconomyScoresWeoLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
