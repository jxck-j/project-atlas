import { useSyncExternalStore } from 'react'

// Canadian counterpart to useUsCitiesIndex.ts — same "lightweight,
// always-fetched search index, separate from the much heavier on-demand
// geometry" split, same singleton-fetch-and-subscribe shape. Deliberately a
// parallel file rather than a generic `useCityIndex(country)` at this point
// (two near-identical implementations, not yet three) — see
// GEO_ENGINE_CHANGELOG.md's Canada entry and CLAUDE.md's EntityRenderLayer
// precedent for why this codebase duplicates first and generalizes once a
// third real caller (Mexico, planned) shows up needing the same shape.
export interface CanadaCityIndexEntry {
  id: string
  name: string
  lat: number
  lng: number
  provinceId: string
  provinceAbbrev: string
  provinceName: string
  // 2021 Census population, from Statistics Canada Table 98-10-0002-01 — see
  // buildCanadaCitiesData.mjs. 0 for the small minority of CSDs this table
  // has no matching row for (not a real population of zero).
  population: number
}

const DATA_URL = '/geo/canada-cities-index.json'

let entries: CanadaCityIndexEntry[] = []
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
    .then((data: CanadaCityIndexEntry[]) => {
      entries = data
      notify()
    })
    .catch((err) => {
      console.warn('Canada city search index unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return entries
}

export function useCanadaCitiesIndex(): CanadaCityIndexEntry[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getSnapshot)
}
