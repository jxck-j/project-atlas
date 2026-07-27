import { useSyncExternalStore } from 'react'

// Pre-built by scripts/buildUsCitiesData.mjs alongside the per-state
// geometry shards in public/geo/us-cities/*.json (see
// useUsCityOutline.ts), but deliberately a separate file/fetch: this is
// the lightweight, always-fetched search index (id/name/lat/lng/state) —
// hud/SearchBar.tsx needs it to find a city by name and fly there without
// pulling in that city's actual (much heavier, on-demand-only) geometry.
export interface UsCityIndexEntry {
  id: string
  name: string
  lat: number
  lng: number
  stateId: string
  stateAbbrev: string
  stateName: string
  // 2023 Census population estimate — city-proper, not metro area. 0 for
  // Census-Designated Places (unincorporated communities), which this
  // Census program doesn't estimate at all — see buildUsCitiesData.mjs.
  population: number
  // Hand-curated (scripts/lib/usStateCapitals.mjs) — no dataset flags this
  // for the US. True regardless of `population` (Honolulu, HI's capital,
  // is itself a CDP and so has population 0 despite being a capital).
  isStateCapital: boolean
}

const DATA_URL = '/geo/us-cities-index.json'

let entries: UsCityIndexEntry[] = []
let fetchStarted = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureFetch() {
  if (fetchStarted) return
  fetchStarted = true

  fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`)
      return res.json()
    })
    .then((data: UsCityIndexEntry[]) => {
      entries = data
      notify()
    })
    .catch((err) => {
      console.warn('US city search index unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return entries
}

export function useUsCitiesIndex(): UsCityIndexEntry[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getSnapshot)
}
