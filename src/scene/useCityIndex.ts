import { useSyncExternalStore } from 'react'

// Pre-built by scripts/buildCityBoundariesIndex.mjs alongside the per-
// country geometry files in public/geo/city-boundaries/*.json (see
// useCityOutline.ts) — the lightweight, always-fetched index (id/name/lat/
// lng/population/isCapital) hud/SearchBar.tsx and CityLabels.tsx need,
// without pulling in every city's actual (much heavier, on-demand-only)
// boundary geometry.
//
// Generalizes what was useUsCitiesIndex.ts (US-only) into every country
// city-boundaries-architecture.md's per-feature join has actually verified
// so far — Jordan (400), Kuwait (414), the US (840) — NOT all 193 UN
// members yet; see that doc's migration plan for why the other 190 aren't
// included.
export interface CityIndexEntry {
  id: string
  name: string
  lat: number
  lng: number
  countryId: string
  // Real population: GeoNames-sourced for Jordan/Kuwait, 2023 Census
  // estimate for the US (0 for CDPs, which that Census program doesn't
  // estimate at all — see buildUsCitiesData.mjs).
  population: number
  // Generalizes the old US-only STATE_CAPITAL_FLOOR/isStateCapital: true
  // for a national capital (Amman, Kuwait City) or a US state capital
  // (Montpelier, Pierre, ...) alike — both get the same low-population
  // floor treatment in CityLabels.tsx.
  isCapital: boolean
  // Only present for US (840) entries — which state shard
  // (public/geo/city-boundaries/840/{stateAbbrev}.json) holds this city's
  // boundary geometry. See useCityOutline.ts.
  stateAbbrev?: string
}

const DATA_URL = '/geo/city-boundaries-index.json'

let entries: CityIndexEntry[] = []
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
    .then((data: CityIndexEntry[]) => {
      entries = data
      notify()
    })
    .catch((err) => {
      console.warn('City index unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return entries
}

export function useCityIndex(): CityIndexEntry[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getSnapshot)
}
