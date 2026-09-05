import { useSyncExternalStore } from 'react'
import type { Feature, Geometry } from 'geojson'
import { useSelection } from '../hud/selectionStore'

// Fetches one city's real boundary polygon on demand, from
// scripts/buildCityBoundaries.mjs's per-country output — only once a city
// is actually searched for/selected (see hud/SearchBar.tsx's flyToCity()).
// Cached per shard so re-selecting a different city in the same shard
// doesn't re-fetch. Generalizes what was useUsCityOutline.ts: the US (840)
// stays sharded by state (public/geo/city-boundaries/840/{state}.json,
// matching us-cities/{state}.json's existing per-state granularity — see
// buildCityBoundaries.mjs's own comment for why merging it into one file
// was tried and reverted); every other verified country (Jordan, Kuwait) is
// small enough to ship as one file per country.
const shardCache = new Map<string, Feature[]>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function shardUrl(countryId: string, stateAbbrev?: string): string {
  if (countryId === '840') {
    if (!stateAbbrev) throw new Error('US city outline lookup requires a stateAbbrev')
    return `/geo/city-boundaries/840/${stateAbbrev.toLowerCase()}.json`
  }
  return `/geo/city-boundaries/${countryId}.json`
}

function shardKey(countryId: string, stateAbbrev?: string): string {
  return countryId === '840' ? `840:${(stateAbbrev ?? '').toLowerCase()}` : countryId
}

function ensureShardFetch(countryId: string, stateAbbrev?: string) {
  const key = shardKey(countryId, stateAbbrev)
  if (shardCache.has(key) || inFlight.has(key)) return

  const promise = fetch(shardUrl(countryId, stateAbbrev))
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${shardUrl(countryId, stateAbbrev)}: ${res.status}`)
      return res.json()
    })
    .then((collection: { features: Feature[] }) => {
      shardCache.set(key, collection.features)
      notify()
    })
    .catch((err) => {
      console.warn(`City outline data unavailable for country "${countryId}":`, err)
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// useSyncExternalStore requires getSnapshot to return a STABLE reference
// when nothing has actually changed — building a fresh `{ name, geometry }`
// object literal on every call makes React see a "new" snapshot on every
// single render, which retriggers a render, forever. Cache the resolved
// result and only recompute when the composite key (which city, and
// whether its shard has finished loading) actually changes.
let lastKey: string | null = null
let lastResult: { name: string; geometry: Geometry } | null = null

function getSnapshot(cityOutline: { id: string; countryId: string; stateAbbrev?: string; name: string } | null) {
  if (!cityOutline) {
    lastKey = null
    lastResult = null
    return lastResult
  }

  const key = shardKey(cityOutline.countryId, cityOutline.stateAbbrev)
  const hasShard = shardCache.has(key)
  const cacheKey = `${key}:${cityOutline.id}:${hasShard}`
  if (cacheKey === lastKey) return lastResult

  lastKey = cacheKey
  const match = hasShard ? shardCache.get(key)!.find((f) => f.id === cityOutline.id) : undefined
  lastResult = match ? { name: cityOutline.name, geometry: match.geometry } : null
  return lastResult
}

/** The currently-active city outline's geometry, or null if none is set or its shard hasn't loaded yet. */
export function useCityOutlineGeometry(): { name: string; geometry: Geometry } | null {
  const { cityOutline } = useSelection()

  if (cityOutline) ensureShardFetch(cityOutline.countryId, cityOutline.stateAbbrev)

  return useSyncExternalStore(subscribe, () => getSnapshot(cityOutline))
}
